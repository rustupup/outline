import "./bootstrap";
import { Op } from "sequelize";
import Collection from "@server/models/Collection";
import Document from "@server/models/Document";
import env from "@server/env";
import { createMeilisearchClient } from "plugins/search-meilisearch/server/client";
import { CollectionMapper } from "plugins/search-meilisearch/server/CollectionMapper";
import { DocumentMapper } from "plugins/search-meilisearch/server/DocumentMapper";
import {
  MeilisearchIndexManager,
  type RebuildOptions,
} from "plugins/search-meilisearch/server/MeilisearchIndexManager";
import {
  stableCollectionIndexName,
  stableDocumentIndexName,
  versionedCollectionIndexName,
  versionedDocumentIndexName,
} from "plugins/search-meilisearch/server/settings";

/**
 * Rebuild Meilisearch indexes from PostgreSQL into versioned indexes, verify
 * counts, and atomically swap into the stable names.
 *
 * Usage:
 *   node ./build/server/scripts/20260718000000-rebuild-meilisearch-index.js [--team-id <uuid> --no-swap] [--batch-size <n>] [--dry-run] [--no-swap] [--allow-provider-mismatch]
 */
export default async function main(exit = true): Promise<void> {
  const opts = MeilisearchIndexManager.parseRebuildArgs(process.argv.slice(2));

  if (!opts.allowProviderMismatch && env.SEARCH_PROVIDER !== "meilisearch") {
    console.error(
      `SEARCH_PROVIDER is "${env.SEARCH_PROVIDER}", not "meilisearch". Use --allow-provider-mismatch for shadow builds.`
    );
    if (exit) {
      process.exit(1);
    }
    return;
  }

  const client = createMeilisearchClient();
  const manager = new MeilisearchIndexManager(client);
  const documentMapper = new DocumentMapper();
  const collectionMapper = new CollectionMapper();
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "Z");

  const backfillStartedAt = new Date();
  console.log(`Rebuild started, versioned timestamp: ${timestamp}`);

  // Step 4: Create versioned indexes and settings.
  if (!opts.dryRun) {
    await manager.createVersionedDocumentIndex(timestamp);
    await manager.createVersionedCollectionIndex(timestamp);
  }

  // Step 5-7: Scan documents in id-ascending batches using id > lastId.
  let lastDocumentId: string | null = null;
  let documentCount = 0;

  while (true) {
    const documents: Document[] = await Document.unscoped().findAll({
      where: {
        // Skip the id > lastId condition on the first batch so we don't
        // compare a UUID column against a placeholder string.
        ...(lastDocumentId ? { id: { [Op.gt]: lastDocumentId } } : {}),
        deletedAt: { [Op.is]: null },
        ...(opts.teamId ? { teamId: opts.teamId } : {}),
      },
      order: [["id", "ASC"]],
      limit: opts.batchSize,
    });

    if (documents.length === 0) {
      break;
    }

    if (!opts.dryRun) {
      const records = await Promise.all(
        documents.map((document: Document) => documentMapper.toRecord(document))
      );
      await manager.batchUpsertDocuments(timestamp, records);
    }

    documentCount += documents.length;
    lastDocumentId = documents[documents.length - 1].id;
    console.log(`Documents mapped: ${documentCount}`);
  }

  // Step 8: Scan collections.
  let lastCollectionId: string | null = null;
  let collectionCount = 0;

  while (true) {
    const collections: Collection[] = await Collection.unscoped().findAll({
      where: {
        ...(lastCollectionId ? { id: { [Op.gt]: lastCollectionId } } : {}),
        deletedAt: { [Op.is]: null },
        ...(opts.teamId ? { teamId: opts.teamId } : {}),
      },
      order: [["id", "ASC"]],
      limit: opts.batchSize,
    });

    if (collections.length === 0) {
      break;
    }

    if (!opts.dryRun) {
      const records = await Promise.all(
        collections.map((c) => collectionMapper.toRecord(c))
      );
      await manager.batchUpsertCollections(timestamp, records);
    }

    collectionCount += collections.length;
    lastCollectionId = collections[collections.length - 1].id;
  }

  console.log(
    `Scanned ${documentCount} documents, ${collectionCount} collections`
  );

  if (opts.dryRun) {
    console.log("Dry run complete; no indexes were modified.");
    if (exit) {
      process.exit(0);
    }
    return;
  }

  // Step 9: Catch-up scan for records updated during backfill.
  const catchUpDocs = await Document.unscoped().findAll({
    where: {
      updatedAt: { [Op.gte]: backfillStartedAt },
      ...(opts.teamId ? { teamId: opts.teamId } : {}),
    },
  });
  const liveCatchUpDocs = catchUpDocs.filter((document) => !document.deletedAt);
  if (liveCatchUpDocs.length > 0) {
    const records = await Promise.all(
      liveCatchUpDocs.map((document) => documentMapper.toRecord(document))
    );
    await manager.batchUpsertDocuments(timestamp, records);
  }
  await manager.batchDeleteDocuments(
    timestamp,
    catchUpDocs
      .filter((document) => Boolean(document.deletedAt))
      .map((document) => document.id)
  );

  const catchUpCollections = await Collection.unscoped().findAll({
    where: {
      updatedAt: { [Op.gte]: backfillStartedAt },
      ...(opts.teamId ? { teamId: opts.teamId } : {}),
    },
  });
  const liveCatchUpCollections = catchUpCollections.filter(
    (collection) => !collection.deletedAt
  );
  if (liveCatchUpCollections.length > 0) {
    const records = await Promise.all(
      liveCatchUpCollections.map((collection) =>
        collectionMapper.toRecord(collection)
      )
    );
    await manager.batchUpsertCollections(timestamp, records);
  }
  await manager.batchDeleteCollections(
    timestamp,
    catchUpCollections
      .filter((collection) => Boolean(collection.deletedAt))
      .map((collection) => collection.id)
  );

  // Step 10-11: Verify counts.
  const countWhere = {
    deletedAt: { [Op.is]: null },
    ...(opts.teamId ? { teamId: opts.teamId } : {}),
  };
  const [expectedDocumentCount, expectedCollectionCount] = await Promise.all([
    Document.unscoped().count({ where: countWhere }),
    Collection.unscoped().count({ where: countWhere }),
  ]);
  await manager.verifyDocumentCount(timestamp, expectedDocumentCount);
  await manager.verifyCollectionCount(timestamp, expectedCollectionCount);

  // Step 12-14: Swap (unless --no-swap).
  if (!opts.noSwap) {
    await manager.swapDocumentIndex(timestamp);
    await manager.swapCollectionIndex(timestamp);
    console.log("Swap complete. Old indexes retained for manual cleanup.");
    console.log(`Stable document index: ${stableDocumentIndexName()}`);
    console.log(`Stable collection index: ${stableCollectionIndexName()}`);
    console.log(
      `Versioned document index (old): ${versionedDocumentIndexName(timestamp)}`
    );
    console.log(
      `Versioned collection index (old): ${versionedCollectionIndexName(timestamp)}`
    );
  } else {
    console.log("--no-swap: indexes built and verified but not activated.");
  }

  if (exit) {
    process.exit(0);
  }
}

// Reference RebuildOptions so the type stays in the dependency graph.
void (null as unknown as RebuildOptions);

// Auto-run when invoked directly.
if (require.main === module) {
  void main(true);
}

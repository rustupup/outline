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
import { stableCollectionIndexName } from "plugins/search-meilisearch/server/settings";

/**
 * Rebuild Meilisearch indexes from PostgreSQL into versioned indexes, verify
 * counts, and atomically swap into the stable names.
 *
 * Usage:
 *   node ./build/server/scripts/20260718000000-rebuild-meilisearch-index.js [--team-id <uuid>] [--batch-size <n>] [--dry-run] [--no-swap] [--resume-from <uuid>] [--allow-provider-mismatch]
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

  console.log(`Rebuild started, versioned timestamp: ${timestamp}`);

  // Step 4: Create versioned indexes and settings.
  if (!opts.dryRun) {
    await manager.createVersionedDocumentIndex(timestamp);
    await manager.createVersionedCollectionIndex(timestamp);
  }

  // Step 5-7: Scan documents in id-ascending batches using id > lastId.
  const backfillStartedAt = new Date();
  let lastDocumentId = opts.resumeFrom ?? "0";
  let documentCount = 0;

  while (true) {
    const documents = await Document.unscoped().findAll({
      where: {
        id: { [Op.gt]: lastDocumentId },
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
        documents.map((d) => documentMapper.toRecord(d))
      );
      await manager.batchUpsertDocuments(timestamp, records);
    }

    documentCount += documents.length;
    lastDocumentId = documents[documents.length - 1].id;
    console.log(`Documents mapped: ${documentCount}`);
  }

  // Step 8: Scan collections.
  let lastCollectionId = "0";
  let collectionCount = 0;

  while (true) {
    const collections = await Collection.unscoped().findAll({
      where: {
        id: { [Op.gt]: lastCollectionId },
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
      deletedAt: { [Op.is]: null },
      ...(opts.teamId ? { teamId: opts.teamId } : {}),
    },
  });
  if (catchUpDocs.length > 0) {
    const records = await Promise.all(
      catchUpDocs.map((d) => documentMapper.toRecord(d))
    );
    await manager.batchUpsertDocuments(timestamp, records);
    documentCount += catchUpDocs.length;
  }

  // Step 10-11: Verify counts.
  await manager.verifyDocumentCount(timestamp, documentCount);

  // Step 12-14: Swap (unless --no-swap).
  if (!opts.noSwap) {
    await manager.swapDocumentIndex(timestamp);
    await manager.swapCollectionIndex(timestamp);
    console.log("Swap complete. Old indexes retained for manual cleanup.");
    console.log(`Old document index: ${stableCollectionIndexName()}`);
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

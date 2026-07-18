import type { MeilisearchClient } from "./client";
import {
  collectionIndexSettings,
  documentIndexSettings,
  stableCollectionIndexName,
  stableDocumentIndexName,
  versionedCollectionIndexName,
  versionedDocumentIndexName,
} from "./settings";
import type {
  MeilisearchCollectionRecord,
  MeilisearchDocumentRecord,
} from "./types";

/** Options parsed from the rebuild script command line. */
export interface RebuildOptions {
  /** Optional team id to rebuild a single team for testing. */
  teamId?: string;
  /** Batch size for document/collection scans. */
  batchSize: number;
  /** When true, count and map without writing. */
  dryRun: boolean;
  /** When true, build and verify without swapping. */
  noSwap: boolean;
  /** Optional checkpoint id to resume from. */
  resumeFrom?: string;
  /** Allow rebuilding when SEARCH_PROVIDER is not meilisearch. */
  allowProviderMismatch: boolean;
}

/** Minimum allowed batch size. */
const MIN_BATCH_SIZE = 100;
/** Maximum allowed batch size. */
const MAX_BATCH_SIZE = 2000;
/** Default batch size. */
const DEFAULT_BATCH_SIZE = 1000;

/**
 * Manages Meilisearch index lifecycle: creation, settings, batch upserts,
 * verification, atomic swaps, and deletion of abandoned indexes.
 *
 * The stable index names (`outline_documents`, `outline_collections`) are what
 * the provider reads/writes at runtime. Rebuilds target a versioned index
 * (`outline_documents_v1_<timestamp>`) and atomically swap it into the stable
 * name once verified, so searches see a consistent index throughout.
 */
export class MeilisearchIndexManager {
  public constructor(private readonly client: MeilisearchClient) {}

  /**
   * Create a versioned document index with primary key `id` and apply the
   * document settings, waiting for both tasks to complete.
   *
   * @param timestamp - build identifier used in the versioned name.
   */
  public async createVersionedDocumentIndex(timestamp: string): Promise<void> {
    const uid = versionedDocumentIndexName(timestamp);
    const create = await this.client.createIndex(uid, { primaryKey: "id" });
    await this.client.waitForTask(create.taskUid, { timeout: 30000 });

    const index = this.client.index<MeilisearchDocumentRecord>(uid);
    const settings = await index.updateSettings(documentIndexSettings as never);
    await this.client.waitForTask(settings.taskUid, { timeout: 30000 });
  }

  /**
   * Create a versioned collection index with primary key `id` and apply the
   * collection settings.
   *
   * @param timestamp - build identifier used in the versioned name.
   */
  public async createVersionedCollectionIndex(
    timestamp: string
  ): Promise<void> {
    const uid = versionedCollectionIndexName(timestamp);
    const create = await this.client.createIndex(uid, { primaryKey: "id" });
    await this.client.waitForTask(create.taskUid, { timeout: 30000 });

    const index = this.client.index<MeilisearchCollectionRecord>(uid);
    const settings = await index.updateSettings(
      collectionIndexSettings as never
    );
    await this.client.waitForTask(settings.taskUid, { timeout: 30000 });
  }

  /**
   * Batch upsert document records into the versioned document index, waiting
   * for the task to complete so a failure stops the rebuild before swap.
   *
   * @param timestamp - build identifier.
   * @param records - document records to upsert.
   */
  public async batchUpsertDocuments(
    timestamp: string,
    records: MeilisearchDocumentRecord[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const index = this.client.index<MeilisearchDocumentRecord>(
      versionedDocumentIndexName(timestamp)
    );
    const enqueued = await index.addDocuments(records);
    await this.client.waitForTask(enqueued.taskUid, { timeout: 60000 });
  }

  /**
   * Batch upsert collection records into the versioned collection index.
   *
   * @param timestamp - build identifier.
   * @param records - collection records to upsert.
   */
  public async batchUpsertCollections(
    timestamp: string,
    records: MeilisearchCollectionRecord[]
  ): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const index = this.client.index<MeilisearchCollectionRecord>(
      versionedCollectionIndexName(timestamp)
    );
    const enqueued = await index.addDocuments(records);
    await this.client.waitForTask(enqueued.taskUid, { timeout: 60000 });
  }

  /**
   * Verify the versioned document index has the expected number of documents.
   * Refuses to swap when counts differ.
   *
   * @param timestamp - build identifier.
   * @param expected - expected document count.
   */
  public async verifyDocumentCount(
    timestamp: string,
    expected: number
  ): Promise<void> {
    const index = this.client.index<MeilisearchDocumentRecord>(
      versionedDocumentIndexName(timestamp)
    );
    const stats = await index.getStats();
    if (stats.numberOfDocuments !== expected) {
      throw new Error(
        `Document count mismatch: expected ${expected}, got ${stats.numberOfDocuments}`
      );
    }
  }

  /**
   * Atomically swap the versioned document index into the stable name. The
   * previous stable index is retained as the old versioned name for manual
   * cleanup; it is never deleted automatically.
   *
   * @param timestamp - build identifier.
   */
  public async swapDocumentIndex(timestamp: string): Promise<void> {
    const enqueued = await this.client.swapIndexes([
      {
        indexes: [
          stableDocumentIndexName(),
          versionedDocumentIndexName(timestamp),
        ],
        rename: false,
      },
    ]);
    await this.client.waitForTask(enqueued.taskUid, { timeout: 30000 });
  }

  /**
   * Atomically swap the versioned collection index into the stable name.
   *
   * @param timestamp - build identifier.
   */
  public async swapCollectionIndex(timestamp: string): Promise<void> {
    const enqueued = await this.client.swapIndexes([
      {
        indexes: [
          stableCollectionIndexName(),
          versionedCollectionIndexName(timestamp),
        ],
        rename: false,
      },
    ]);
    await this.client.waitForTask(enqueued.taskUid, { timeout: 30000 });
  }

  /**
   * Delete an abandoned versioned index. Only call this after verifying the
   * index is not the current stable target.
   *
   * @param uid - the index uid to delete.
   */
  public async deleteIndex(uid: string): Promise<void> {
    const enqueued = await this.client.deleteIndex(uid);
    await this.client.waitForTask(enqueued.taskUid, { timeout: 30000 });
  }

  /**
   * Parse rebuild script arguments. Unknown arguments fail with a usage
   * message. Batch size is bounded to [100, 2000].
   *
   * @param argv - the command-line arguments (without node/script path).
   * @returns the parsed options.
   */
  public static parseRebuildArgs(argv: string[]): RebuildOptions {
    const opts: RebuildOptions = {
      batchSize: DEFAULT_BATCH_SIZE,
      dryRun: false,
      noSwap: false,
      allowProviderMismatch: false,
    };

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      switch (arg) {
        case "--team-id":
          opts.teamId = argv[++i];
          break;
        case "--batch-size": {
          const n = Number(argv[++i]);
          if (!Number.isFinite(n) || n < MIN_BATCH_SIZE || n > MAX_BATCH_SIZE) {
            throw new Error(
              `--batch-size must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}`
            );
          }
          opts.batchSize = n;
          break;
        }
        case "--dry-run":
          opts.dryRun = true;
          break;
        case "--no-swap":
          opts.noSwap = true;
          break;
        case "--resume-from":
          opts.resumeFrom = argv[++i];
          break;
        case "--allow-provider-mismatch":
          opts.allowProviderMismatch = true;
          break;
        default:
          throw new Error(`Unknown argument: ${arg}`);
      }
    }

    return opts;
  }
}

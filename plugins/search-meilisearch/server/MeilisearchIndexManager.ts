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
   * Wait for a Meilisearch task and reject if it failed.
   *
   * The SDK's waitForTask resolves as soon as a task leaves the
   * enqueued/processing state, regardless of whether it succeeded or failed.
   * This wrapper checks the final status and rejects on failure, so a failed
   * swap/settings/documents task surfaces as an error instead of being
   * silently treated as success.
   *
   * @param taskUid - the enqueued task uid to await.
   * @param options - wait options (timeout).
   */
  private async waitForTaskSuccess(
    taskUid: number,
    options?: { timeout?: number }
  ): Promise<void> {
    const task = await this.client.waitForTask(taskUid, options);
    if (task.status === "failed") {
      const detail = "error" in task ? JSON.stringify(task.error) : "unknown";
      throw new Error(`Meilisearch task ${taskUid} failed: ${detail}`);
    }
  }

  /**
   * Create a versioned document index with primary key `id` and apply the
   * document settings, waiting for both tasks to complete.
   *
   * @param timestamp - build identifier used in the versioned name.
   */
  public async createVersionedDocumentIndex(timestamp: string): Promise<void> {
    const uid = versionedDocumentIndexName(timestamp);
    const create = await this.client.createIndex(uid, { primaryKey: "id" });
    await this.waitForTaskSuccess(create.taskUid, { timeout: 30000 });

    const index = this.client.index<MeilisearchDocumentRecord>(uid);
    const settings = await index.updateSettings(documentIndexSettings as never);
    await this.waitForTaskSuccess(settings.taskUid, { timeout: 30000 });
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
    await this.waitForTaskSuccess(create.taskUid, { timeout: 30000 });

    const index = this.client.index<MeilisearchCollectionRecord>(uid);
    const settings = await index.updateSettings(
      collectionIndexSettings as never
    );
    await this.waitForTaskSuccess(settings.taskUid, { timeout: 30000 });
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
    await this.waitForTaskSuccess(enqueued.taskUid, { timeout: 60000 });
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
    await this.waitForTaskSuccess(enqueued.taskUid, { timeout: 60000 });
  }

  /**
   * Remove documents that were soft-deleted during a rebuild.
   *
   * @param timestamp - build identifier.
   * @param ids - document ids to remove.
   */
  public async batchDeleteDocuments(
    timestamp: string,
    ids: string[]
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const index = this.client.index<MeilisearchDocumentRecord>(
      versionedDocumentIndexName(timestamp)
    );
    const enqueued = await index.deleteDocuments(ids);
    await this.waitForTaskSuccess(enqueued.taskUid, { timeout: 60000 });
  }

  /**
   * Remove collections that were soft-deleted during a rebuild.
   *
   * @param timestamp - build identifier.
   * @param ids - collection ids to remove.
   */
  public async batchDeleteCollections(
    timestamp: string,
    ids: string[]
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const index = this.client.index<MeilisearchCollectionRecord>(
      versionedCollectionIndexName(timestamp)
    );
    const enqueued = await index.deleteDocuments(ids);
    await this.waitForTaskSuccess(enqueued.taskUid, { timeout: 60000 });
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
   * Verify the versioned collection index has the expected number of records.
   *
   * @param timestamp - build identifier.
   * @param expected - expected collection count.
   */
  public async verifyCollectionCount(
    timestamp: string,
    expected: number
  ): Promise<void> {
    const index = this.client.index<MeilisearchCollectionRecord>(
      versionedCollectionIndexName(timestamp)
    );
    const stats = await index.getStats();
    if (stats.numberOfDocuments !== expected) {
      throw new Error(
        `Collection count mismatch: expected ${expected}, got ${stats.numberOfDocuments}`
      );
    }
  }

  /**
   * Ensure the stable index exists before swapping. Meilisearch v1.49's
   * swapIndexes rejects if either index uid is missing, so on first
   * installation we must create an empty stable index first. If the stable
   * index already exists, the createIndex call fails and we swallow the
   * error (checked via task status, not the enqueue response).
   *
   * @param uid - the stable index uid to ensure exists.
   */
  private async ensureStableIndexExists(uid: string): Promise<void> {
    try {
      const enqueued = await this.client.createIndex(uid, {
        primaryKey: "id",
      });
      await this.waitForTaskSuccess(enqueued.taskUid, { timeout: 30000 });
    } catch (err) {
      // Index already exists (createIndex returns a failed task with
      // "index_already_exists" error). Safe to ignore — we only need it
      // to exist before swap.
      if (
        !(err instanceof Error) ||
        !err.message.includes("index_already_exists")
      ) {
        throw err;
      }
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
    await this.ensureStableIndexExists(stableDocumentIndexName());
    const enqueued = await this.client.swapIndexes([
      {
        indexes: [
          stableDocumentIndexName(),
          versionedDocumentIndexName(timestamp),
        ],
        rename: false,
      },
    ]);
    await this.waitForTaskSuccess(enqueued.taskUid, { timeout: 30000 });
  }

  /**
   * Atomically swap the versioned collection index into the stable name.
   *
   * @param timestamp - build identifier.
   */
  public async swapCollectionIndex(timestamp: string): Promise<void> {
    await this.ensureStableIndexExists(stableCollectionIndexName());
    const enqueued = await this.client.swapIndexes([
      {
        indexes: [
          stableCollectionIndexName(),
          versionedCollectionIndexName(timestamp),
        ],
        rename: false,
      },
    ]);
    await this.waitForTaskSuccess(enqueued.taskUid, { timeout: 30000 });
  }

  /**
   * Delete an abandoned versioned index. Only call this after verifying the
   * index is not the current stable target.
   *
   * @param uid - the index uid to delete.
   */
  public async deleteIndex(uid: string): Promise<void> {
    const enqueued = await this.client.deleteIndex(uid);
    await this.waitForTaskSuccess(enqueued.taskUid, { timeout: 30000 });
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
        // POSIX-style option terminator: node and npm pass it before
        // user args. Silently skip so callers can use `node script.js -- --flag`.
        case "--":
          break;
        case "--team-id":
          opts.teamId = argv[++i];
          if (!opts.teamId) {
            throw new Error("--team-id requires a value");
          }
          break;
        case "--batch-size": {
          const n = Number(argv[++i]);
          if (
            !Number.isInteger(n) ||
            n < MIN_BATCH_SIZE ||
            n > MAX_BATCH_SIZE
          ) {
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
          if (!opts.resumeFrom) {
            throw new Error("--resume-from requires a value");
          }
          break;
        case "--allow-provider-mismatch":
          opts.allowProviderMismatch = true;
          break;
        default:
          throw new Error(`Unknown argument: ${arg}`);
      }
    }

    if (opts.resumeFrom) {
      throw new Error(
        "--resume-from is disabled because rebuilds create a new versioned index and cannot safely resume without a persistent build id"
      );
    }

    if (opts.teamId && !opts.noSwap && !opts.dryRun) {
      throw new Error("--team-id requires --no-swap to protect other teams");
    }

    return opts;
  }
}

import { Meilisearch } from "meilisearch";
import type {
  EnqueuedTask,
  IndexStats,
  SearchParams,
  SearchResponse,
  Settings,
  Task,
  WaitOptions,
} from "meilisearch";
import env from "@server/env";

/**
 * Narrow view over a Meilisearch index, exposing only the methods the plugin
 * uses. Defining this locally keeps the provider testable with a fake and
 * avoids leaking SDK internals across module boundaries.
 */
export interface SearchIndexClient<T> {
  /** Add documents, replacing any with the same primary key. */
  addDocuments(
    documents: T[],
    options?: { primaryKey?: string }
  ): Promise<EnqueuedTask>;
  /** Partial-update documents by primary key. */
  updateDocuments(documents: Partial<T>[]): Promise<EnqueuedTask>;
  /** Delete a single document by id. */
  deleteDocument(id: string): Promise<EnqueuedTask>;
  /** Search the index. */
  search(
    query: string,
    options: SearchParams
  ): Promise<SearchResponse<T, SearchParams>>;
  /** Apply index settings. */
  updateSettings(settings: Settings): Promise<EnqueuedTask>;
  /** Return index statistics. */
  getStats(): Promise<IndexStats>;
}

/**
 * Narrow view over the Meilisearch client, exposing only index lookup and the
 * management operations the index manager uses (create/swap/delete).
 */
export interface MeilisearchClient {
  /** Look up an index by uid. */
  index<T>(uid: string): SearchIndexClient<T>;
  /** Create an index with an optional primary key. */
  createIndex(
    uid: string,
    options?: { primaryKey?: string }
  ): Promise<EnqueuedTask>;
  /** Delete an index by uid. */
  deleteIndex(uid: string): Promise<EnqueuedTask>;
  /** Atomically swap two index uids. */
  swapIndexes(
    params: {
      indexes: [string, string];
      rename?: boolean;
    }[]
  ): Promise<EnqueuedTask>;
  /** Check server health. */
  health(): Promise<{ status: string }>;
  /** Wait for an async task to complete, rejecting on failure. */
  waitForTask(taskUid: number, options?: WaitOptions): Promise<Task>;
}

/**
 * Construct a Meilisearch client from the current environment.
 *
 * Validates that both `MEILISEARCH_HOST` and `MEILISEARCH_API_KEY` are set so
 * that misconfiguration fails fast at construction rather than on the first
 * request. The API key is never included in the thrown error message.
 *
 * @param sdk - optional SDK constructor, used by tests to inject a fake.
 * @returns a {@link MeilisearchClient} backed by the meilisearch SDK.
 * @throws when host or API key is missing.
 */
export function createMeilisearchClient(
  sdk: typeof Meilisearch = Meilisearch
): MeilisearchClient {
  if (!env.MEILISEARCH_HOST) {
    throw new Error(
      "Meilisearch host is not configured (set MEILISEARCH_HOST)."
    );
  }
  if (!env.MEILISEARCH_API_KEY) {
    throw new Error(
      "Meilisearch API key is not configured (set MEILISEARCH_API_KEY)."
    );
  }

  const instance = new sdk({
    host: env.MEILISEARCH_HOST,
    apiKey: env.MEILISEARCH_API_KEY,
    timeout: env.MEILISEARCH_TIMEOUT_MS,
  });

  // Adapt the SDK's task client to the narrow MeilisearchClient interface.
  // The SDK exposes waitForTask on the tasks sub-client; we surface it at the
  // top level so the provider can await async indexing tasks uniformly.
  return {
    index: (uid: string) => instance.index(uid),
    createIndex: (uid: string, options?: { primaryKey?: string }) =>
      instance.createIndex(uid, options),
    deleteIndex: (uid: string) => instance.deleteIndex(uid),
    swapIndexes: (params: { indexes: [string, string]; rename?: boolean }[]) =>
      instance.swapIndexes(
        params.map((p) => ({ indexes: p.indexes, rename: p.rename ?? false }))
      ),
    health: () => instance.health(),
    waitForTask: (taskUid: number, options?: WaitOptions) =>
      instance.tasks.waitForTask(taskUid, options),
  } as unknown as MeilisearchClient;
}

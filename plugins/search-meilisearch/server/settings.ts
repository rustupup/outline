import env from "@server/env";

/**
 * Meilisearch index settings for the documents index.
 *
 * Searchable attributes are limited to title, previousTitles, and text to
 * avoid indexing metadata. All ACL and timestamp fields are filterable so the
 * authorization filter in Section 3.4 can be evaluated. Sortable attributes
 * cover the API sort options plus popularityScore for tie-breaking. The
 * ranking rules append `popularityScore:desc` after the built-in rules to
 * boost popular documents without overriding relevance.
 */
export const documentIndexSettings = {
  searchableAttributes: ["title", "previousTitles", "text"],
  displayedAttributes: ["id", "title", "text"],
  filterableAttributes: [
    "teamId",
    "collectionId",
    "createdById",
    "collaboratorIds",
    "directUserIds",
    "directGroupIds",
    "publishedAt",
    "archivedAt",
    "deletedAt",
    "createdAt",
    "updatedAt",
    "template",
    "trialImport",
  ],
  sortableAttributes: ["createdAt", "updatedAt", "title", "popularityScore"],
  rankingRules: [
    "words",
    "typo",
    "proximity",
    "attribute",
    "sort",
    "exactness",
    "popularityScore:desc",
  ],
  pagination: { maxTotalHits: 10000 },
} as const;

/**
 * Meilisearch index settings for the collections index.
 *
 * Collection visibility is filtered at query time using `id` and `teamId`, so
 * only those plus archivedAt/deletedAt are filterable.
 */
export const collectionIndexSettings = {
  searchableAttributes: ["name", "description"],
  displayedAttributes: ["id", "name"],
  filterableAttributes: ["teamId", "id", "archivedAt", "deletedAt"],
  sortableAttributes: ["name", "updatedAt"],
  pagination: { maxTotalHits: 10000 },
} as const;

/**
 * Returns the configured index name prefix. Falls back to "outline" when
 * unset, matching the env default.
 */
function prefix(): string {
  return env.MEILISEARCH_INDEX_PREFIX ?? "outline";
}

/**
 * Stable index name for the documents index. Reads/writes at runtime target
 * this name; atomic swaps point it at a freshly rebuilt versioned index.
 *
 * @returns the stable document index name.
 */
export function stableDocumentIndexName(): string {
  return `${prefix()}_documents`;
}

/**
 * Stable index name for the collections index.
 *
 * @returns the stable collection index name.
 */
export function stableCollectionIndexName(): string {
  return `${prefix()}_collections`;
}

/**
 * Versioned index name for a documents rebuild. The schema version segment
 * (`v1`) lets future schema migrations coexist with stale rebuild artifacts,
 * and the timestamp segment makes concurrent rebuild attempts distinguishable.
 *
 * @param timestamp - build identifier, typically an ISO-8601 basic timestamp.
 * @returns the versioned document index name.
 */
export function versionedDocumentIndexName(timestamp: string): string {
  return `${prefix()}_documents_v1_${timestamp}`;
}

/**
 * Versioned index name for a collections rebuild.
 *
 * @param timestamp - build identifier, typically an ISO-8601 basic timestamp.
 * @returns the versioned collection index name.
 */
export function versionedCollectionIndexName(timestamp: string): string {
  return `${prefix()}_collections_v1_${timestamp}`;
}

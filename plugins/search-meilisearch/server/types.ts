/**
 * Meilisearch document index record.
 *
 * Each field maps to a filterable/sortable attribute in
 * {@link documentIndexSettings}. Use epoch milliseconds consistently for all
 * timestamp fields — do not mix seconds and milliseconds.
 */
export interface MeilisearchDocumentRecord {
  /** The document id (primary key of the index). */
  id: string;
  /** The team that owns the document. */
  teamId: string;
  /** The collection the document belongs to, or null for uncollected drafts. */
  collectionId: string | null;
  /** The document title. */
  title: string;
  /** Previous titles the document has had, retained for searchability. */
  previousTitles: string[];
  /** The plain-text body of the document. */
  text: string;
  /** The user who created the document. */
  createdById: string;
  /** Users who collaborated on the document. */
  collaboratorIds: string[];
  /** Users with a direct membership on the document. */
  directUserIds: string[];
  /** Groups with a direct membership on the document. */
  directGroupIds: string[];
  /** Epoch milliseconds when the document was published, or null for drafts. */
  publishedAt: number | null;
  /** Epoch milliseconds when the document was archived, or null. */
  archivedAt: number | null;
  /** Epoch milliseconds when the document was soft-deleted, or null. */
  deletedAt: number | null;
  /** Epoch milliseconds when the document was created. */
  createdAt: number;
  /** Epoch milliseconds when the document was last updated. */
  updatedAt: number;
  /** The document popularity score used for ranking boost. */
  popularityScore: number;
  /** Whether the document is a template. */
  template: boolean;
  /** Whether the document was imported during a trial. */
  trialImport: boolean;
  /** Index schema version, used by rebuilds to detect stale records. */
  schemaVersion: 1;
}

/**
 * Meilisearch collection index record.
 *
 * Collection visibility is filtered at query time using
 * `id IN user.collectionIds()` and `teamId`; do not copy collection membership
 * users into this record.
 */
export interface MeilisearchCollectionRecord {
  /** The collection id (primary key of the index). */
  id: string;
  /** The team that owns the collection. */
  teamId: string;
  /** The collection name. */
  name: string;
  /** The collection description. */
  description: string;
  /** Epoch milliseconds when the collection was archived, or null. */
  archivedAt: number | null;
  /** Epoch milliseconds when the collection was soft-deleted, or null. */
  deletedAt: number | null;
  /** Epoch milliseconds when the collection was created. */
  createdAt: number;
  /** Epoch milliseconds when the collection was last updated. */
  updatedAt: number;
  /** Index schema version, used by rebuilds to detect stale records. */
  schemaVersion: 1;
}

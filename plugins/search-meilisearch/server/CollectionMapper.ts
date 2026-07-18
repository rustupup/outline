import type Collection from "@server/models/Collection";
import type { MeilisearchCollectionRecord } from "./types";

/**
 * Convert a Date (or null/undefined) to epoch milliseconds, or null when absent.
 *
 * @param value - the date to convert.
 * @returns epoch milliseconds, or null.
 */
function toEpoch(value: Date | null | undefined): number | null {
  return value ? value.getTime() : null;
}

/**
 * Maps a {@link Collection} ORM instance to a {@link MeilisearchCollectionRecord}
 * ready for indexing. Intentionally excludes `content`, memberships, icons,
 * and document structure — collection visibility is filtered at query time
 * using `id IN user.collectionIds()` and `teamId`.
 */
export class CollectionMapper {
  /**
   * Convert a collection to its Meilisearch index record.
   *
   * @param collection - the collection to map.
   * @returns the Meilisearch collection record.
   */
  public async toRecord(
    collection: Collection
  ): Promise<MeilisearchCollectionRecord> {
    return {
      id: collection.id,
      teamId: collection.teamId,
      name: collection.name,
      description: collection.description ?? "",
      archivedAt: toEpoch(collection.archivedAt),
      deletedAt: toEpoch(collection.deletedAt),
      createdAt: collection.createdAt.getTime(),
      updatedAt: collection.updatedAt.getTime(),
      schemaVersion: 1,
    };
  }
}

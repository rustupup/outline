import { Op } from "sequelize";
import { uniq } from "es-toolkit/compat";
import type Document from "@server/models/Document";
import GroupMembership from "@server/models/GroupMembership";
import UserMembership from "@server/models/UserMembership";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import type { MeilisearchDocumentRecord } from "./types";

/**
 * Dependencies used by {@link DocumentMapper} to load the ACL fields that are
 * not stored directly on the document row. Injecting these keeps the mapper
 * testable without a database and lets the provider swap in cached loaders.
 */
export interface DocumentIndexDependencies {
  /** Load the unique user ids with a direct membership on the document. */
  loadDirectUserIds(documentId: string): Promise<string[]>;
  /** Load the unique group ids with a direct membership on the document. */
  loadDirectGroupIds(documentId: string): Promise<string[]>;
}

/**
 * Default database-backed loaders. Select only the id columns and return
 * unique, sorted ids so the indexed ACL arrays are deterministic. Sourced
 * child memberships (where `sourceId` is set) still carry `documentId`, so
 * querying by `documentId` includes them.
 */
const defaultDependencies: DocumentIndexDependencies = {
  async loadDirectUserIds(documentId: string): Promise<string[]> {
    const memberships = await UserMembership.findAll({
      attributes: ["userId"],
      where: { documentId: { [Op.eq]: documentId } },
    });
    return uniq(memberships.map((m) => m.userId)).sort();
  },
  async loadDirectGroupIds(documentId: string): Promise<string[]> {
    const memberships = await GroupMembership.findAll({
      attributes: ["groupId"],
      where: { documentId: { [Op.eq]: documentId } },
    });
    return uniq(memberships.map((m) => m.groupId)).sort();
  },
};

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
 * Maps a {@link Document} ORM instance to a {@link MeilisearchDocumentRecord}
 * ready for indexing. Reads ACL fields through injected loaders so the mapper
 * stays pure and testable; defaults to database-backed loaders when no
 * dependencies are provided.
 */
export class DocumentMapper {
  private readonly dependencies: DocumentIndexDependencies;

  /**
   * @param dependencies - optional loaders for ACL fields. When omitted, the
   * mapper queries `UserMembership` and `GroupMembership` directly.
   */
  public constructor(dependencies?: DocumentIndexDependencies) {
    this.dependencies = dependencies ?? defaultDependencies;
  }

  /**
   * Convert a document to its Meilisearch index record.
   *
   * @param document - the document to map.
   * @returns the Meilisearch document record.
   */
  public async toRecord(
    document: Document
  ): Promise<MeilisearchDocumentRecord> {
    const [directUserIds, directGroupIds] = await Promise.all([
      this.dependencies.loadDirectUserIds(document.id),
      this.dependencies.loadDirectGroupIds(document.id),
    ]);

    return {
      id: document.id,
      teamId: document.teamId,
      collectionId: document.collectionId ?? null,
      title: document.title,
      previousTitles: uniq(document.previousTitles ?? []).sort(),
      text: DocumentHelper.toPlainText(document),
      createdById: document.createdById,
      collaboratorIds: uniq(document.collaboratorIds ?? []).sort(),
      directUserIds: uniq(directUserIds).sort(),
      directGroupIds: uniq(directGroupIds).sort(),
      publishedAt: toEpoch(document.publishedAt),
      archivedAt: toEpoch(document.archivedAt),
      deletedAt: toEpoch(document.deletedAt),
      createdAt: document.createdAt.getTime(),
      updatedAt: document.updatedAt.getTime(),
      popularityScore: document.popularityScore,
      template: document.template,
      trialImport: Boolean(document.sourceMetadata?.trial),
      schemaVersion: 1,
    };
  }
}

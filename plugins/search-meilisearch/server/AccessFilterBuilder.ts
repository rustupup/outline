import { StatusFilter } from "@shared/types";
import { subtractDate } from "@shared/utils/date";
import type Team from "@server/models/Team";
import type { SearchOptions } from "@server/utils/BaseSearchProvider";

/**
 * User access context used to build the Meilisearch authorization filter.
 * Loaded in parallel from `user.collectionIds()` and `user.groupIds()` at
 * query time.
 */
export interface UserAccessContext {
  /** The team the user belongs to. */
  teamId: string;
  /** The user performing the search. */
  userId: string;
  /** Collections the user can access. */
  collectionIds: string[];
  /** Groups the user belongs to. */
  groupIds: string[];
}

/**
 * Quote a string literal for use in a Meilisearch filter expression using
 * JSON.stringify. This neutralizes quotes, backslashes, and other characters
 * that could break out of the literal.
 *
 * @param value - the raw string to quote.
 * @returns the quoted, escaped literal.
 */
function quote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Deduplicate and sort an id array for deterministic filter output. Returns
 * the original array reference when empty so callers can detect emptiness
 * without allocating.
 *
 * @param ids - the id array to normalize.
 * @returns a sorted, de-duplicated copy, or the empty input.
 */
function normalizeIds(ids: string[]): string[] {
  if (ids.length === 0) {
    return ids;
  }
  return Array.from(new Set(ids)).sort();
}

/**
 * Format an `IN [...]` clause. Returns an empty string when the input is
 * empty so the caller can skip emitting a vacuous clause.
 *
 * @param field - the filterable attribute name.
 * @param ids - the id array.
 * @returns `field IN ["a", "b"]` or "" when ids is empty.
 */
function inClause(field: string, ids: string[]): string {
  const normalized = normalizeIds(ids);
  if (normalized.length === 0) {
    return "";
  }
  return `${field} IN [${normalized.map(quote).join(", ")}]`;
}

/**
 * Build the Meilisearch filter expression for a user-scoped search.
 *
 * The filter always enforces team scope, excludes deleted/template/trial
 * documents, and gates access via collection membership, direct user/group
 * membership, or own uncollected drafts. Additional API filters (collectionId,
 * documentIds, collaboratorIds, dateFilter, statusFilter) are ANDed onto the
 * base authorization clause.
 */
export class AccessFilterBuilder {
  /**
   * @param now - clock used to calculate date filter thresholds.
   */
  public constructor(private readonly now: () => Date = () => new Date()) {}

  /**
   * Build the filter for a user search.
   *
   * @param access - the user's access context.
   * @param options - the search options.
   * @returns a Meilisearch filter string.
   */
  public buildForUser(
    access: UserAccessContext,
    options: SearchOptions
  ): string {
    const clauses: string[] = [];

    clauses.push(`teamId = ${quote(access.teamId)}`);
    clauses.push("deletedAt IS NULL");
    clauses.push("template = false");
    clauses.push("trialImport = false");

    // Authorization OR group: collection OR direct user OR direct group OR
    // own uncollected draft. Each branch is only emitted when it can match.
    const orBranches: string[] = [];

    const collectionClause = inClause("collectionId", access.collectionIds);
    if (collectionClause) {
      orBranches.push(collectionClause);
    }

    orBranches.push(`directUserIds = ${quote(access.userId)}`);

    const groupClause = inClause("directGroupIds", access.groupIds);
    if (groupClause) {
      orBranches.push(groupClause);
    }

    orBranches.push(
      `(collectionId IS NULL AND createdById = ${quote(access.userId)} AND publishedAt IS NULL)`
    );

    clauses.push(`(${orBranches.join(" OR ")})`);

    // Additional API filters.
    if (options.collectionId) {
      clauses.push(`collectionId = ${quote(options.collectionId)}`);
    }

    if (options.documentIds) {
      const docClause = inClause("id", options.documentIds);
      clauses.push(docClause || "id IS NULL");
    }

    if (options.collaboratorIds && options.collaboratorIds.length > 0) {
      for (const collaboratorId of normalizeIds(options.collaboratorIds)) {
        clauses.push(`collaboratorIds = ${quote(collaboratorId)}`);
      }
    }

    if (options.dateFilter) {
      clauses.push(
        `updatedAt > ${subtractDate(this.now(), options.dateFilter).getTime()}`
      );
    }

    const statusClauses = this.buildStatusClauses(
      options.statusFilter,
      access.userId
    );
    if (statusClauses) {
      clauses.push(statusClauses);
    }

    return clauses.join(" AND ");
  }

  /**
   * Build the filter for a team-scoped (share) search. Team searches always
   * require published, non-archaged documents.
   *
   * @param team - the team to search within.
   * @param options - the search options.
   * @returns a Meilisearch filter string.
   */
  public buildForTeam(team: Team, options: SearchOptions): string {
    const clauses: string[] = [];

    clauses.push(`teamId = ${quote(team.id)}`);
    clauses.push("deletedAt IS NULL");
    clauses.push("template = false");
    clauses.push("trialImport = false");
    clauses.push("publishedAt IS NOT NULL");
    clauses.push("archivedAt IS NULL");

    if (options.collectionId) {
      clauses.push(`collectionId = ${quote(options.collectionId)}`);
    }

    if (options.documentIds) {
      const docClause = inClause("id", options.documentIds);
      clauses.push(docClause || "id IS NULL");
    }

    if (options.dateFilter) {
      clauses.push(
        `updatedAt > ${subtractDate(this.now(), options.dateFilter).getTime()}`
      );
    }

    return clauses.join(" AND ");
  }

  /**
   * Build the status filter clause matching PostgreSQL provider behavior.
   *
   * - Published: publishedAt IS NOT NULL AND archivedAt IS NULL
   * - Draft: publishedAt IS NULL AND archivedAt IS NULL AND (createdById = user OR direct membership)
   * - Archived: archivedAt IS NOT NULL
   *
   * Multiple statuses are ORed together. Returns an empty string when no
   * status filter is requested.
   *
   * @param statusFilter - the requested statuses.
   * @param userId - the current user (for draft ownership).
   * @returns a parenthesized status clause, or "".
   */
  private buildStatusClauses(
    statusFilter: StatusFilter[] | undefined,
    userId: string
  ): string {
    if (!statusFilter || statusFilter.length === 0) {
      return "";
    }

    const branches: string[] = [];

    if (statusFilter.includes(StatusFilter.Published)) {
      branches.push("(publishedAt IS NOT NULL AND archivedAt IS NULL)");
    }

    if (statusFilter.includes(StatusFilter.Draft)) {
      branches.push(
        `(publishedAt IS NULL AND archivedAt IS NULL AND (createdById = ${quote(userId)} OR directUserIds = ${quote(userId)}))`
      );
    }

    if (statusFilter.includes(StatusFilter.Archived)) {
      branches.push("(archivedAt IS NOT NULL)");
    }

    if (branches.length === 0) {
      return "";
    }

    return `(${branches.join(" OR ")})`;
  }
}

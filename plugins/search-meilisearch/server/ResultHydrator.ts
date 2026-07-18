import { map } from "es-toolkit/compat";
import type { SearchResponse } from "meilisearch";
import Document from "@server/models/Document";
import type User from "@server/models/User";
import type { SearchResponse as ProviderSearchResponse } from "@server/utils/BaseSearchProvider";
import type { MeilisearchDocumentRecord } from "./types";

/**
 * Options controlling context extraction during hydration.
 */
export interface HydrateOptions {
  /** When false (e.g. no query), omit the context field from results. */
  withContext?: boolean;
}

/** A single Meilisearch hit with the fields the hydrator consumes. */
interface HydratableHit {
  id: string;
  _formatted?: { text?: string };
  _rankingScore?: number;
}

/**
 * Sanitize the `_formatted.text` snippet returned by Meilisearch so only the
 * `<b>` and `</b>` highlight tags survive. All other HTML is escaped, which
 * prevents reflected XSS when the snippet is rendered as HTML by the client.
 *
 * Meilisearch only ever emits `<b>` tags when configured with
 * `highlightPreTag="<b>"` and `highlightPostTag="</b>"`, but this function
 * defends against an engine misconfiguration or a tampered index.
 *
 * @param text - the raw `_formatted.text` from Meilisearch.
 * @returns the sanitized snippet, or undefined when input is absent.
 */
function sanitizeSnippet(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  // Replace every `<b>` and `</b>` with a placeholder, escape all other HTML,
  // then restore the placeholders. This keeps the highlight tags while
  // neutralizing any other markup the engine might have emitted.
  const OPEN = "\u0000B_OPEN\u0000";
  const CLOSE = "\u0000B_CLOSE\u0000";
  const staged = text.replace(/<b>/g, OPEN).replace(/<\/b>/g, CLOSE);
  const escaped = staged
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(new RegExp(OPEN, "g"), "<b>")
    .replace(new RegExp(CLOSE, "g"), "</b>");
}

/**
 * Extract a finite ranking score from a hit, defaulting to 0 when the score
 * is missing or non-finite.
 *
 * @param hit - the Meilisearch hit.
 * @returns a finite ranking number.
 */
function rankingOf(hit: HydratableHit): number {
  const score = hit._rankingScore;
  if (typeof score === "number" && Number.isFinite(score)) {
    return score;
  }
  return 0;
}

/**
 * Hydrates Meilisearch search hits into the provider {@link ProviderSearchResponse}
 * shape by batch-loading full Document rows from PostgreSQL, reordering them
 * by hit order, and extracting a sanitized context snippet.
 *
 * PostgreSQL remains the source of truth for document content and
 * authorization: stale or unauthorized hits are silently omitted.
 */
export class ResultHydrator {
  /**
   * Hydrate hits for a user search. Uses
   * `Document.withMembershipScope(user.id, { includeDrafts: true })` so the
   * final authorization check happens at load time.
   *
   * @param user - the user performing the search.
   * @param response - the raw Meilisearch search response.
   * @param options - hydration options.
   * @returns the provider search response.
   */
  public async hydrateForUser(
    user: User,
    response: SearchResponse<MeilisearchDocumentRecord>,
    options: HydrateOptions = {}
  ): Promise<ProviderSearchResponse> {
    const hits = response.hits as unknown as HydratableHit[];
    const ids = hits.map((h) => h.id);

    if (ids.length === 0) {
      return {
        results: [],
        total: extractTotal(response),
      };
    }

    const documents = await Document.withMembershipScope(user.id, {
      includeDrafts: true,
    }).findAll({
      where: {
        teamId: user.teamId,
        id: ids,
      },
    });

    return this.buildResponse(hits, documents, options, extractTotal(response));
  }

  /**
   * Hydrate hits for a team-scoped (share) search. Loads documents without
   * the membership scope since the share filter already restricts the
   * accessible tree.
   *
   * @param teamId - the team id to load within.
   * @param response - the raw Meilisearch search response.
   * @param options - hydration options.
   * @returns the provider search response.
   */
  public async hydrateForTeam(
    teamId: string,
    response: SearchResponse<MeilisearchDocumentRecord>,
    options: HydrateOptions = {}
  ): Promise<ProviderSearchResponse> {
    const hits = response.hits as unknown as HydratableHit[];
    const ids = hits.map((h) => h.id);

    if (ids.length === 0) {
      return {
        results: [],
        total: extractTotal(response),
      };
    }

    const documents = await Document.findAll({
      where: {
        teamId,
        id: ids,
      },
    });

    return this.buildResponse(hits, documents, options, extractTotal(response));
  }

  /**
   * Build the provider response from hits and loaded documents, reordering
   * documents by hit order and omitting stale/unauthorized ids.
   */
  private buildResponse(
    hits: HydratableHit[],
    documents: Document[],
    options: HydrateOptions,
    total: number
  ): ProviderSearchResponse {
    const withContext = options.withContext ?? true;

    return {
      results: map(hits, (hit) => {
        const document = documents.find((d) => d.id === hit.id);
        if (!document) {
          return null;
        }
        const result: {
          ranking: number;
          context?: string;
          document: Document;
        } = {
          ranking: rankingOf(hit),
          context: withContext
            ? sanitizeSnippet(hit._formatted?.text)
            : undefined,
          document,
        };
        return result;
      }).filter(
        (r): r is { ranking: number; context?: string; document: Document } =>
          r !== null
      ),
      total,
    };
  }
}

/**
 * Extract a total hit count from a Meilisearch response, preferring
 * `estimatedTotalHits` (infinite pagination) and falling back to `totalHits`
 * (finite pagination) or the hit count.
 *
 * @param response - the Meilisearch search response.
 * @returns the total hit count.
 */
function extractTotal(
  response: SearchResponse<MeilisearchDocumentRecord>
): number {
  const anyResp = response as unknown as {
    estimatedTotalHits?: number;
    totalHits?: number;
    hits: unknown[];
  };
  if (typeof anyResp.estimatedTotalHits === "number") {
    return anyResp.estimatedTotalHits;
  }
  if (typeof anyResp.totalHits === "number") {
    return anyResp.totalHits;
  }
  return anyResp.hits.length;
}

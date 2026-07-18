import { DirectionFilter, SortFilter, type DateFilter } from "@shared/types";
import type { SearchOptions } from "@server/utils/BaseSearchProvider";
import type { SearchParams } from "meilisearch";

/**
 * Input to {@link SearchQueryMapper.buildSearchParams}, combining the API
 * search options with the Meilisearch filter built by AccessFilterBuilder.
 */
export interface SearchQueryInput {
  /** The API search options. */
  options: SearchOptions;
  /** The Meilisearch filter string from AccessFilterBuilder. */
  filter: SearchParams["filter"];
  /** When true, restrict search to title fields only. */
  titleOnly?: boolean;
}

/** Maximum query length accepted by the mapper, matching the PostgreSQL provider. */
const MAX_QUERY_LENGTH = 1000;

/** Default page size when no limit is provided. */
const DEFAULT_LIMIT = 15;

/** Default snippet length in words when no snippetMaxWords is provided. */
const DEFAULT_CROP_LENGTH = 40;

/**
 * Allowed sort fields mapped to their Meilisearch index attribute names.
 * Any sort value not in this set is rejected so an unsupported or malicious
 * field cannot reach the engine.
 */
const SORT_FIELDS: Record<SortFilter, string> = {
  [SortFilter.CreatedAt]: "createdAt",
  [SortFilter.UpdatedAt]: "updatedAt",
  [SortFilter.Title]: "title",
};

/**
 * Map a sort direction to the Meilisearch `asc`/`desc` suffix.
 *
 * @param direction - the API direction.
 * @returns `"asc"` or `"desc"`.
 */
function directionSuffix(direction: DirectionFilter | undefined): string {
  return direction === DirectionFilter.ASC ? "asc" : "desc";
}

/**
 * Maps API search options to Meilisearch {@link SearchParams}. Centralizing
 * this keeps the provider thin and makes the mapping testable without a
 * running engine.
 */
export class SearchQueryMapper {
  /**
   * Build Meilisearch search parameters from the API options and filter.
   *
   * @param input - the search query input.
   * @returns Meilisearch search parameters.
   * @throws when an unsupported sort field is requested.
   */
  public buildSearchParams(input: SearchQueryInput): SearchParams {
    const { options, filter, titleOnly } = input;

    const q =
      options.query !== undefined
        ? options.query.slice(0, MAX_QUERY_LENGTH)
        : undefined;

    const params: SearchParams = {
      q,
      offset: options.offset ?? 0,
      limit: options.limit ?? DEFAULT_LIMIT,
      filter,
      showRankingScore: true,
      attributesToCrop: ["text"],
      cropLength: options.snippetMaxWords ?? DEFAULT_CROP_LENGTH,
      attributesToHighlight: ["text"],
      highlightPreTag: "<b>",
      highlightPostTag: "</b>",
    };

    if (titleOnly) {
      params.attributesToSearchOn = ["title", "previousTitles"];
    }

    if (options.sort) {
      const field = SORT_FIELDS[options.sort];
      if (!field) {
        throw new Error(`Unsupported sort field: ${options.sort}`);
      }
      params.sort = [`${field}:${directionSuffix(options.direction)}`];
    }

    return params;
  }
}

// Reference DateFilter so the type stays in the dependency graph for callers
// who pass it through SearchOptions.dateFilter.
void (null as unknown as DateFilter);

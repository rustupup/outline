import { DirectionFilter, SortFilter, type DateFilter } from "@shared/types";
import type { SearchOptions } from "@server/utils/BaseSearchProvider";
import { SearchQueryMapper } from "./SearchQueryMapper";

const mapper = new SearchQueryMapper();

const baseOptions: SearchOptions = { query: "test" };

describe("SearchQueryMapper", () => {
  describe("buildSearchParams", () => {
    it("maps query to q", () => {
      const params = mapper.buildSearchParams({
        options: { query: "hello world" },
        filter: 'teamId = "t1"',
      });
      expect(params.q).toBe("hello world");
    });

    it("truncates query to 1000 characters", () => {
      const long = "a".repeat(2000);
      const params = mapper.buildSearchParams({
        options: { query: long },
        filter: "",
      });
      expect(params.q?.length).toBe(1000);
    });

    it("defaults offset to 0", () => {
      const params = mapper.buildSearchParams({
        options: baseOptions,
        filter: "",
      });
      expect(params.offset).toBe(0);
    });

    it("defaults limit to 15", () => {
      const params = mapper.buildSearchParams({
        options: baseOptions,
        filter: "",
      });
      expect(params.limit).toBe(15);
    });

    it("passes through offset and limit", () => {
      const params = mapper.buildSearchParams({
        options: { query: "x", offset: 30, limit: 5 },
        filter: "",
      });
      expect(params.offset).toBe(30);
      expect(params.limit).toBe(5);
    });

    it("passes the filter through", () => {
      const filter = 'teamId = "t1" AND deletedAt IS NULL';
      const params = mapper.buildSearchParams({
        options: baseOptions,
        filter,
      });
      expect(params.filter).toBe(filter);
    });

    it("maps updatedAt sort to a single sort entry", () => {
      const params = mapper.buildSearchParams({
        options: {
          query: "x",
          sort: SortFilter.UpdatedAt,
          direction: DirectionFilter.DESC,
        },
        filter: "",
      });
      expect(params.sort).toEqual(["updatedAt:desc"]);
    });

    it("maps createdAt sort", () => {
      const params = mapper.buildSearchParams({
        options: {
          query: "x",
          sort: SortFilter.CreatedAt,
          direction: DirectionFilter.ASC,
        },
        filter: "",
      });
      expect(params.sort).toEqual(["createdAt:asc"]);
    });

    it("maps title sort", () => {
      const params = mapper.buildSearchParams({
        options: {
          query: "x",
          sort: SortFilter.Title,
          direction: DirectionFilter.ASC,
        },
        filter: "",
      });
      expect(params.sort).toEqual(["title:asc"]);
    });

    it("rejects an unsupported sort field", () => {
      expect(() =>
        mapper.buildSearchParams({
          options: {
            query: "x",
            sort: "malicious" as SortFilter,
            direction: DirectionFilter.ASC,
          },
          filter: "",
        })
      ).toThrow();
    });

    it("sets attributesToSearchOn to title fields when titleOnly", () => {
      const params = mapper.buildSearchParams({
        options: baseOptions,
        filter: "",
        titleOnly: true,
      });
      expect(params.attributesToSearchOn).toEqual(["title", "previousTitles"]);
    });

    it("sets crop and highlight attributes for document search", () => {
      const params = mapper.buildSearchParams({
        options: baseOptions,
        filter: "",
      });
      expect(params.attributesToCrop).toEqual(["text"]);
      expect(params.attributesToHighlight).toEqual(["text"]);
    });

    it("uses <b> and </b> highlight tags", () => {
      const params = mapper.buildSearchParams({
        options: baseOptions,
        filter: "",
      });
      expect(params.highlightPreTag).toBe("<b>");
      expect(params.highlightPostTag).toBe("</b>");
    });

    it("enables showRankingScore", () => {
      const params = mapper.buildSearchParams({
        options: baseOptions,
        filter: "",
      });
      expect(params.showRankingScore).toBe(true);
    });

    it("defaults cropLength to 40", () => {
      const params = mapper.buildSearchParams({
        options: baseOptions,
        filter: "",
      });
      expect(params.cropLength).toBe(40);
    });

    it("uses snippetMaxWords as cropLength when provided", () => {
      const params = mapper.buildSearchParams({
        options: { query: "x", snippetMaxWords: 20 },
        filter: "",
      });
      expect(params.cropLength).toBe(20);
    });

    it("returns undefined q when no query provided", () => {
      const params = mapper.buildSearchParams({
        options: {},
        filter: "",
      });
      expect(params.q).toBeUndefined();
    });
  });

  describe("dateFilter sanity (filter is built by AccessFilterBuilder)", () => {
    it("does not throw on a known date filter value", () => {
      const df: DateFilter = "day" as DateFilter;
      expect(() =>
        mapper.buildSearchParams({
          options: { query: "x", dateFilter: df },
          filter: "",
        })
      ).not.toThrow();
    });
  });
});

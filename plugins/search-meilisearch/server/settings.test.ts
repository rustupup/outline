import env from "@server/env";
import {
  collectionIndexSettings,
  documentIndexSettings,
  stableCollectionIndexName,
  stableDocumentIndexName,
  versionedCollectionIndexName,
  versionedDocumentIndexName,
} from "./settings";

describe("Meilisearch index settings", () => {
  describe("documentIndexSettings", () => {
    it("searches only title, previousTitles, and text", () => {
      expect(documentIndexSettings.searchableAttributes).toEqual([
        "title",
        "previousTitles",
        "text",
      ]);
    });

    it("displays only id, title, and text", () => {
      expect(documentIndexSettings.displayedAttributes).toEqual([
        "id",
        "title",
        "text",
      ]);
    });

    it("makes all ACL and timestamp fields filterable", () => {
      expect(documentIndexSettings.filterableAttributes).toEqual([
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
      ]);
    });

    it("makes createdAt, updatedAt, title, and popularityScore sortable", () => {
      expect(documentIndexSettings.sortableAttributes).toEqual([
        "createdAt",
        "updatedAt",
        "title",
        "popularityScore",
      ]);
    });

    it("applies the popularity boost as the final ranking rule", () => {
      expect(documentIndexSettings.rankingRules).toEqual([
        "words",
        "typo",
        "proximity",
        "attribute",
        "sort",
        "exactness",
        "popularityScore:desc",
      ]);
    });

    it("caps total hits at 10000", () => {
      expect(documentIndexSettings.pagination).toEqual({ maxTotalHits: 10000 });
    });
  });

  describe("collectionIndexSettings", () => {
    it("searches only name and description", () => {
      expect(collectionIndexSettings.searchableAttributes).toEqual([
        "name",
        "description",
      ]);
    });

    it("displays only id and name", () => {
      expect(collectionIndexSettings.displayedAttributes).toEqual([
        "id",
        "name",
      ]);
    });

    it("makes teamId, id, archivedAt, and deletedAt filterable", () => {
      expect(collectionIndexSettings.filterableAttributes).toEqual([
        "teamId",
        "id",
        "archivedAt",
        "deletedAt",
      ]);
    });

    it("makes name and updatedAt sortable", () => {
      expect(collectionIndexSettings.sortableAttributes).toEqual([
        "name",
        "updatedAt",
      ]);
    });

    it("caps total hits at 10000", () => {
      expect(collectionIndexSettings.pagination).toEqual({
        maxTotalHits: 10000,
      });
    });
  });

  describe("stable index names", () => {
    it("uses the configured prefix for the stable document index", () => {
      env.MEILISEARCH_INDEX_PREFIX = "outline";
      expect(stableDocumentIndexName()).toBe("outline_documents");
    });

    it("uses the configured prefix for the stable collection index", () => {
      env.MEILISEARCH_INDEX_PREFIX = "outline";
      expect(stableCollectionIndexName()).toBe("outline_collections");
    });

    it("respects a custom prefix", () => {
      env.MEILISEARCH_INDEX_PREFIX = "staging";
      expect(stableDocumentIndexName()).toBe("staging_documents");
      expect(stableCollectionIndexName()).toBe("staging_collections");
      env.MEILISEARCH_INDEX_PREFIX = "outline";
    });
  });

  describe("versioned index names", () => {
    const fixedTimestamp = "20260718T120000Z";

    it("includes schema version and timestamp for the document index", () => {
      env.MEILISEARCH_INDEX_PREFIX = "outline";
      expect(versionedDocumentIndexName(fixedTimestamp)).toBe(
        "outline_documents_v1_20260718T120000Z"
      );
    });

    it("includes schema version and timestamp for the collection index", () => {
      env.MEILISEARCH_INDEX_PREFIX = "outline";
      expect(versionedCollectionIndexName(fixedTimestamp)).toBe(
        "outline_collections_v1_20260718T120000Z"
      );
    });

    it("respects a custom prefix for versioned names", () => {
      env.MEILISEARCH_INDEX_PREFIX = "staging";
      expect(versionedDocumentIndexName(fixedTimestamp)).toBe(
        "staging_documents_v1_20260718T120000Z"
      );
      expect(versionedCollectionIndexName(fixedTimestamp)).toBe(
        "staging_collections_v1_20260718T120000Z"
      );
      env.MEILISEARCH_INDEX_PREFIX = "outline";
    });
  });
});

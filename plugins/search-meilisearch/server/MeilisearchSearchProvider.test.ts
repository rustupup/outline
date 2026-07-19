import { vi } from "vitest";
import { SearchableModel } from "@shared/types";
import {
  buildCollection,
  buildDocument,
  buildShare,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import type { MeilisearchClient } from "./client";
import type { MeilisearchDocumentRecord } from "./types";
import { MeilisearchSearchProvider } from "./MeilisearchSearchProvider";

function fakeIndex(searchImpl: (q: string) => unknown) {
  return {
    search: vi.fn((q: string, _options?: unknown) =>
      Promise.resolve(searchImpl(q))
    ),
    addDocuments: vi.fn().mockResolvedValue({ taskUid: 1 }),
    updateDocuments: vi.fn().mockResolvedValue({ taskUid: 1 }),
    deleteDocument: vi.fn().mockResolvedValue({ taskUid: 1 }),
    updateSettings: vi.fn().mockResolvedValue({ taskUid: 1 }),
    getStats: vi.fn().mockResolvedValue({ numberOfDocuments: 0 }),
  };
}

function fakeClient(
  indexImpl: ReturnType<typeof fakeIndex>
): MeilisearchClient {
  return {
    index: vi.fn(() => indexImpl),
    createIndex: vi.fn().mockResolvedValue({ taskUid: 1 }),
    deleteIndex: vi.fn().mockResolvedValue({ taskUid: 1 }),
    swapIndexes: vi.fn().mockResolvedValue({ taskUid: 1 }),
    health: vi.fn().mockResolvedValue({ status: "available" }),
    waitForTask: vi.fn().mockResolvedValue({ status: "succeeded" }),
  } as unknown as MeilisearchClient;
}

describe("MeilisearchSearchProvider", () => {
  describe("#searchForUser", () => {
    it("calls the stable document index with query and parameters", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const document = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Provider contract",
      });

      const indexImpl = fakeIndex(() => ({
        hits: [
          {
            id: document.id,
            _formatted: { text: "Provider <b>contract</b>" },
            _rankingScore: 0.95,
          },
        ],
        processingTimeMs: 0,
        query: "Provider",
        estimatedTotalHits: 1,
      }));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      const result = await provider.searchForUser(user, { query: "Provider" });

      expect(client.index).toHaveBeenCalledWith("outline_documents");
      expect(indexImpl.search).toHaveBeenCalledTimes(1);
      const [q, params] = indexImpl.search.mock.calls[0] as unknown as [
        string,
        { filter: string; showRankingScore: boolean },
      ];
      expect(q).toBe("Provider");
      expect(params.filter).toContain(`teamId = ${JSON.stringify(team.id)}`);
      expect(params.showRankingScore).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].document.id).toBe(document.id);
      expect(result.results[0].ranking).toBe(0.95);
      expect(result.results[0].context).toContain("<b>contract</b>");
      expect(result.total).toBe(1);
    });

    it("returns an empty response when no hits", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });

      const indexImpl = fakeIndex(() => ({
        hits: [],
        processingTimeMs: 0,
        query: "missing",
        estimatedTotalHits: 0,
      }));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      const result = await provider.searchForUser(user, { query: "missing" });

      expect(result.results).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("throws SearchServiceUnavailableError when the SDK fails", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });

      const indexImpl = {
        search: vi.fn(() => Promise.reject(new Error("timeout"))),
        addDocuments: vi.fn(),
        updateDocuments: vi.fn(),
        deleteDocument: vi.fn(),
        updateSettings: vi.fn(),
        getStats: vi.fn(),
      };
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      await expect(
        provider.searchForUser(user, { query: "x" })
      ).rejects.toMatchObject({
        // http-errors attaches status to the error.
        status: 503,
      });
    });

    it("loads user access facts once per search", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Access facts",
      });

      const indexImpl = fakeIndex(() => ({
        hits: [],
        processingTimeMs: 0,
        query: "",
        estimatedTotalHits: 0,
      }));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      const spy = vi.spyOn(user, "collectionIds");
      await provider.searchForUser(user, { query: "access" });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("#searchForTeam", () => {
    it("rejects searches without a share constraint", async () => {
      const team = await buildTeam();
      const provider = new MeilisearchSearchProvider(
        fakeClient(fakeIndex(() => ({})))
      );

      await expect(
        provider.searchForTeam(team, { query: "x" })
      ).rejects.toThrow(/share/);
    });

    it("searches within a document share scope", async () => {
      const team = await buildTeam();
      const owner = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: owner.id,
        permission: null,
      });
      const document = await buildDocument({
        teamId: team.id,
        userId: owner.id,
        collectionId: collection.id,
        title: "Share scope",
      });
      const child = await buildDocument({
        teamId: team.id,
        userId: owner.id,
        collectionId: collection.id,
        parentDocumentId: document.id,
        title: "Share child",
      });
      const unrelated = await buildDocument({
        teamId: team.id,
        userId: owner.id,
        collectionId: collection.id,
        title: "Unrelated document",
      });
      const share = await buildShare({
        teamId: team.id,
        userId: owner.id,
        documentId: document.id,
        includeChildDocuments: true,
      });

      const indexImpl = fakeIndex(() => ({
        hits: [
          {
            id: document.id,
            _formatted: { text: "Share <b>scope</b>" },
            _rankingScore: 1,
          },
        ],
        processingTimeMs: 0,
        query: "scope",
        estimatedTotalHits: 1,
      }));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      const result = await provider.searchForTeam(team, {
        query: "scope",
        share,
        collectionId: collection.id,
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].document.id).toBe(document.id);
      const [, params] = indexImpl.search.mock.calls[0] as unknown as [
        string,
        { filter: string },
      ];
      expect(params.filter).toContain(document.id);
      expect(params.filter).toContain(child.id);
      expect(params.filter).not.toContain(unrelated.id);
    });
  });

  describe("#searchTitlesForUser", () => {
    it("searches the document index with title-only scope", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const document = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Title search",
      });

      const indexImpl = fakeIndex(() => ({
        hits: [{ id: document.id, _formatted: { text: "" }, _rankingScore: 1 }],
        processingTimeMs: 0,
        query: "Title",
        estimatedTotalHits: 1,
      }));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      const docs = await provider.searchTitlesForUser(user, { query: "Title" });

      expect(docs).toHaveLength(1);
      expect(docs[0].id).toBe(document.id);
      const params = indexImpl.search.mock.calls[0]?.[1] as unknown as
        | {
            attributesToSearchOn?: string[];
          }
        | undefined;
      expect(params?.attributesToSearchOn).toEqual(["title", "previousTitles"]);
    });

    it("returns an empty array when no hits", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });

      const indexImpl = fakeIndex(() => ({
        hits: [],
        processingTimeMs: 0,
        query: "missing",
        estimatedTotalHits: 0,
      }));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      const docs = await provider.searchTitlesForUser(user, {
        query: "missing",
      });
      expect(docs).toEqual([]);
    });
  });

  describe("#searchCollectionsForUser", () => {
    it("searches the collection index and hydrates collections", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
        name: "Engineering",
      });

      const collectionIndexImpl = {
        search: vi.fn(() =>
          Promise.resolve({
            hits: [{ id: collection.id }],
            processingTimeMs: 0,
            query: "Eng",
            estimatedTotalHits: 1,
          })
        ),
        addDocuments: vi.fn(),
        updateDocuments: vi.fn(),
        deleteDocument: vi.fn(),
        updateSettings: vi.fn(),
        getStats: vi.fn(),
      };
      const client: MeilisearchClient = {
        index: vi.fn((uid: string) => {
          if (uid === "outline_collections") {
            return collectionIndexImpl;
          }
          return fakeIndex(() => ({}));
        }),
        createIndex: vi.fn().mockResolvedValue({ taskUid: 1 }),
        deleteIndex: vi.fn().mockResolvedValue({ taskUid: 1 }),
        swapIndexes: vi.fn().mockResolvedValue({ taskUid: 1 }),
        health: vi.fn().mockResolvedValue({ status: "available" }),
        waitForTask: vi.fn().mockResolvedValue({ status: "succeeded" }),
      } as unknown as MeilisearchClient;

      const provider = new MeilisearchSearchProvider(client);
      const results = await provider.searchCollectionsForUser(user, {
        query: "Eng",
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(collection.id);
    });

    it("returns empty when user has no accessible collections", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });

      const indexImpl = fakeIndex(() => ({}));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      vi.spyOn(user, "collectionIds").mockResolvedValue([]);
      const results = await provider.searchCollectionsForUser(user, {
        query: "x",
      });
      expect(results).toEqual([]);
    });
  });

  describe("#index", () => {
    it("upserts a document into the document index", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const document = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Index me",
      });

      const indexImpl = fakeIndex(() => ({}));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      await provider.index(SearchableModel.Document, document);

      expect(client.index).toHaveBeenCalledWith("outline_documents");
      expect(indexImpl.addDocuments).toHaveBeenCalledTimes(1);
      const [records] = indexImpl.addDocuments.mock.calls[0] as [
        MeilisearchDocumentRecord[],
      ];
      expect(records[0].id).toBe(document.id);
      expect(records[0].title).toBe("Index me");
      expect(client.waitForTask).toHaveBeenCalledTimes(1);
    });

    it("upserts a collection into the collection index", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
        name: "Collection index",
      });

      const indexImpl = fakeIndex(() => ({}));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      await provider.index(SearchableModel.Collection, collection);

      expect(client.index).toHaveBeenCalledWith("outline_collections");
      expect(indexImpl.addDocuments).toHaveBeenCalledTimes(1);
    });

    it("is a no-op for comments with zero client calls", async () => {
      const indexImpl = fakeIndex(() => ({}));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      await provider.index(SearchableModel.Comment, {} as never);

      expect(client.index).not.toHaveBeenCalled();
      expect(indexImpl.addDocuments).not.toHaveBeenCalled();
    });
  });

  describe("#remove", () => {
    it("deletes a document from the document index", async () => {
      const indexImpl = fakeIndex(() => ({}));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      await provider.remove(SearchableModel.Document, "doc-1", "team-1");

      expect(client.index).toHaveBeenCalledWith("outline_documents");
      expect(indexImpl.deleteDocument).toHaveBeenCalledWith("doc-1");
      expect(client.waitForTask).toHaveBeenCalledTimes(1);
    });

    it("is a no-op for comments", async () => {
      const indexImpl = fakeIndex(() => ({}));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      await provider.remove(SearchableModel.Comment, "c1", "t1");

      expect(indexImpl.deleteDocument).not.toHaveBeenCalled();
    });
  });

  describe("#updateMetadata", () => {
    it("reloads and re-indexes an existing document", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const document = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Reload",
      });

      const indexImpl = fakeIndex(() => ({}));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      await provider.updateMetadata(SearchableModel.Document, document.id, {});

      expect(indexImpl.addDocuments).toHaveBeenCalledTimes(1);
    });

    it("deletes the index entry when the document is absent", async () => {
      const indexImpl = fakeIndex(() => ({}));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      await provider.updateMetadata(
        SearchableModel.Document,
        "00000000-0000-0000-0000-000000000000",
        {}
      );

      expect(indexImpl.deleteDocument).toHaveBeenCalledWith(
        "00000000-0000-0000-0000-000000000000"
      );
    });

    it("is a no-op for comments", async () => {
      const indexImpl = fakeIndex(() => ({}));
      const client = fakeClient(indexImpl);
      const provider = new MeilisearchSearchProvider(client);

      await provider.updateMetadata(SearchableModel.Comment, "c1", {});

      expect(indexImpl.addDocuments).not.toHaveBeenCalled();
      expect(indexImpl.deleteDocument).not.toHaveBeenCalled();
    });
  });
});

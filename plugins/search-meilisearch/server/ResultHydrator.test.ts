import {
  buildCollection,
  buildDocument,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import type { SearchResponse } from "meilisearch";
import type { MeilisearchDocumentRecord } from "./types";
import { ResultHydrator } from "./ResultHydrator";

interface FakeHit {
  id: string;
  _formatted: { text: string };
  _rankingScore: number;
}

function fakeSearchResponse(
  hits: FakeHit[]
): SearchResponse<MeilisearchDocumentRecord> {
  return {
    hits: hits as unknown as SearchResponse<MeilisearchDocumentRecord>["hits"],
    processingTimeMs: 0,
    query: "",
    estimatedTotalHits: hits.length,
  } as SearchResponse<MeilisearchDocumentRecord>;
}

describe("ResultHydrator", () => {
  describe("hydrateForUser", () => {
    it("reorders database results by hit order", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const docA = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Alpha",
      });
      const docB = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Beta",
      });

      const hits: FakeHit[] = [
        {
          id: docB.id,
          _formatted: { text: "Beta <b>match</b>" },
          _rankingScore: 0.9,
        },
        {
          id: docA.id,
          _formatted: { text: "Alpha <b>match</b>" },
          _rankingScore: 0.8,
        },
      ];

      const hydrator = new ResultHydrator();
      const result = await hydrator.hydrateForUser(
        user,
        fakeSearchResponse(hits)
      );

      expect(result.results.map((r) => r.document.id)).toEqual([
        docB.id,
        docA.id,
      ]);
      expect(result.results[0].ranking).toBe(0.9);
      expect(result.results[1].ranking).toBe(0.8);
    });

    it("omits stale ids not present in the database", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const doc = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Real",
      });

      const hits: FakeHit[] = [
        { id: doc.id, _formatted: { text: "Real" }, _rankingScore: 1 },
        {
          id: "00000000-0000-0000-0000-000000000000",
          _formatted: { text: "Stale" },
          _rankingScore: 0.5,
        },
      ];

      const hydrator = new ResultHydrator();
      const result = await hydrator.hydrateForUser(
        user,
        fakeSearchResponse(hits)
      );

      expect(result.results).toHaveLength(1);
      expect(result.results[0].document.id).toBe(doc.id);
    });

    it("extracts context from _formatted.text", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const doc = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Context",
      });

      const hits: FakeHit[] = [
        {
          id: doc.id,
          _formatted: { text: "prefix <b>highlighted</b> suffix" },
          _rankingScore: 1,
        },
      ];

      const hydrator = new ResultHydrator();
      const result = await hydrator.hydrateForUser(
        user,
        fakeSearchResponse(hits)
      );

      expect(result.results[0].context).toContain("<b>highlighted</b>");
    });

    it("returns no context when query was absent", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const doc = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "No query",
      });

      const hits: FakeHit[] = [
        {
          id: doc.id,
          _formatted: { text: "no highlight here" },
          _rankingScore: 1,
        },
      ];

      const hydrator = new ResultHydrator();
      const result = await hydrator.hydrateForUser(
        user,
        fakeSearchResponse(hits),
        { withContext: false }
      );

      expect(result.results[0].context).toBeUndefined();
    });

    it("defaults ranking to 0 when _rankingScore is missing", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const doc = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "No score",
      });

      const hits = [
        {
          id: doc.id,
          _formatted: { text: "text" },
        },
      ] as unknown as FakeHit[];

      const hydrator = new ResultHydrator();
      const result = await hydrator.hydrateForUser(
        user,
        fakeSearchResponse(hits)
      );

      expect(result.results[0].ranking).toBe(0);
    });

    it("preserves Chinese text in context", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const doc = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "中文标题",
      });

      const hits: FakeHit[] = [
        {
          id: doc.id,
          _formatted: { text: "这是一段<b>中文</b>高亮内容" },
          _rankingScore: 1,
        },
      ];

      const hydrator = new ResultHydrator();
      const result = await hydrator.hydrateForUser(
        user,
        fakeSearchResponse(hits)
      );

      expect(result.results[0].context).toBe("这是一段<b>中文</b>高亮内容");
    });

    it("strips unexpected HTML tags while keeping <b> tags", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const doc = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Sanitize",
      });

      const hits: FakeHit[] = [
        {
          id: doc.id,
          _formatted: {
            text: "<script>alert(1)</script><b>safe</b><img src=x onerror=alert(1)>",
          },
          _rankingScore: 1,
        },
      ];

      const hydrator = new ResultHydrator();
      const result = await hydrator.hydrateForUser(
        user,
        fakeSearchResponse(hits)
      );

      const context = result.results[0].context ?? "";
      expect(context).toContain("<b>safe</b>");
      // Tags must be escaped so they cannot be parsed as HTML elements.
      expect(context).not.toContain("<script");
      expect(context).not.toContain("<img");
      // The onerror payload appears as escaped text, not as an attribute.
      expect(context).not.toMatch(/<img[^>]*onerror/);
    });

    it("reports total from estimatedTotalHits", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const doc = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Total",
      });

      const response = {
        hits: [
          {
            id: doc.id,
            _formatted: { text: "Total" },
            _rankingScore: 1,
          },
        ],
        processingTimeMs: 0,
        query: "Total",
        estimatedTotalHits: 42,
      } as unknown as SearchResponse<MeilisearchDocumentRecord>;

      const hydrator = new ResultHydrator();
      const result = await hydrator.hydrateForUser(user, response);

      expect(result.total).toBe(42);
    });
  });
});

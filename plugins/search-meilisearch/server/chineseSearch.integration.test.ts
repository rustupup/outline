import { afterAll, beforeAll } from "vitest";
import { Meilisearch } from "meilisearch";
import env from "@server/env";

// Integration test against a real Meilisearch server. Skipped unless
// MEILISEARCH_HOST and MEILISEARCH_API_KEY are configured, so the unit test
// suite remains hermetic.
const host = env.MEILISEARCH_HOST;
const apiKey = env.MEILISEARCH_API_KEY;
const hasServer = Boolean(host && apiKey);

const TEST_PREFIX = `itest_${Date.now()}`;

describe.skipIf(!hasServer)("Meilisearch Chinese search integration", () => {
  let client: Meilisearch;
  let documentIndexUid: string;

  beforeAll(async () => {
    client = new Meilisearch({
      host: host!,
      apiKey: apiKey!,
      timeout: 10000,
    });

    documentIndexUid = `${TEST_PREFIX}_documents`;
    const createTask = await client.createIndex(documentIndexUid, {
      primaryKey: "id",
    });
    await client.tasks.waitForTask(createTask.taskUid, { timeout: 30000 });

    const index = client.index(documentIndexUid);
    const settingsTask = await index.updateSettings({
      searchableAttributes: ["title", "text"],
      filterableAttributes: ["teamId"],
    });
    await client.tasks.waitForTask(settingsTask.taskUid, {
      timeout: 30000,
    });
  });

  afterAll(async () => {
    if (documentIndexUid) {
      try {
        await client.deleteIndex(documentIndexUid);
      } catch {
        // Best-effort cleanup.
      }
    }
  });

  it("indexes and retrieves Chinese documents by term", async () => {
    const index = client.index(documentIndexUid);
    const addTask = await index.addDocuments([
      {
        id: "doc-1",
        teamId: "team-1",
        title: "产品需求文档",
        text: "本文档描述了搜索功能的中文分词与高亮需求。",
      },
      {
        id: "doc-2",
        teamId: "team-1",
        title: "技术架构",
        text: "系统采用 Meilisearch 作为搜索引擎，支持中文与英文混合检索。",
      },
    ]);
    await client.tasks.waitForTask(addTask.taskUid, { timeout: 30000 });

    const response = await index.search("中文", {
      filter: 'teamId = "team-1"',
    });

    expect(response.hits.length).toBeGreaterThanOrEqual(1);
    const ids = response.hits.map((h) => (h as { id: string }).id);
    expect(ids).toContain("doc-2");
  });

  it("highlights Chinese matches with <b> tags", async () => {
    const index = client.index(documentIndexUid);
    const response = await index.search("搜索", {
      attributesToHighlight: ["text"],
      highlightPreTag: "<b>",
      highlightPostTag: "</b>",
    });

    const hit = response.hits[0] as {
      _formatted?: { text?: string };
    };
    expect(hit?._formatted?.text).toContain("<b>");
    expect(hit?._formatted?.text).toContain("</b>");
  });

  it("supports mixed Chinese and English queries", async () => {
    const index = client.index(documentIndexUid);
    const response = await index.search("Meilisearch 中文");
    expect(response.hits.length).toBeGreaterThanOrEqual(1);
  });
});

// Reference host/apiKey so the skip logic is visible to type analysis.
void host;
void apiKey;

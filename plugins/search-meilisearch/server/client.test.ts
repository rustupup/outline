import { vi, expect } from "vitest";
import env from "@server/env";
import { createMeilisearchClient } from "./client";

const originalHost = env.MEILISEARCH_HOST;
const originalApiKey = env.MEILISEARCH_API_KEY;
const originalTimeout = env.MEILISEARCH_TIMEOUT_MS;

describe("createMeilisearchClient", () => {
  beforeEach(() => {
    env.MEILISEARCH_HOST = "http://127.0.0.1:7700";
    env.MEILISEARCH_API_KEY = "master-key";
    env.MEILISEARCH_TIMEOUT_MS = 5000;
  });

  afterEach(() => {
    env.MEILISEARCH_HOST = originalHost;
    env.MEILISEARCH_API_KEY = originalApiKey;
    env.MEILISEARCH_TIMEOUT_MS = originalTimeout;
  });

  it("throws when host is not configured", () => {
    env.MEILISEARCH_HOST = undefined;
    const fakeSdk = vi.fn();
    expect(() => createMeilisearchClient(fakeSdk as never)).toThrow(/host/i);
    expect(fakeSdk).not.toHaveBeenCalled();
  });

  it("throws when API key is not configured", () => {
    env.MEILISEARCH_API_KEY = undefined;
    const fakeSdk = vi.fn();
    expect(() => createMeilisearchClient(fakeSdk as never)).toThrow(/api key/i);
    expect(fakeSdk).not.toHaveBeenCalled();
  });

  it("does not leak the API key in the thrown error message", () => {
    env.MEILISEARCH_HOST = undefined;
    env.MEILISEARCH_API_KEY = "super-secret-key-do-not-leak";
    const fakeSdk = vi.fn();
    try {
      createMeilisearchClient(fakeSdk as never);
      expect.unreachable("expected createMeilisearchClient to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain("super-secret-key-do-not-leak");
    }
  });

  it("passes host, apiKey, and timeout to the Meilisearch SDK constructor", () => {
    env.MEILISEARCH_HOST = "http://127.0.0.1:7700";
    env.MEILISEARCH_API_KEY = "master-key";
    env.MEILISEARCH_TIMEOUT_MS = 7500;

    const fakeSdk = vi.fn(function () {
      return {
        index: vi.fn(),
        createIndex: vi.fn(),
        deleteIndex: vi.fn(),
        swapIndexes: vi.fn(),
        health: vi.fn(),
      };
    });

    createMeilisearchClient(fakeSdk as never);

    expect(fakeSdk).toHaveBeenCalledTimes(1);
    expect(fakeSdk).toHaveBeenCalledWith({
      host: "http://127.0.0.1:7700",
      apiKey: "master-key",
      timeout: 7500,
    });
  });

  it("returns a client that can look up an index by name", () => {
    const fakeIndex = { search: vi.fn() };
    const fakeSdk = vi.fn(function () {
      return {
        index: vi.fn(() => fakeIndex),
        createIndex: vi.fn(),
        deleteIndex: vi.fn(),
        swapIndexes: vi.fn(),
        health: vi.fn(),
      };
    });

    const client = createMeilisearchClient(fakeSdk as never);
    const idx = client.index("outline_documents");

    expect(idx).toBe(fakeIndex);
  });
});

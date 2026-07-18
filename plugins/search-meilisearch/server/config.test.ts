import { validate } from "class-validator";
import env from "@server/env";

describe("Meilisearch environment configuration", () => {
  const originalHost = env.MEILISEARCH_HOST;
  const originalApiKey = env.MEILISEARCH_API_KEY;
  const originalPrefix = env.MEILISEARCH_INDEX_PREFIX;
  const originalTimeout = env.MEILISEARCH_TIMEOUT_MS;
  const originalProvider = env.SEARCH_PROVIDER;

  afterEach(() => {
    env.MEILISEARCH_HOST = originalHost;
    env.MEILISEARCH_API_KEY = originalApiKey;
    env.MEILISEARCH_INDEX_PREFIX = originalPrefix;
    env.MEILISEARCH_TIMEOUT_MS = originalTimeout;
    env.SEARCH_PROVIDER = originalProvider;
  });

  it("defaults SEARCH_PROVIDER to postgres", () => {
    expect(env.SEARCH_PROVIDER).toBe("postgres");
  });

  it("exposes MEILISEARCH_HOST as an optional string", () => {
    env.MEILISEARCH_HOST = "http://localhost:7700";
    expect(env.MEILISEARCH_HOST).toBe("http://localhost:7700");
  });

  it("exposes MEILISEARCH_API_KEY as an optional string", () => {
    env.MEILISEARCH_API_KEY = "secret-key-value";
    expect(env.MEILISEARCH_API_KEY).toBe("secret-key-value");
  });

  it("defaults MEILISEARCH_INDEX_PREFIX to outline", () => {
    expect(env.MEILISEARCH_INDEX_PREFIX).toBe("outline");
  });

  it("defaults MEILISEARCH_TIMEOUT_MS to 5000", () => {
    expect(env.MEILISEARCH_TIMEOUT_MS).toBe(5000);
  });

  it("accepts an HTTP host", async () => {
    env.MEILISEARCH_HOST = "http://127.0.0.1:7700";
    const errors = await validate(env);
    const hostErrors = errors
      .filter((e) => e.property === "MEILISEARCH_HOST")
      .flatMap((e) => Object.keys(e.constraints ?? {}));
    expect(hostErrors).toHaveLength(0);
  });

  it("accepts an HTTPS host", async () => {
    env.MEILISEARCH_HOST = "https://search.example.com";
    const errors = await validate(env);
    const hostErrors = errors
      .filter((e) => e.property === "MEILISEARCH_HOST")
      .flatMap((e) => Object.keys(e.constraints ?? {}));
    expect(hostErrors).toHaveLength(0);
  });
});

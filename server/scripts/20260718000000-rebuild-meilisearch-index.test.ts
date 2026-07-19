import { MeilisearchIndexManager } from "plugins/search-meilisearch/server/MeilisearchIndexManager";

describe("rebuild-meilisearch-index argument parsing", () => {
  it("parses default arguments", () => {
    const opts = MeilisearchIndexManager.parseRebuildArgs([]);
    expect(opts.batchSize).toBe(1000);
    expect(opts.dryRun).toBe(false);
    expect(opts.noSwap).toBe(false);
  });

  it("parses --dry-run and --no-swap", () => {
    const opts = MeilisearchIndexManager.parseRebuildArgs([
      "--dry-run",
      "--no-swap",
    ]);
    expect(opts.dryRun).toBe(true);
    expect(opts.noSwap).toBe(true);
  });

  it("parses --team-id with --no-swap", () => {
    const opts = MeilisearchIndexManager.parseRebuildArgs([
      "--team-id",
      "team-abc",
      "--no-swap",
    ]);
    expect(opts.teamId).toBe("team-abc");
    expect(opts.noSwap).toBe(true);
  });

  it("rejects unknown arguments", () => {
    expect(() => MeilisearchIndexManager.parseRebuildArgs(["--bogus"])).toThrow(
      /Unknown argument/
    );
  });

  it("rejects out-of-range batch size", () => {
    expect(() =>
      MeilisearchIndexManager.parseRebuildArgs(["--batch-size", "50"])
    ).toThrow();
    expect(() =>
      MeilisearchIndexManager.parseRebuildArgs(["--batch-size", "5000"])
    ).toThrow();
  });
});

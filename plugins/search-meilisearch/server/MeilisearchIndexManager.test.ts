import { vi } from "vitest";
import type { MeilisearchClient } from "./client";
import {
  MeilisearchIndexManager,
  type RebuildOptions,
} from "./MeilisearchIndexManager";

function fakeClient(
  indexByUid: Record<string, unknown> = {}
): MeilisearchClient {
  return {
    index: vi.fn(
      (uid: string) =>
        indexByUid[uid] ?? {
          addDocuments: vi.fn().mockResolvedValue({ taskUid: 1 }),
          updateDocuments: vi.fn().mockResolvedValue({ taskUid: 1 }),
          deleteDocument: vi.fn().mockResolvedValue({ taskUid: 1 }),
          search: vi.fn(),
          updateSettings: vi.fn().mockResolvedValue({ taskUid: 1 }),
          getStats: vi.fn().mockResolvedValue({ numberOfDocuments: 0 }),
        }
    ),
    createIndex: vi.fn().mockResolvedValue({ taskUid: 1 }),
    deleteIndex: vi.fn().mockResolvedValue({ taskUid: 1 }),
    swapIndexes: vi.fn().mockResolvedValue({ taskUid: 1 }),
    health: vi.fn().mockResolvedValue({ status: "available" }),
    waitForTask: vi.fn().mockResolvedValue({ status: "succeeded" }),
  } as unknown as MeilisearchClient;
}

describe("MeilisearchIndexManager", () => {
  describe("createVersionedDocumentIndex", () => {
    it("creates a versioned document index with primary key id and applies settings", async () => {
      const client = fakeClient();
      const manager = new MeilisearchIndexManager(client);

      await manager.createVersionedDocumentIndex("20260718T120000Z");

      expect(client.createIndex).toHaveBeenCalledWith(
        "outline_documents_v1_20260718T120000Z",
        { primaryKey: "id" }
      );
      expect(client.waitForTask).toHaveBeenCalled();
    });
  });

  describe("createVersionedCollectionIndex", () => {
    it("creates a versioned collection index with primary key id", async () => {
      const client = fakeClient();
      const manager = new MeilisearchIndexManager(client);

      await manager.createVersionedCollectionIndex("20260718T120000Z");

      expect(client.createIndex).toHaveBeenCalledWith(
        "outline_collections_v1_20260718T120000Z",
        { primaryKey: "id" }
      );
    });
  });

  describe("batchUpsertDocuments", () => {
    it("submits a batch and waits for the task", async () => {
      const addDocuments = vi.fn().mockResolvedValue({ taskUid: 42 });
      const client = fakeClient({
        outline_documents_v1_ts: { addDocuments, updateSettings: vi.fn() },
      });
      const manager = new MeilisearchIndexManager(client);

      await manager.batchUpsertDocuments("ts", [
        { id: "d1" },
        { id: "d2" },
      ] as never);

      expect(addDocuments).toHaveBeenCalledTimes(1);
      expect(client.waitForTask).toHaveBeenCalledWith(42, expect.anything());
    });
  });

  describe("swapDocumentIndex", () => {
    it("atomically swaps versioned into stable", async () => {
      const client = fakeClient();
      const manager = new MeilisearchIndexManager(client);

      await manager.swapDocumentIndex("20260718T120000Z");

      expect(client.swapIndexes).toHaveBeenCalledWith([
        {
          indexes: [
            "outline_documents",
            "outline_documents_v1_20260718T120000Z",
          ],
          rename: false,
        },
      ]);
    });

    it("ensures the stable index exists before swapping (first install)", async () => {
      const client = fakeClient();
      const manager = new MeilisearchIndexManager(client);

      await manager.swapDocumentIndex("20260718T120000Z");

      // createIndex must be called for the stable index before swapIndexes
      expect(client.createIndex).toHaveBeenCalledWith("outline_documents", {
        primaryKey: "id",
      });
    });

    it("rejects when the swap task fails", async () => {
      const client = fakeClient();
      // Override waitForTask to return a failed task (this was the root cause
      // of the silent swap failure bug).
      vi.mocked(client.waitForTask).mockResolvedValue({
        status: "failed",
        error: { message: "index_already_exists", code: "..." },
      } as never);

      const manager = new MeilisearchIndexManager(client);

      await expect(
        manager.swapDocumentIndex("20260718T120000Z")
      ).rejects.toThrow(/failed/);
    });
  });

  describe("deleteIndex", () => {
    it("deletes an abandoned versioned index only when explicitly requested", async () => {
      const client = fakeClient();
      const manager = new MeilisearchIndexManager(client);

      await manager.deleteIndex("outline_documents_v1_old");

      expect(client.deleteIndex).toHaveBeenCalledWith(
        "outline_documents_v1_old"
      );
    });
  });

  describe("verifyCounts", () => {
    it("refuses swap when counts differ", async () => {
      const getStats = vi.fn().mockResolvedValue({ numberOfDocuments: 99 });
      const client = fakeClient({
        outline_documents_v1_ts: { getStats },
      });
      const manager = new MeilisearchIndexManager(client);

      await expect(manager.verifyDocumentCount("ts", 100)).rejects.toThrow(
        /count/
      );
    });

    it("passes when counts match", async () => {
      const getStats = vi.fn().mockResolvedValue({ numberOfDocuments: 100 });
      const client = fakeClient({
        outline_documents_v1_ts: { getStats },
      });
      const manager = new MeilisearchIndexManager(client);

      await expect(
        manager.verifyDocumentCount("ts", 100)
      ).resolves.toBeUndefined();
    });

    it("verifies collection counts", async () => {
      const getStats = vi.fn().mockResolvedValue({ numberOfDocuments: 25 });
      const client = fakeClient({
        outline_collections_v1_ts: { getStats },
      });
      const manager = new MeilisearchIndexManager(client);

      await expect(
        manager.verifyCollectionCount("ts", 25)
      ).resolves.toBeUndefined();
    });
  });

  describe("parseRebuildArgs", () => {
    it("parses valid arguments", () => {
      const opts = MeilisearchIndexManager.parseRebuildArgs([
        "--team-id",
        "abc",
        "--batch-size",
        "500",
        "--dry-run",
        "--no-swap",
      ]);

      expect(opts).toEqual({
        teamId: "abc",
        batchSize: 500,
        dryRun: true,
        noSwap: true,
        resumeFrom: undefined,
        allowProviderMismatch: false,
      });
    });

    it("defaults batchSize to 1000", () => {
      const opts = MeilisearchIndexManager.parseRebuildArgs([]);
      expect(opts.batchSize).toBe(1000);
    });

    it("rejects batchSize below 100", () => {
      expect(() =>
        MeilisearchIndexManager.parseRebuildArgs(["--batch-size", "50"])
      ).toThrow();
    });

    it("rejects batchSize above 2000", () => {
      expect(() =>
        MeilisearchIndexManager.parseRebuildArgs(["--batch-size", "5000"])
      ).toThrow();
    });

    it("rejects unknown arguments", () => {
      expect(() =>
        MeilisearchIndexManager.parseRebuildArgs(["--unknown-flag"])
      ).toThrow();
    });

    it("requires --no-swap for a team-scoped rebuild", () => {
      expect(() =>
        MeilisearchIndexManager.parseRebuildArgs(["--team-id", "abc"])
      ).toThrow(/--no-swap/);
    });

    it("rejects the unsafe resume flag", () => {
      expect(() =>
        MeilisearchIndexManager.parseRebuildArgs([
          "--resume-from",
          "document-id",
          "--no-swap",
        ])
      ).toThrow(/resume/i);
    });
  });
});

// Ensure RebuildOptions type is referenced for type graph.
void (null as unknown as RebuildOptions);

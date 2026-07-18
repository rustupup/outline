import {
  buildCollection,
  buildDocument,
  buildDraftDocument,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { DocumentMapper } from "./DocumentMapper";
import type { DocumentIndexDependencies } from "./DocumentMapper";

function fakeDependencies(
  overrides: Partial<DocumentIndexDependencies> = {}
): DocumentIndexDependencies {
  return {
    loadDirectUserIds: vi.fn().mockResolvedValue([]),
    loadDirectGroupIds: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("DocumentMapper", () => {
  describe("toRecord", () => {
    it("maps all fields exactly for a published document", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collaborator = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
      });
      const document = await buildDocument({
        teamId: team.id,
        userId: user.id,
        collectionId: collection.id,
        title: "Mapping contract",
        text: "body content",
        collaboratorIds: [collaborator.id],
        popularityScore: 12.5,
      });

      const deps = fakeDependencies({
        loadDirectUserIds: vi.fn().mockResolvedValue(["user-direct-1"]),
        loadDirectGroupIds: vi.fn().mockResolvedValue(["group-direct-1"]),
      });
      const mapper = new DocumentMapper(deps);
      const record = await mapper.toRecord(document);

      expect(record).toEqual({
        id: document.id,
        teamId: team.id,
        collectionId: collection.id,
        title: "Mapping contract",
        previousTitles: [],
        text: "body content",
        createdById: document.createdById,
        collaboratorIds: [...document.collaboratorIds].sort(),
        directUserIds: ["user-direct-1"],
        directGroupIds: ["group-direct-1"],
        publishedAt: document.publishedAt?.getTime() ?? null,
        archivedAt: null,
        deletedAt: null,
        createdAt: document.createdAt.getTime(),
        updatedAt: document.updatedAt.getTime(),
        popularityScore: 12.5,
        template: false,
        trialImport: false,
        schemaVersion: 1,
      });
    });

    it("converts ProseMirror content to plain text", async () => {
      const document = await buildDocument({
        title: "ProseMirror",
        // buildDocument accepts `content` (ProseMirror JSON) and `text`.
        // Provide content with markup to confirm toPlainText extracts text.
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "plain text from prosemirror" }],
            },
          ],
        },
      });

      const mapper = new DocumentMapper(fakeDependencies());
      const record = await mapper.toRecord(document);

      expect(record.text).toContain("plain text from prosemirror");
    });

    it("keeps null collection and dates for an uncollected draft", async () => {
      const user = await buildUser();
      const draft = await buildDraftDocument({
        teamId: user.teamId,
        userId: user.id,
        createdById: user.id,
        collectionId: null,
        title: "Uncollected draft",
      });

      const mapper = new DocumentMapper(fakeDependencies());
      const record = await mapper.toRecord(draft);

      expect(record.collectionId).toBeNull();
      expect(record.publishedAt).toBeNull();
      expect(record.archivedAt).toBeNull();
      expect(record.deletedAt).toBeNull();
    });

    it("deduplicates and sorts ACL ids", async () => {
      const team = await buildTeam();
      const collaboratorA = await buildUser({ teamId: team.id });
      const collaboratorB = await buildUser({ teamId: team.id });
      const document = await buildDocument({
        teamId: team.id,
        title: "Dedup contract",
        collaboratorIds: [collaboratorB.id, collaboratorA.id, collaboratorB.id],
      });
      // buildDocument's hook appends lastModifiedById to collaboratorIds;
      // read the post-hook value so the expectation reflects real state.
      const expectedCollaboratorIds = [
        ...new Set(document.collaboratorIds),
      ].sort();

      const deps = fakeDependencies({
        loadDirectUserIds: vi.fn().mockResolvedValue(["a", "c", "a"]),
        loadDirectGroupIds: vi.fn().mockResolvedValue(["g2", "g1", "g1"]),
      });
      const mapper = new DocumentMapper(deps);
      const record = await mapper.toRecord(document);

      expect(record.collaboratorIds).toEqual(expectedCollaboratorIds);
      expect(record.directUserIds).toEqual(["a", "c"]);
      expect(record.directGroupIds).toEqual(["g1", "g2"]);
    });

    it("defaults previousTitles and collaborators to empty arrays", async () => {
      const document = await buildDocument({
        title: "Defaults contract",
      });
      // Force undefined to confirm the mapper coerces to [].
      document.previousTitles = undefined as unknown as string[];
      document.collaboratorIds = undefined as unknown as string[];

      const mapper = new DocumentMapper(fakeDependencies());
      const record = await mapper.toRecord(document);

      expect(record.previousTitles).toEqual([]);
      expect(record.collaboratorIds).toEqual([]);
    });

    it("marks trial imports based on sourceMetadata.trial", async () => {
      const document = await buildDocument({
        title: "Trial import contract",
        sourceMetadata: { trial: true },
      });

      const mapper = new DocumentMapper(fakeDependencies());
      const record = await mapper.toRecord(document);

      expect(record.trialImport).toBe(true);
    });

    it("preserves Chinese, emoji, URLs, and code identifiers as plain text", async () => {
      // DocumentHelper.toPlainText parses the ProseMirror content generated
      // from `text`; markdown syntax (like backticks) is consumed by the
      // parser, so the plain text output drops it. The visible text content
      // is preserved.
      const document = await buildDocument({
        title: "Mixed content",
        text: "中文测试 🎉 https://example.com/path `codeIdentifier`",
      });

      const mapper = new DocumentMapper(fakeDependencies());
      const record = await mapper.toRecord(document);

      expect(record.text).toContain("中文测试");
      expect(record.text).toContain("🎉");
      expect(record.text).toContain("https://example.com/path");
      expect(record.text).toContain("codeIdentifier");
    });

    it("does not mutate the input document", async () => {
      const team = await buildTeam();
      const collaborator = await buildUser({ teamId: team.id });
      const document = await buildDocument({
        teamId: team.id,
        title: "Immutability contract",
        collaboratorIds: [collaborator.id],
      });
      const snapshot = {
        title: document.title,
        previousTitles: document.previousTitles,
        collaboratorIds: [...(document.collaboratorIds ?? [])],
        text: document.text,
        popularityScore: document.popularityScore,
        sourceMetadata: document.sourceMetadata,
      };

      const mapper = new DocumentMapper(
        fakeDependencies({
          loadDirectUserIds: vi.fn().mockResolvedValue(["u1"]),
          loadDirectGroupIds: vi.fn().mockResolvedValue(["g1"]),
        })
      );
      await mapper.toRecord(document);

      expect(document.title).toBe(snapshot.title);
      expect(document.previousTitles).toEqual(snapshot.previousTitles);
      expect(document.collaboratorIds).toEqual(snapshot.collaboratorIds);
      expect(document.text).toBe(snapshot.text);
      expect(document.popularityScore).toBe(snapshot.popularityScore);
      expect(document.sourceMetadata).toEqual(snapshot.sourceMetadata);
    });

    it("maps archivedAt and deletedAt when set", async () => {
      const archivedAt = new Date("2025-01-01T00:00:00Z");
      const deletedAt = new Date("2025-02-01T00:00:00Z");
      const document = await buildDocument({
        title: "Stateful contract",
        archivedAt,
        deletedAt,
      });

      const mapper = new DocumentMapper(fakeDependencies());
      const record = await mapper.toRecord(document);

      expect(record.archivedAt).toBe(archivedAt.getTime());
      expect(record.deletedAt).toBe(deletedAt.getTime());
    });
  });
});

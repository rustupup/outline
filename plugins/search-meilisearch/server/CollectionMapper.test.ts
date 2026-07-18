import { buildCollection, buildTeam, buildUser } from "@server/test/factories";
import { CollectionMapper } from "./CollectionMapper";

describe("CollectionMapper", () => {
  describe("toRecord", () => {
    it("maps all fields exactly for a collection", async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        userId: user.id,
        name: "Engineering",
        description: "Engineering docs",
      });

      const mapper = new CollectionMapper();
      const record = await mapper.toRecord(collection);

      expect(record).toEqual({
        id: collection.id,
        teamId: team.id,
        name: "Engineering",
        description: "Engineering docs",
        archivedAt: null,
        deletedAt: null,
        createdAt: collection.createdAt.getTime(),
        updatedAt: collection.updatedAt.getTime(),
        schemaVersion: 1,
      });
    });

    it("coerces null description to empty string", async () => {
      const collection = await buildCollection({
        description: null,
      });

      const mapper = new CollectionMapper();
      const record = await mapper.toRecord(collection);

      expect(record.description).toBe("");
    });

    it("preserves Chinese names and descriptions", async () => {
      const collection = await buildCollection({
        name: "产品文档",
        description: "这里是产品团队的文档集合",
      });

      const mapper = new CollectionMapper();
      const record = await mapper.toRecord(collection);

      expect(record.name).toBe("产品文档");
      expect(record.description).toBe("这里是产品团队的文档集合");
    });

    it("does not mutate the input collection", async () => {
      const collection = await buildCollection({
        name: "Immutable",
        description: "snapshot me",
      });
      const snapshot = {
        name: collection.name,
        description: collection.description,
        archivedAt: collection.archivedAt,
        deletedAt: collection.deletedAt,
      };

      const mapper = new CollectionMapper();
      await mapper.toRecord(collection);

      expect(collection.name).toBe(snapshot.name);
      expect(collection.description).toBe(snapshot.description);
      expect(collection.archivedAt).toEqual(snapshot.archivedAt);
      expect(collection.deletedAt).toEqual(snapshot.deletedAt);
    });

    it("maps archivedAt when set", async () => {
      const archivedAt = new Date("2025-03-01T00:00:00Z");
      const collection = await buildCollection({
        archivedAt,
      });

      const mapper = new CollectionMapper();
      const record = await mapper.toRecord(collection);

      expect(record.archivedAt).toBe(archivedAt.getTime());
    });
  });
});

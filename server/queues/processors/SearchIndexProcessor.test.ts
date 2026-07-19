import { SearchableModel } from "@shared/types";
import {
  buildDocument,
  buildCollection,
  buildUser,
} from "@server/test/factories";
import SearchProviderManager from "@server/utils/SearchProviderManager";
import SearchIndexProcessor from "./SearchIndexProcessor";

type PerformArg = Parameters<SearchIndexProcessor["perform"]>[0];

const processor = new SearchIndexProcessor();

describe("SearchIndexProcessor", () => {
  it("should have the expected applicable events", () => {
    expect(SearchIndexProcessor.applicableEvents).toContain("documents.create");
    expect(SearchIndexProcessor.applicableEvents).toContain(
      "documents.publish"
    );
    expect(SearchIndexProcessor.applicableEvents).toContain(
      "documents.update.delayed"
    );
    expect(SearchIndexProcessor.applicableEvents).toContain(
      "documents.permanent_delete"
    );
    expect(SearchIndexProcessor.applicableEvents).toContain(
      "documents.add_user"
    );
    expect(SearchIndexProcessor.applicableEvents).toContain(
      "documents.remove_user"
    );
    expect(SearchIndexProcessor.applicableEvents).toContain(
      "documents.add_group"
    );
    expect(SearchIndexProcessor.applicableEvents).toContain(
      "documents.remove_group"
    );
    expect(SearchIndexProcessor.applicableEvents).toContain(
      "collections.archive"
    );
    expect(SearchIndexProcessor.applicableEvents).toContain(
      "collections.restore"
    );
    expect(SearchIndexProcessor.applicableEvents).toContain(
      "collections.create"
    );
    expect(SearchIndexProcessor.applicableEvents).toContain("comments.create");
    expect(SearchIndexProcessor.applicableEvents).toContain("comments.delete");
  });

  it("should call provider.index for documents.publish", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      collectionId: collection.id,
      userId: user.id,
    });

    const provider = SearchProviderManager.getProvider();
    const indexSpy = vi.spyOn(provider, "index");

    await processor.perform({
      name: "documents.publish",
      documentId: document.id,
      collectionId: collection.id,
      teamId: user.teamId,
      actorId: user.id,
    } as unknown as PerformArg);

    expect(indexSpy).toHaveBeenCalledWith(
      SearchableModel.Document,
      expect.objectContaining({ id: document.id })
    );

    indexSpy.mockRestore();
  });

  it("should call provider.remove for documents.permanent_delete", async () => {
    const user = await buildUser();
    const provider = SearchProviderManager.getProvider();
    const removeSpy = vi.spyOn(provider, "remove");

    await processor.perform({
      name: "documents.permanent_delete",
      documentId: "deleted-doc-id",
      collectionId: "some-collection-id",
      teamId: user.teamId,
      actorId: user.id,
    } as unknown as PerformArg);

    expect(removeSpy).toHaveBeenCalledWith(
      SearchableModel.Document,
      "deleted-doc-id",
      user.teamId
    );

    removeSpy.mockRestore();
  });

  it("should call provider.updateMetadata for documents.add_user", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      collectionId: collection.id,
      userId: user.id,
    });

    const provider = SearchProviderManager.getProvider();
    const updateSpy = vi.spyOn(provider, "updateMetadata");

    await processor.perform({
      name: "documents.add_user",
      documentId: document.id,
      collectionId: collection.id,
      teamId: user.teamId,
      actorId: user.id,
    } as unknown as PerformArg);

    expect(updateSpy).toHaveBeenCalledWith(
      SearchableModel.Document,
      document.id,
      {}
    );
    updateSpy.mockRestore();
  });

  it("should call provider.updateMetadata for documents.remove_user", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      collectionId: collection.id,
      userId: user.id,
    });

    const provider = SearchProviderManager.getProvider();
    const updateSpy = vi.spyOn(provider, "updateMetadata");

    await processor.perform({
      name: "documents.remove_user",
      documentId: document.id,
      collectionId: collection.id,
      teamId: user.teamId,
      actorId: user.id,
    } as unknown as PerformArg);

    expect(updateSpy).toHaveBeenCalledWith(
      SearchableModel.Document,
      document.id,
      {}
    );
    updateSpy.mockRestore();
  });

  it("should call provider.updateMetadata for documents.add_group", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      collectionId: collection.id,
      userId: user.id,
    });

    const provider = SearchProviderManager.getProvider();
    const updateSpy = vi.spyOn(provider, "updateMetadata");

    await processor.perform({
      name: "documents.add_group",
      documentId: document.id,
      collectionId: collection.id,
      teamId: user.teamId,
      actorId: user.id,
    } as unknown as PerformArg);

    expect(updateSpy).toHaveBeenCalledWith(
      SearchableModel.Document,
      document.id,
      {}
    );
    updateSpy.mockRestore();
  });

  it("should call provider.updateMetadata for documents.remove_group", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      collectionId: collection.id,
      userId: user.id,
    });

    const provider = SearchProviderManager.getProvider();
    const updateSpy = vi.spyOn(provider, "updateMetadata");

    await processor.perform({
      name: "documents.remove_group",
      documentId: document.id,
      collectionId: collection.id,
      teamId: user.teamId,
      actorId: user.id,
    } as unknown as PerformArg);

    expect(updateSpy).toHaveBeenCalledWith(
      SearchableModel.Document,
      document.id,
      {}
    );
    updateSpy.mockRestore();
  });
});

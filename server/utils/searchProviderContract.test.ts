import {
  DocumentPermission,
  SortFilter,
  StatusFilter,
  DirectionFilter,
} from "@shared/types";
import {
  buildCollection,
  buildDocument,
  buildDraftDocument,
  buildGroup,
  buildShare,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import GroupMembership from "@server/models/GroupMembership";
import UserMembership from "@server/models/UserMembership";
import PostgresSearchProvider from "plugins/search-postgres/server/PostgresSearchProvider";
import type { BaseSearchProvider } from "./BaseSearchProvider";

/**
 * Runs the shared search provider contract against a provider instance.
 *
 * These tests freeze the authorization, filtering, sorting, and pagination
 * behavior that any conforming search provider must satisfy. They are
 * intentionally derived from the existing PostgreSQL provider behavior and
 * the documented `documents.search` / `documents.search_titles` API surface.
 *
 * Behavior is extracted from:
 * - `plugins/search-postgres/server/PostgresSearchProvider.ts`
 * - `plugins/search-postgres/server/PostgresSearchProvider.test.ts`
 * - `server/routes/api/documents/documents.test.ts`
 *
 * A second provider (e.g. Meilisearch) must satisfy the same contract without
 * weakening authorization, leaking cross-team data, or altering the response
 * shape consumed by the API layer.
 *
 * @param name - human-readable label for the provider under test.
 * @param providerFactory - returns a fresh provider instance for each test.
 */
export function runSearchProviderContract(
  name: string,
  providerFactory: () => BaseSearchProvider
) {
  describe(`${name}: search provider contract`, () => {
    let provider: BaseSearchProvider;

    beforeEach(() => {
      provider = providerFactory();
    });

    describe("team scoping", () => {
      it("returns a published document in an accessible collection", async () => {
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
          title: "contract published",
        });

        const { results, total } = await provider.searchForUser(user, {
          query: "contract",
        });

        expect(total).toBe(1);
        expect(results.length).toBe(1);
        expect(results[0].document.id).toBe(document.id);
      });

      it("never returns documents from another team", async () => {
        const teamA = await buildTeam();
        const teamB = await buildTeam();
        const userA = await buildUser({ teamId: teamA.id });
        const collectionB = await buildCollection({
          teamId: teamB.id,
          userId: (await buildUser({ teamId: teamB.id })).id,
        });
        await buildDocument({
          teamId: teamB.id,
          userId: collectionB.createdById,
          collectionId: collectionB.id,
          title: "cross team contract",
        });

        const { results, total } = await provider.searchForUser(userA, {
          query: "cross team contract",
        });

        expect(total).toBe(0);
        expect(results.length).toBe(0);
      });

      it("an explicit collectionId filter cannot escape team scope", async () => {
        const teamA = await buildTeam();
        const teamB = await buildTeam();
        const userA = await buildUser({ teamId: teamA.id });
        const collectionB = await buildCollection({
          teamId: teamB.id,
          userId: (await buildUser({ teamId: teamB.id })).id,
        });
        const foreignDoc = await buildDocument({
          teamId: teamB.id,
          userId: collectionB.createdById,
          collectionId: collectionB.id,
          title: "foreign team contract",
        });

        const { results, total } = await provider.searchForUser(userA, {
          query: "foreign team contract",
          collectionId: collectionB.id,
        });

        expect(total).toBe(0);
        expect(results).not.toContainEqual(
          expect.objectContaining({
            document: expect.objectContaining({ id: foreignDoc.id }),
          })
        );
      });
    });

    describe("collection access", () => {
      it("does not return documents from a private collection without membership", async () => {
        const team = await buildTeam();
        const user = await buildUser({ teamId: team.id });
        const otherUser = await buildUser({ teamId: team.id });
        const privateCollection = await buildCollection({
          teamId: team.id,
          userId: otherUser.id,
          permission: null,
        });
        await buildDocument({
          teamId: team.id,
          userId: otherUser.id,
          collectionId: privateCollection.id,
          title: "private collection contract",
        });

        const { results, total } = await provider.searchForUser(user, {
          query: "private collection contract",
        });

        expect(total).toBe(0);
        expect(results.length).toBe(0);
      });

      it("returns documents from an accessible collection when collectionId is supplied", async () => {
        const team = await buildTeam();
        const user = await buildUser({ teamId: team.id });
        const collection = await buildCollection({
          teamId: team.id,
          userId: user.id,
          permission: null,
        });
        const document = await buildDocument({
          teamId: team.id,
          userId: user.id,
          collectionId: collection.id,
          title: "explicit collection contract",
        });

        const { results, total } = await provider.searchForUser(user, {
          query: "explicit collection contract",
          collectionId: collection.id,
        });

        expect(total).toBe(1);
        expect(results[0].document.id).toBe(document.id);
      });
    });

    describe("direct document membership", () => {
      it("returns documents with a direct user membership", async () => {
        const team = await buildTeam();
        const owner = await buildUser({ teamId: team.id });
        const member = await buildUser({ teamId: team.id });
        const collection = await buildCollection({
          teamId: team.id,
          userId: owner.id,
          permission: null,
        });
        const document = await buildDocument({
          teamId: team.id,
          userId: owner.id,
          collectionId: collection.id,
          title: "direct user membership contract",
        });
        await UserMembership.create({
          createdById: owner.id,
          documentId: document.id,
          userId: member.id,
          permission: DocumentPermission.Read,
        });

        const { results, total } = await provider.searchForUser(member, {
          query: "direct user membership",
        });

        expect(total).toBe(1);
        expect(results[0].document.id).toBe(document.id);
      });

      it("returns documents with a direct group membership", async () => {
        const team = await buildTeam();
        const owner = await buildUser({ teamId: team.id });
        const member = await buildUser({ teamId: team.id });
        const collection = await buildCollection({
          teamId: team.id,
          userId: owner.id,
          permission: null,
        });
        const document = await buildDocument({
          teamId: team.id,
          userId: owner.id,
          collectionId: collection.id,
          title: "direct group membership contract",
        });
        const group = await buildGroup({ teamId: team.id });
        await group.$add("user", member, {
          through: { createdById: owner.id },
        });
        await GroupMembership.create({
          createdById: owner.id,
          groupId: group.id,
          documentId: document.id,
        });

        const { results, total } = await provider.searchForUser(member, {
          query: "direct group membership",
        });

        expect(total).toBe(1);
        expect(results[0].document.id).toBe(document.id);
      });
    });

    describe("drafts", () => {
      it("returns the user's own uncollected draft only with draft status", async () => {
        const user = await buildUser();
        const draft = await buildDraftDocument({
          teamId: user.teamId,
          userId: user.id,
          createdById: user.id,
          collectionId: null,
          title: "own uncollected draft contract",
        });

        const draftResults = await provider.searchForUser(user, {
          query: "own uncollected draft contract",
          statusFilter: [StatusFilter.Draft],
        });
        expect(draftResults.results.length).toBe(1);
        expect(draftResults.results[0].document.id).toBe(draft.id);

        const publishedOnly = await provider.searchForUser(user, {
          query: "own uncollected draft contract",
          statusFilter: [StatusFilter.Published],
        });
        expect(publishedOnly.results.length).toBe(0);
      });

      it("does not return another user's uncollected draft", async () => {
        const team = await buildTeam();
        const owner = await buildUser({ teamId: team.id });
        const other = await buildUser({ teamId: team.id });
        await buildDraftDocument({
          teamId: team.id,
          userId: owner.id,
          createdById: owner.id,
          collectionId: null,
          title: "other user draft contract",
        });

        const { results, total } = await provider.searchForUser(other, {
          query: "other user draft contract",
          statusFilter: [StatusFilter.Draft],
        });

        expect(total).toBe(0);
        expect(results.length).toBe(0);
      });
    });

    describe("excluded states", () => {
      it("excludes deleted, template, and trial-import documents by default", async () => {
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
          title: "excluded states contract",
          deletedAt: new Date(),
        });
        await buildDocument({
          teamId: team.id,
          userId: user.id,
          collectionId: collection.id,
          title: "excluded states contract",
          template: true,
        });
        await buildDocument({
          teamId: team.id,
          userId: user.id,
          collectionId: collection.id,
          title: "excluded states contract",
          sourceMetadata: { trial: true },
        });

        const { results, total } = await provider.searchForUser(user, {
          query: "excluded states contract",
        });

        expect(total).toBe(0);
        expect(results.length).toBe(0);
      });

      it("excludes archived documents only when a non-archived status filter is applied", async () => {
        const team = await buildTeam();
        const user = await buildUser({ teamId: team.id });
        const collection = await buildCollection({
          teamId: team.id,
          userId: user.id,
        });
        const archived = await buildDocument({
          teamId: team.id,
          userId: user.id,
          collectionId: collection.id,
          title: "archived state contract",
          archivedAt: new Date(),
        });

        // Without a statusFilter, the PostgreSQL provider does not add a
        // status constraint, so archived documents are returned. This freezes
        // the existing behavior; a conforming provider must match it.
        const withoutFilter = await provider.searchForUser(user, {
          query: "archived state contract",
        });
        expect(withoutFilter.results.length).toBe(1);
        expect(withoutFilter.results[0].document.id).toBe(archived.id);

        // With an explicit Published filter, archived documents are excluded.
        const withPublished = await provider.searchForUser(user, {
          query: "archived state contract",
          statusFilter: [StatusFilter.Published],
        });
        expect(withPublished.results.length).toBe(0);

        // With an explicit Archived filter, they are returned.
        const withArchived = await provider.searchForUser(user, {
          query: "archived state contract",
          statusFilter: [StatusFilter.Archived],
        });
        expect(withArchived.results.length).toBe(1);
        expect(withArchived.results[0].document.id).toBe(archived.id);
      });
    });

    describe("filters", () => {
      it("applies a collaboratorIds filter", async () => {
        const team = await buildTeam();
        const user = await buildUser({ teamId: team.id });
        const collaborator = await buildUser({ teamId: team.id });
        const collection = await buildCollection({
          teamId: team.id,
          userId: user.id,
        });
        const matched = await buildDocument({
          teamId: team.id,
          userId: user.id,
          collectionId: collection.id,
          title: "collaborator filter contract",
        });
        await matched.update({ collaboratorIds: [collaborator.id] });
        await buildDocument({
          teamId: team.id,
          userId: user.id,
          collectionId: collection.id,
          title: "collaborator filter contract",
        });

        const { results, total } = await provider.searchForUser(user, {
          query: "collaborator filter contract",
          collaboratorIds: [collaborator.id],
        });

        expect(total).toBe(1);
        expect(results[0].document.id).toBe(matched.id);
      });

      it("applies a documentIds subtree filter", async () => {
        const team = await buildTeam();
        const user = await buildUser({ teamId: team.id });
        const collection = await buildCollection({
          teamId: team.id,
          userId: user.id,
        });
        const matched = await buildDocument({
          teamId: team.id,
          userId: user.id,
          collectionId: collection.id,
          title: "document subtree filter contract",
        });
        await buildDocument({
          teamId: team.id,
          userId: user.id,
          collectionId: collection.id,
          title: "document subtree filter contract",
        });

        const { results, total } = await provider.searchForUser(user, {
          query: "document subtree filter contract",
          documentIds: [matched.id],
        });

        expect(total).toBe(1);
        expect(results[0].document.id).toBe(matched.id);
      });
    });

    describe("share scoping", () => {
      it("document share search is limited to the allowed tree", async () => {
        const team = await buildTeam();
        const owner = await buildUser({ teamId: team.id });
        const collection = await buildCollection({
          teamId: team.id,
          userId: owner.id,
          permission: null,
        });
        const sharedDoc = await buildDocument({
          teamId: team.id,
          userId: owner.id,
          collectionId: collection.id,
          title: "shared document tree contract",
        });
        await buildDocument({
          teamId: team.id,
          userId: owner.id,
          collectionId: collection.id,
          title: "shared document tree contract",
        });

        const share = await buildShare({
          teamId: team.id,
          userId: owner.id,
          documentId: sharedDoc.id,
          includeChildDocuments: true,
        });

        const { results, total } = await provider.searchForTeam(team, {
          query: "shared document tree contract",
          share,
          collectionId: collection.id,
        });

        expect(total).toBe(1);
        expect(results[0].document.id).toBe(sharedDoc.id);
      });
    });

    describe("pagination, sort, and result shape", () => {
      it("supports offset and limit", async () => {
        const team = await buildTeam();
        const user = await buildUser({ teamId: team.id });
        const collection = await buildCollection({
          teamId: team.id,
          userId: user.id,
        });
        await Promise.all(
          Array.from({ length: 5 }, (_, i) =>
            buildDocument({
              teamId: team.id,
              userId: user.id,
              collectionId: collection.id,
              title: `pagination contract ${i}`,
            })
          )
        );

        const page = await provider.searchForUser(user, {
          query: "pagination contract",
          limit: 2,
          offset: 1,
        });

        expect(page.results.length).toBe(2);
        expect(page.total).toBeGreaterThanOrEqual(5);
      });

      it("sorts by title ascending when requested", async () => {
        const team = await buildTeam();
        const user = await buildUser({ teamId: team.id });
        const collection = await buildCollection({
          teamId: team.id,
          userId: user.id,
        });
        const alpha = await buildDocument({
          teamId: team.id,
          userId: user.id,
          collectionId: collection.id,
          title: "Alpha contract sort",
        });
        const zebra = await buildDocument({
          teamId: team.id,
          userId: user.id,
          collectionId: collection.id,
          title: "Zebra contract sort",
        });

        const { results } = await provider.searchForUser(user, {
          query: "contract sort",
          sort: SortFilter.Title,
          direction: DirectionFilter.ASC,
        });

        expect(results[0].document.id).toBe(alpha.id);
        expect(results[results.length - 1].document.id).toBe(zebra.id);
      });

      it("returns a result shape with ranking, context, document, and total", async () => {
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
          title: "shape contract",
        });

        const { results, total } = await provider.searchForUser(user, {
          query: "shape contract",
        });

        expect(typeof total).toBe("number");
        expect(results[0]).toEqual(
          expect.objectContaining({
            document: expect.objectContaining({ id: expect.any(String) }),
            ranking: expect.any(Number),
          })
        );
      });
    });
  });
}

// Run the contract against the built-in PostgreSQL provider. A second provider
// (e.g. Meilisearch) must add its own invocation in its own test file.
runSearchProviderContract(
  "PostgresSearchProvider",
  () => new PostgresSearchProvider()
);

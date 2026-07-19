import invariant from "invariant";
import { Op } from "sequelize";
import { SearchableModel } from "@shared/types";
import { SearchServiceUnavailableError } from "@server/errors";
import Logger from "@server/logging/Logger";
import Collection from "@server/models/Collection";
import type Comment from "@server/models/Comment";
import Document from "@server/models/Document";
import type Share from "@server/models/Share";
import type Team from "@server/models/Team";
import type User from "@server/models/User";
import type {
  SearchOptions,
  SearchResponse,
} from "@server/utils/BaseSearchProvider";
import { BaseSearchProvider } from "@server/utils/BaseSearchProvider";
import env from "@server/env";
import { createMeilisearchClient } from "./client";
import type { MeilisearchClient } from "./client";
import { AccessFilterBuilder } from "./AccessFilterBuilder";
import { CollectionMapper } from "./CollectionMapper";
import { DocumentMapper } from "./DocumentMapper";
import { ResultHydrator } from "./ResultHydrator";
import { SearchQueryMapper } from "./SearchQueryMapper";
import { stableCollectionIndexName, stableDocumentIndexName } from "./settings";
import type {
  MeilisearchCollectionRecord,
  MeilisearchDocumentRecord,
} from "./types";

/**
 * Search provider backed by Meilisearch.
 *
 * Meilisearch performs text retrieval, ACL filtering, sorting, pagination, and
 * highlighting. PostgreSQL supplies current collection/group access facts and
 * performs final authorized entity loading via {@link ResultHydrator}.
 */
export class MeilisearchSearchProvider extends BaseSearchProvider {
  id = "meilisearch";

  private readonly injectedClient: MeilisearchClient | undefined;
  private readonly filterBuilder = new AccessFilterBuilder();
  private readonly queryMapper = new SearchQueryMapper();
  private readonly hydrator = new ResultHydrator();
  private readonly documentMapper = new DocumentMapper();
  private readonly collectionMapper = new CollectionMapper();
  private client: MeilisearchClient | undefined;

  /**
   * @param client - optional Meilisearch client. When omitted, a client is
   * constructed lazily from the environment on first use, so the plugin can
   * be registered even when the postgres provider is active. Tests inject a
   * fake.
   */
  public constructor(client?: MeilisearchClient) {
    super();
    this.injectedClient = client;
  }

  /**
   * Resolve the Meilisearch client, constructing it from the environment on
   * first use. Throws if required configuration is missing.
   */
  private getClient(): MeilisearchClient {
    if (this.injectedClient) {
      return this.injectedClient;
    }

    this.client ??= createMeilisearchClient();
    return this.client;
  }

  /**
   * Perform a full-text search scoped to a user's accessible documents.
   *
   * @param user - the user performing the search.
   * @param options - search options.
   * @returns search results with ranking and context.
   */
  public async searchForUser(
    user: User,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const [collectionIds, groupIds] = await Promise.all([
      user.collectionIds(),
      user.groupIds({ attributes: ["id"] }),
    ]);

    const filter = this.filterBuilder.buildForUser(
      {
        teamId: user.teamId,
        userId: user.id,
        collectionIds,
        groupIds,
      },
      options
    );

    const params = this.queryMapper.buildSearchParams({ options, filter });

    let response;
    try {
      const index = this.getClient().index<MeilisearchDocumentRecord>(
        stableDocumentIndexName()
      );
      response = await index.search(options.query ?? "", params);
    } catch (err) {
      throw this.toSearchError(err, "searchForUser", stableDocumentIndexName());
    }

    const hasQuery = Boolean(options.query?.trim());
    return this.hydrator.hydrateForUser(user, response, {
      withContext: hasQuery,
      requireActualMatch: hasQuery,
    });
  }

  /**
   * Perform a full-text search scoped to a team via a share. Requires a
   * `share` constraint so the search cannot expose the entire team.
   *
   * @param team - the team to search within.
   * @param options - search options, must include `share`.
   * @returns search results with ranking and context.
   */
  public async searchForTeam(
    team: Team,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const share = options.share;
    invariant(
      share,
      "MeilisearchSearchProvider.searchForTeam requires a share constraint"
    );

    const shareDocumentIds = await this.getShareDocumentIds(share);
    const requestedDocumentIds = options.documentIds;
    const documentIds = requestedDocumentIds
      ? shareDocumentIds.filter((id) => requestedDocumentIds.includes(id))
      : shareDocumentIds;
    const scopedOptions = { ...options, documentIds };
    const filter = this.filterBuilder.buildForTeam(team, scopedOptions);

    const params = this.queryMapper.buildSearchParams({
      options: scopedOptions,
      filter,
    });

    let response;
    try {
      const index = this.getClient().index<MeilisearchDocumentRecord>(
        stableDocumentIndexName()
      );
      response = await index.search(options.query ?? "", params);
    } catch (err) {
      throw this.toSearchError(err, "searchForTeam", stableDocumentIndexName());
    }

    const hasQuery = Boolean(options.query?.trim());
    return this.hydrator.hydrateForTeam(team.id, response, {
      withContext: hasQuery,
      requireActualMatch: hasQuery,
    });
  }

  /**
   * Search document titles for a user (used for link suggestions, quick search).
   * Uses the same document index as full-text search but restricts the search
   * to title and previousTitles fields.
   *
   * @param user - the user performing the search.
   * @param options - search options.
   * @returns matching documents in hit order.
   */
  public async searchTitlesForUser(
    user: User,
    options: SearchOptions = {}
  ): Promise<Document[]> {
    const [collectionIds, groupIds] = await Promise.all([
      user.collectionIds(),
      user.groupIds({ attributes: ["id"] }),
    ]);

    const filter = this.filterBuilder.buildForUser(
      {
        teamId: user.teamId,
        userId: user.id,
        collectionIds,
        groupIds,
      },
      options
    );

    const params = this.queryMapper.buildSearchParams({
      options,
      filter,
      titleOnly: true,
    });

    let response;
    try {
      const index = this.getClient().index<MeilisearchDocumentRecord>(
        stableDocumentIndexName()
      );
      response = await index.search(options.query ?? "", params);
    } catch (err) {
      throw this.toSearchError(
        err,
        "searchTitlesForUser",
        stableDocumentIndexName()
      );
    }

    const hasQuery = Boolean(options.query?.trim());
    const hydrated = await this.hydrator.hydrateForUser(user, response, {
      withContext: false,
      requireActualMatch: hasQuery,
    });
    return hydrated.results.map((r) => r.document);
  }

  /**
   * Search collections for a user. Returns empty immediately when the user
   * has no accessible collections to avoid an empty `IN` clause.
   *
   * @param user - the user performing the search.
   * @param options - search options.
   * @returns matching collections in hit order.
   */
  public async searchCollectionsForUser(
    user: User,
    options: SearchOptions = {}
  ): Promise<Collection[]> {
    const collectionIds = await user.collectionIds();
    if (collectionIds.length === 0) {
      return [];
    }

    const filter = [
      `teamId = ${JSON.stringify(user.teamId)}`,
      `deletedAt IS NULL`,
      `archivedAt IS NULL`,
      `id IN [${collectionIds.map((id) => JSON.stringify(id)).join(", ")}]`,
    ].join(" AND ");

    const params = this.queryMapper.buildSearchParams({
      options,
      filter,
    });
    params.sort = ["name:asc"];

    let response;
    try {
      const index = this.getClient().index<MeilisearchCollectionRecord>(
        stableCollectionIndexName()
      );
      response = await index.search(options.query ?? "", params);
    } catch (err) {
      throw this.toSearchError(
        err,
        "searchCollectionsForUser",
        stableCollectionIndexName()
      );
    }

    const ids = response.hits.map((h) => h.id);
    if (ids.length === 0) {
      return [];
    }

    const collections = await Collection.findAll({
      where: { id: ids },
    });
    const byId = new Map(collections.map((c) => [c.id, c] as const));
    return ids
      .map((id) => byId.get(id))
      .filter((c): c is Collection => c !== undefined);
  }

  /**
   * Index or re-index a searchable item. Comments are a no-op in phase one.
   * Documents and collections are mapped to their index records and upserted;
   * the resulting Meilisearch async task is awaited so a failed task rejects
   * and allows Bull retry.
   *
   * @param model - the type of model being indexed.
   * @param item - the model instance to index.
   */
  public async index(
    model: SearchableModel,
    item: Document | Collection | Comment
  ): Promise<void> {
    if (model === SearchableModel.Comment) {
      return;
    }

    if (model === SearchableModel.Document) {
      const record = await this.documentMapper.toRecord(item as Document);
      const index = this.getClient().index<MeilisearchDocumentRecord>(
        stableDocumentIndexName()
      );
      const enqueued = await index.addDocuments([record]);
      await this.getClient().waitForTask(enqueued.taskUid, {
        timeout: env.MEILISEARCH_TIMEOUT_MS,
      });
      return;
    }

    if (model === SearchableModel.Collection) {
      const record = await this.collectionMapper.toRecord(item as Collection);
      const index = this.getClient().index<MeilisearchCollectionRecord>(
        stableCollectionIndexName()
      );
      const enqueued = await index.addDocuments([record]);
      await this.getClient().waitForTask(enqueued.taskUid, {
        timeout: env.MEILISEARCH_TIMEOUT_MS,
      });
    }
  }

  /**
   * Remove an item from the search index. Comments are a no-op.
   *
   * @param model - the type of model being removed.
   * @param id - the id of the item to remove.
   * @param _teamId - the team id (unused; index is shared across teams).
   */
  public async remove(
    model: SearchableModel,
    id: string,
    _teamId: string
  ): Promise<void> {
    if (model === SearchableModel.Comment) {
      return;
    }

    const indexUid =
      model === SearchableModel.Document
        ? stableDocumentIndexName()
        : stableCollectionIndexName();
    const index = this.getClient().index(indexUid);
    const enqueued = await index.deleteDocument(id);
    await this.getClient().waitForTask(enqueued.taskUid, {
      timeout: env.MEILISEARCH_TIMEOUT_MS,
    });
  }

  /**
   * Update metadata for an indexed item by reloading current database state
   * and upserting. This converges duplicate and out-of-order events. When the
   * database row is absent or permanently deleted, the index entry is deleted
   * instead. Comments are a no-op.
   *
   * @param model - the type of model being updated.
   * @param id - the id of the item to update.
   * @param _metadata - unused; full reload is performed instead.
   */
  public async updateMetadata(
    model: SearchableModel,
    id: string,
    _metadata: Record<string, unknown>
  ): Promise<void> {
    if (model === SearchableModel.Comment) {
      return;
    }

    if (model === SearchableModel.Document) {
      const document = await Document.findByPk(id, { paranoid: false });
      if (!document || document.deletedAt) {
        await this.remove(model, id, "");
        return;
      }
      await this.index(model, document);
      return;
    }

    if (model === SearchableModel.Collection) {
      const collection = await Collection.findByPk(id, { paranoid: false });
      if (!collection || collection.deletedAt) {
        await this.remove(model, id, "");
        return;
      }
      await this.index(model, collection);
    }
  }

  /**
   * Resolve the exact document ids covered by a public share.
   *
   * @param share - the share that authorizes the team search.
   * @returns document ids contained in the shared collection or document tree.
   */
  private async getShareDocumentIds(share: Share): Promise<string[]> {
    if (share.collectionId) {
      const collection =
        share.collection ??
        (await share.$get("collection", { scope: "unscoped" }));
      invariant(collection, "Cannot find collection for share");
      return collection.getAllDocumentIds();
    }

    invariant(
      share.documentId,
      "Share must reference a collection or document"
    );
    const document = share.document ?? (await share.$get("document"));
    invariant(document, "Cannot find document for share");

    if (!share.includeChildDocuments) {
      return [document.id];
    }

    const childDocumentIds = await document.findAllChildDocumentIds({
      archivedAt: { [Op.is]: null },
    });
    return [document.id, ...childDocumentIds];
  }

  /**
   * Convert an SDK failure into a stable 503 error. The original error is
   * logged with operation and index context but never exposed to the API,
   * since SDK messages may contain host or query details.
   *
   * @param err - the thrown SDK error.
   * @param operation - the provider operation that failed.
   * @param index - the index used by the failed operation.
   * @returns a {@link SearchServiceUnavailableError}.
   */
  private toSearchError(err: unknown, operation: string, index: string): Error {
    const safeError = new Error("Meilisearch request failed");
    safeError.name = err instanceof Error ? err.name : "UnknownError";
    Logger.error("Meilisearch search failure", safeError, {
      operation,
      index,
    });
    return SearchServiceUnavailableError();
  }
}

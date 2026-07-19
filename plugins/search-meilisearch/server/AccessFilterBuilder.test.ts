import type Team from "@server/models/Team";
import {
  DirectionFilter,
  SortFilter,
  StatusFilter,
  type DateFilter,
} from "@shared/types";
import { AccessFilterBuilder } from "./AccessFilterBuilder";
import type { UserAccessContext } from "./AccessFilterBuilder";

function ctx(overrides: Partial<UserAccessContext> = {}): UserAccessContext {
  return {
    teamId: "team-1",
    userId: "user-1",
    collectionIds: ["col-1"],
    groupIds: ["grp-1"],
    ...overrides,
  };
}

function team(overrides: Partial<Team> = {}): Team {
  return { id: "team-1", ...overrides } as Team;
}

describe("AccessFilterBuilder", () => {
  const builder = new AccessFilterBuilder();

  describe("buildForUser", () => {
    it("always includes team, deleted, template, and trial filters", () => {
      const filter = builder.buildForUser(ctx(), {});
      expect(filter).toMatch(/teamId = /);
      expect(filter).toMatch(/deletedAt IS NULL/);
      expect(filter).toMatch(/template = false/);
      expect(filter).toMatch(/trialImport = false/);
    });

    it("includes collection OR direct user OR direct group OR own uncollected draft", () => {
      const filter = builder.buildForUser(ctx(), {});
      expect(filter).toMatch(/collectionId IN/);
      expect(filter).toMatch(/directUserIds = /);
      expect(filter).toMatch(/directGroupIds IN/);
      expect(filter).toMatch(/collectionId IS NULL/);
      expect(filter).toMatch(/createdById = /);
      expect(filter).toMatch(/publishedAt IS NULL/);
    });

    it("produces valid syntax with no groups and no collections", () => {
      const filter = builder.buildForUser(
        ctx({ collectionIds: [], groupIds: [] }),
        {}
      );
      expect(typeof filter).toBe("string");
      expect(filter).not.toMatch(/IN \[\s*\]/);
    });

    it("ANDs an explicit collectionId and keeps team enforced", () => {
      const filter = builder.buildForUser(ctx(), {
        collectionId: "col-explicit",
      });
      expect(filter).toMatch(/collectionId = "col-explicit"/);
      expect(filter).toMatch(/teamId = /);
    });

    it("maps documentIds to a non-empty IN clause", () => {
      const filter = builder.buildForUser(ctx(), {
        documentIds: ["d1", "d2"],
      });
      expect(filter).toMatch(/id IN \["d1", "d2"\]/);
    });

    it("requires every collaborator id", () => {
      const filter = builder.buildForUser(ctx(), {
        collaboratorIds: ["c1", "c2"],
      });
      expect(filter).toContain('collaboratorIds = "c1"');
      expect(filter).toContain('collaboratorIds = "c2"');
    });

    it("maps a date filter to an epoch millisecond threshold", () => {
      const now = new Date("2026-07-18T00:00:00Z");
      const deterministicBuilder = new AccessFilterBuilder(() => now);
      const filter = deterministicBuilder.buildForUser(ctx(), {
        dateFilter: "day" as DateFilter,
      });
      expect(filter).toContain(
        `updatedAt > ${now.getTime() - 24 * 60 * 60 * 1000}`
      );
    });

    it("maps a published status filter to publishedAt IS NOT NULL AND archivedAt IS NULL", () => {
      const filter = builder.buildForUser(ctx(), {
        statusFilter: [StatusFilter.Published],
      });
      expect(filter).toMatch(/publishedAt IS NOT NULL/);
      expect(filter).toMatch(/archivedAt IS NULL/);
    });

    it("maps a draft status filter to publishedAt IS NULL", () => {
      const filter = builder.buildForUser(ctx(), {
        statusFilter: [StatusFilter.Draft],
      });
      expect(filter).toMatch(/publishedAt IS NULL/);
    });

    it("maps an archived status filter to archivedAt IS NOT NULL", () => {
      const filter = builder.buildForUser(ctx(), {
        statusFilter: [StatusFilter.Archived],
      });
      expect(filter).toMatch(/archivedAt IS NOT NULL/);
    });

    it("combines published and archived status filters", () => {
      const filter = builder.buildForUser(ctx(), {
        statusFilter: [StatusFilter.Published, StatusFilter.Archived],
      });
      expect(filter).toMatch(/publishedAt IS NOT NULL/);
      expect(filter).toMatch(/archivedAt IS NOT NULL/);
    });

    it("rejects ids containing quotes or backslashes", () => {
      const malicious = 'col"; OR 1=1';
      const filter = builder.buildForUser(ctx(), {
        collectionId: malicious,
      });
      // The value must be JSON-stringified, neutralizing the injection.
      // The quoted literal appears as `"col\"; OR 1=1"` with the double-quote
      // escaped, so it cannot terminate the string and inject a filter clause.
      expect(filter).toContain(JSON.stringify(malicious));
      // The malicious payload must not appear as a bare filter token (i.e.
      // `OR 1=1` must only appear inside the quoted literal, not as a
      // top-level clause). A top-level clause would be preceded by `AND `.
      expect(filter).not.toMatch(/AND OR 1=1/);
    });

    it("builds deterministically with many collection ids", () => {
      const ids = Array.from({ length: 10000 }, (_, i) => `col-${i}`);
      const filter = builder.buildForUser(ctx({ collectionIds: ids }), {});
      expect(typeof filter).toBe("string");
      // The first and last ids should appear in sorted order.
      expect(filter).toContain('"col-0"');
      expect(filter).toContain('"col-9999"');
    });
  });

  describe("buildForTeam", () => {
    it("always requires published and not archived", () => {
      const filter = builder.buildForTeam(team(), {});
      expect(filter).toMatch(/publishedAt IS NOT NULL/);
      expect(filter).toMatch(/archivedAt IS NULL/);
    });

    it("includes team, deleted, template, and trial filters", () => {
      const filter = builder.buildForTeam(team(), {});
      expect(filter).toMatch(/teamId = /);
      expect(filter).toMatch(/deletedAt IS NULL/);
      expect(filter).toMatch(/template = false/);
      expect(filter).toMatch(/trialImport = false/);
    });
  });

  describe("sort direction is not part of filter", () => {
    it("does not include sort text in the filter", () => {
      const filter = builder.buildForUser(ctx(), {
        sort: SortFilter.UpdatedAt,
        direction: DirectionFilter.ASC,
      });
      expect(filter).not.toMatch(/updatedAt:asc/);
    });
  });
});

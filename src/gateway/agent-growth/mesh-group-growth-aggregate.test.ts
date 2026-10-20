import { describe, expect, it } from "vitest";
import { createInitialGrowthStatus } from "./factory.js";
import {
  buildEmptyMeshGroupGrowthAggregate,
  buildMeshGroupGrowthAggregateFromStatuses,
  listTenantMeshGrowthGroupsFromSources,
} from "./mesh-group-growth-aggregate.js";
import type { GrowthStatus } from "./types.js";

function status(overrides: Partial<GrowthStatus>): GrowthStatus {
  return {
    ...createInitialGrowthStatus({ kind: "group", atMs: Date.now() - 10 * 86_400_000 }),
    ...overrides,
  };
}

describe("mesh group growth aggregate", () => {
  it("returns empty aggregate with zero groups", () => {
    const empty = buildEmptyMeshGroupGrowthAggregate();
    expect(empty.summary.groupCount).toBe(0);
    expect(empty.summary.trackedCount).toBe(0);
    expect(empty.ranking).toEqual([]);
  });

  it("lists only tenant-owned collaboration groups", () => {
    const groups = listTenantMeshGrowthGroupsFromSources({
      tenantId: "tenant-a",
      knownGroups: [
        { groupId: "grp-a", title: "Team A" },
        { groupId: "grp-b", title: "Team B" },
      ],
      ownershipRecords: [
        {
          id: "tenant-a:group:grp-a",
          tenantId: "tenant-a",
          subjectKind: "group",
          subjectId: "grp-a",
          positionId: "seat-a",
          positionLabel: "Seat A",
          createdByUserId: "u1",
          createdByUserLabel: "Admin",
          currentManagerUserId: "u1",
          currentManagerLabel: "Admin",
          bindingStatus: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "tenant-b:group:grp-b",
          tenantId: "tenant-b",
          subjectKind: "group",
          subjectId: "grp-b",
          positionId: "seat-b",
          positionLabel: "Seat B",
          createdByUserId: "u2",
          createdByUserLabel: "Admin B",
          currentManagerUserId: "u2",
          currentManagerLabel: "Admin B",
          bindingStatus: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(groups.map((entry) => entry.groupId)).toEqual(["grp-a"]);
  });

  it("aggregates alignment scores and ranks by growth velocity", () => {
    const now = Date.UTC(2026, 7, 4);
    const created = now - 10 * 86_400_000;
    const statuses = new Map<string, GrowthStatus | null>([
      [
        "fast-group",
        status({
          birthAtMs: created,
          milestones: { createdAtMs: created },
          lifecycleState: "mission_ready",
          activationScore: 80,
          operationalScore: 70,
          dimensions: {
            identity: 70,
            capability: 60,
            knowledge: 50,
            habits: 40,
            alignment: 90,
          },
        }),
      ],
      [
        "slow-group",
        status({
          birthAtMs: created,
          milestones: { createdAtMs: created },
          lifecycleState: "growing",
          activationScore: 40,
          operationalScore: 20,
          dimensions: {
            identity: 30,
            capability: 20,
            knowledge: 10,
            habits: 10,
            alignment: 50,
          },
        }),
      ],
    ]);

    const result = buildMeshGroupGrowthAggregateFromStatuses(
      [
        { groupId: "fast-group", name: "Fast Group" },
        { groupId: "slow-group", name: "Slow Group" },
      ],
      statuses,
      now,
    );

    expect(result.summary.groupCount).toBe(2);
    expect(result.summary.trackedCount).toBe(2);
    expect(result.summary.avgAlignmentScore).toBe(70);
    expect(result.ranking[0]?.groupId).toBe("fast-group");
    expect(result.ranking[0]?.alignmentScore).toBe(90);
  });
});

import { describe, expect, it } from "vitest";
import { createInitialGrowthStatus } from "./factory.js";
import {
  buildEmptyMeshGrowthAggregate,
  buildMeshGrowthAggregateFromStatuses,
} from "./mesh-growth-aggregate.js";
import {
  listTenantMeshGrowthAgentsFromSources,
  resolveMeshGrowthTenantScope,
} from "./mesh-growth-tenant-scope.js";
import type { GrowthStatus } from "./types.js";

describe("mesh growth tenant isolation", () => {
  it("returns empty aggregate when no tenant agents are in scope", () => {
    const empty = buildEmptyMeshGrowthAggregate();
    expect(empty.summary.botCount).toBe(0);
    expect(empty.summary.trackedCount).toBe(0);
    expect(empty.ranking).toEqual([]);
  });

  it("lists only agents bound to the requested tenant", () => {
    const gatewayAgents = [
      { id: "bot-a", name: "Tenant A Bot" },
      { id: "bot-b", name: "Tenant B Bot" },
    ] as never[];

    const agentsForA = listTenantMeshGrowthAgentsFromSources({
      tenantId: "tenant-a",
      gatewayAgents,
      ownershipRecords: [
        {
          id: "tenant-a:agent:bot-a",
          tenantId: "tenant-a",
          subjectKind: "agent",
          subjectId: "bot-a",
          positionId: "seat-a",
          positionLabel: "Seat A",
          createdByUserId: "u1",
          createdByUserLabel: "Admin A",
          currentManagerUserId: "u1",
          currentManagerLabel: "Admin A",
          bindingStatus: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "tenant-b:agent:bot-b",
          tenantId: "tenant-b",
          subjectKind: "agent",
          subjectId: "bot-b",
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
      seatStore: { version: 1, seats: {}, bindings: {}, assetBindings: {} } as never,
      runtimeAgents: [],
    });

    expect(agentsForA.map((entry) => entry.agentId)).toEqual(["bot-a"]);
    expect(agentsForA.some((entry) => entry.name.includes("Tenant B"))).toBe(false);
  });

  it("filters agents by positionId when provided", () => {
    const gatewayAgents = [
      { id: "bot-a", name: "Seat A Bot" },
      { id: "bot-b", name: "Seat B Bot" },
    ] as never[];

    const ownershipRecords = [
      {
        id: "tenant-a:agent:bot-a",
        tenantId: "tenant-a",
        subjectKind: "agent",
        subjectId: "bot-a",
        positionId: "seat-a",
        positionLabel: "Seat A",
        createdByUserId: "u1",
        createdByUserLabel: "Admin A",
        currentManagerUserId: "u1",
        currentManagerLabel: "Admin A",
        bindingStatus: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "tenant-a:agent:bot-b",
        tenantId: "tenant-a",
        subjectKind: "agent",
        subjectId: "bot-b",
        positionId: "seat-b",
        positionLabel: "Seat B",
        createdByUserId: "u1",
        createdByUserLabel: "Admin A",
        currentManagerUserId: "u1",
        currentManagerLabel: "Admin A",
        bindingStatus: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ] as const;

    const agentsForSeatA = listTenantMeshGrowthAgentsFromSources({
      tenantId: "tenant-a",
      gatewayAgents,
      ownershipRecords: [...ownershipRecords],
      seatStore: { version: 1, seats: {}, bindings: {}, assetBindings: {} } as never,
      runtimeAgents: [],
      positionId: "seat-a",
    });

    expect(agentsForSeatA.map((entry) => entry.agentId)).toEqual(["bot-a"]);
  });

  it("tenant A aggregate excludes tenant B growth stats and names", () => {
    const now = Date.UTC(2026, 7, 4);
    const created = now - 5 * 86_400_000;
    const makeStatus = (activationScore: number, lifecycleState: GrowthStatus["lifecycleState"]) =>
      ({
        ...createInitialGrowthStatus({ kind: "robot", atMs: created }),
        birthAtMs: created,
        milestones: { createdAtMs: created },
        lifecycleState,
        activationScore,
        operationalScore: 50,
      }) satisfies GrowthStatus;

    const statuses = new Map<string, GrowthStatus | null>([
      ["bot-a", makeStatus(80, "growing")],
      ["bot-b", makeStatus(99, "mission_ready")],
    ]);

    const result = buildMeshGrowthAggregateFromStatuses(
      [{ agentId: "bot-a", name: "Tenant A Bot" }],
      statuses,
      now,
    );

    expect(result.summary.botCount).toBe(1);
    expect(result.summary.trackedCount).toBe(1);
    expect(result.summary.avgActivationScore).toBe(80);
    expect(result.ranking.map((entry) => entry.agentId)).toEqual(["bot-a"]);
    expect(result.ranking.some((entry) => entry.name.includes("Tenant B"))).toBe(false);
    expect(result.ranking.some((entry) => entry.activationScore === 99)).toBe(false);
  });

  it("resolveMeshGrowthTenantScope fails closed when platform auth is disabled", async () => {
    await expect(
      resolveMeshGrowthTenantScope(
        {
          user: "admin@example.com",
          sessionMembershipId: "membership-a",
          sessionEnterpriseId: "ent-a",
        } as never,
        { gateway: { auth: {} } } as never,
      ),
    ).resolves.toEqual({ kind: "empty" });
  });
});

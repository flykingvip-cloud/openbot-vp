// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import { createAgentAsset } from "../agent-registry/registry.js";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import {
  assertSingleAuthoritativePolicySet,
  type LegacyAccessPolicyV1,
  migrateAccessPoliciesToV2,
} from "./policy-v1-adapter.js";

const NOW = "2026-07-31T00:00:00.000Z";

function registryWithLegacyAsset(): { registry: AgentRegistryStore; agentAssetId: string } {
  const registry = createEmptyAgentRegistryStore();
  const asset = createAgentAsset({
    store: registry,
    enterpriseId: "ent-a",
    agentSlug: "sales-bot",
    displayName: "Sales Bot",
    nowIso: NOW,
    legacyAgentId: "agent-legacy-1",
  });
  return { registry, agentAssetId: asset.agentAssetId };
}

function legacy(overrides: Partial<LegacyAccessPolicyV1>): LegacyAccessPolicyV1 {
  return {
    policyId: "v1-1",
    tenantId: "ent-a",
    subjectType: "employee",
    subjectId: "user-1",
    resourceType: "agent",
    resourceId: "agent-legacy-1",
    action: "read",
    effect: "allow",
    createdAt: NOW,
    ...overrides,
  };
}

function migrate(params: {
  registry: AgentRegistryStore;
  policies: LegacyAccessPolicyV1[];
  resolveMembershipIdForUser?: (userId: string) => string | null;
}) {
  return migrateAccessPoliciesToV2({
    policies: params.policies,
    registry: params.registry,
    enterpriseId: "ent-a",
    nowIso: NOW,
    resolveMembershipIdForUser:
      params.resolveMembershipIdForUser ??
      ((userId) => (userId === "user-1" ? "membership-1" : null)),
    makePolicyId: (legacyPolicyId, permission) => `${legacyPolicyId}:${permission}`,
  });
}

describe("v1 to V2 access policy migration", () => {
  it("maps an employee subject to an exact membership and the legacy agent to an asset", () => {
    const { registry, agentAssetId } = registryWithLegacyAsset();
    const result = migrate({ registry, policies: [legacy({})] });
    expect(result.skipped).toEqual([]);
    expect(result.migrated).toEqual([
      {
        policyId: "v1-1:agent.read",
        version: 2,
        enterpriseId: "ent-a",
        subjectType: "membership",
        subjectId: "membership-1",
        resourceType: "agent_asset",
        resourceId: agentAssetId,
        permission: "agent.read",
        effect: "allow",
        conditions: [{ kind: "requireAssetStatus", status: "active" }],
        derivedFrom: "v1-migration",
        createdAt: NOW,
      },
    ]);
  });

  it("keeps a seat subject as a seat", () => {
    const { registry } = registryWithLegacyAsset();
    const result = migrate({
      registry,
      policies: [legacy({ subjectType: "seat", subjectId: "seat-1", action: "execute" })],
    });
    expect(result.migrated[0]).toMatchObject({
      subjectType: "seat",
      subjectId: "seat-1",
      permission: "agent.execute",
    });
  });

  it("maps read, execute, and manage but quarantines write instead of widening it", () => {
    const { registry } = registryWithLegacyAsset();
    const result = migrate({
      registry,
      policies: [
        legacy({ policyId: "r", action: "read" }),
        legacy({ policyId: "x", action: "execute" }),
        legacy({ policyId: "m", action: "manage" }),
        legacy({ policyId: "w", action: "write" }),
      ],
    });
    expect(result.migrated.map((entry) => entry.permission)).toEqual([
      "agent.read",
      "agent.execute",
      "agent.manage",
    ]);
    // The detail is resource-qualified now that each resource type has its own map.
    expect(result.skipped).toEqual([
      { policyId: "w", reason: "unmappable-action", detail: "agent.write" },
    ]);
  });

  it("migrates the non-agent resource types added by ADR amendment 1", () => {
    const { registry } = registryWithLegacyAsset();
    const result = migrate({
      registry,
      policies: [
        legacy({ policyId: "seat", resourceType: "seat", resourceId: "seat-1", action: "read" }),
        legacy({ policyId: "space", resourceType: "space", resourceId: "space-1", action: "read" }),
        legacy({ policyId: "mem-r", resourceType: "memory", resourceId: "mem-1", action: "read" }),
        legacy({ policyId: "mem-w", resourceType: "memory", resourceId: "mem-1", action: "write" }),
        legacy({
          policyId: "cap",
          resourceType: "capability",
          resourceId: "cap-1",
          action: "execute",
        }),
      ],
    });
    expect(result.skipped).toEqual([]);
    expect(
      result.migrated.map(
        (entry) => `${entry.resourceType}:${entry.permission}:${entry.resourceId}`,
      ),
    ).toEqual([
      "seat:seat.read:seat-1",
      "space:space.read:space-1",
      "memory:memory.read:mem-1",
      "memory:memory.write:mem-1",
      "capability:capability.execute:cap-1",
    ]);
  });

  it("keeps the v1 resource id for non-canonical types and adds no asset condition", () => {
    const { registry } = registryWithLegacyAsset();
    const [policy] = migrate({
      registry,
      policies: [legacy({ resourceType: "memory", resourceId: "mem-1", action: "read" })],
    }).migrated;
    expect(policy.resourceId).toBe("mem-1");
    expect(policy.conditions).toBeUndefined();
  });

  it("still refuses an action a resource type does not express", () => {
    const { registry } = registryWithLegacyAsset();
    const result = migrate({
      registry,
      policies: [
        legacy({ policyId: "seat-w", resourceType: "seat", resourceId: "seat-1", action: "write" }),
        legacy({ policyId: "cap-w", resourceType: "capability", resourceId: "c", action: "write" }),
      ],
    });
    expect(result.migrated).toEqual([]);
    expect(result.skipped.map((entry) => entry.detail)).toEqual(["seat.write", "capability.write"]);
  });

  it("never synthesizes ownership transfer or growth permissions", () => {
    const { registry } = registryWithLegacyAsset();
    const result = migrate({
      registry,
      policies: [legacy({ action: "manage" })],
    });
    const permissions = result.migrated.map((entry) => entry.permission);
    expect(permissions).not.toContain("agent.ownership.transfer");
    expect(permissions.some((permission) => permission.startsWith("growth."))).toBe(false);
  });

  it("reports a resource type V2 still does not represent rather than dropping it", () => {
    const { registry } = registryWithLegacyAsset();
    const result = migrate({
      registry,
      policies: [
        legacy({ policyId: "identity", resourceType: "identity", resourceId: "id-1" }),
        legacy({ policyId: "ds", resourceType: "data_source", resourceId: "ds-1" }),
      ],
    });
    expect(result.migrated).toEqual([]);
    expect(result.skipped).toEqual([
      { policyId: "identity", reason: "unsupported-resource", detail: "identity" },
      { policyId: "ds", reason: "unsupported-resource", detail: "data_source" },
    ]);
  });

  it("skips revoked rows", () => {
    const { registry } = registryWithLegacyAsset();
    const result = migrate({ registry, policies: [legacy({ revokedAt: NOW })] });
    expect(result.migrated).toEqual([]);
    expect(result.skipped).toEqual([{ policyId: "v1-1", reason: "revoked" }]);
  });

  it("skips an unresolvable or ambiguous legacy agent instead of guessing", () => {
    const { registry } = registryWithLegacyAsset();
    const unresolved = migrate({
      registry,
      policies: [legacy({ policyId: "missing", resourceId: "agent-legacy-missing" })],
    });
    expect(unresolved.skipped).toEqual([
      { policyId: "missing", reason: "legacy-agent-unresolved", detail: "agent-legacy-missing" },
    ]);

    createAgentAsset({
      store: registry,
      enterpriseId: "ent-a",
      agentSlug: "sales-bot-2",
      displayName: "Second",
      nowIso: NOW,
      legacyAgentId: "agent-legacy-1",
    });
    const ambiguous = migrate({ registry, policies: [legacy({ policyId: "dupe" })] });
    expect(ambiguous.migrated).toEqual([]);
    expect(ambiguous.skipped).toEqual([
      { policyId: "dupe", reason: "legacy-agent-ambiguous", detail: "agent-legacy-1" },
    ]);
  });

  it("skips a universal builtin without calling it unresolved", () => {
    // ADR amendment 2. Distinct from `legacy-agent-unresolved` on purpose: nothing is
    // lost, because the runtime grants that agent to every employee regardless of policy.
    const { registry } = registryWithLegacyAsset();
    const result = migrate({
      registry,
      policies: [legacy({ policyId: "steward", resourceId: "main", action: "execute" })],
    });
    expect(result.migrated).toEqual([]);
    expect(result.skipped).toEqual([
      { policyId: "steward", reason: "builtin-not-an-asset", detail: "main" },
    ]);
  });

  it("skips an employee whose membership cannot be resolved exactly", () => {
    const { registry } = registryWithLegacyAsset();
    const result = migrate({
      registry,
      policies: [legacy({ subjectId: "user-unknown" })],
      resolveMembershipIdForUser: () => null,
    });
    expect(result.migrated).toEqual([]);
    expect(result.skipped).toEqual([
      { policyId: "v1-1", reason: "membership-unresolved", detail: "user-unknown" },
    ]);
  });

  it("ignores rows from another tenant", () => {
    const { registry } = registryWithLegacyAsset();
    const result = migrate({ registry, policies: [legacy({ tenantId: "ent-b" })] });
    expect(result).toEqual({ migrated: [], skipped: [] });
  });
});

describe("single authoritative policy set", () => {
  it("refuses to enable V2 while active v1 policies remain", () => {
    expect(() =>
      assertSingleAuthoritativePolicySet({
        enterpriseId: "ent-a",
        activeV1Count: 3,
        v2Enabled: true,
      }),
    ).toThrow(/still has 3 active v1 policies/);
  });

  it("allows V2 once v1 is drained, and allows v1 while V2 is off", () => {
    expect(() =>
      assertSingleAuthoritativePolicySet({
        enterpriseId: "ent-a",
        activeV1Count: 0,
        v2Enabled: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertSingleAuthoritativePolicySet({
        enterpriseId: "ent-a",
        activeV1Count: 5,
        v2Enabled: false,
      }),
    ).not.toThrow();
  });
});

// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import { setPrimaryOwner } from "../agent-registry/ownership.js";
import { createAgentAsset } from "../agent-registry/registry.js";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import {
  applyBuiltinArtifactRetirement,
  applyStaleSeatAgentDefaults,
  planBuiltinArtifactRetirement,
  planStaleSeatAgentDefaults,
  type SeatAgentDefaults,
} from "./cutover-cleanup.js";
import { createEmptyAccessPolicyStore } from "./policy-store.js";
import type { EnterpriseAccessPolicyV2 } from "./policy-v2-types.js";

const NOW = "2026-08-01T00:00:00.000Z";
const LATER = "2026-08-01T01:00:00.000Z";
const ENT = "ent-a";

function policy(overrides: Partial<EnterpriseAccessPolicyV2>): EnterpriseAccessPolicyV2 {
  return {
    policyId: "p-1",
    version: 2,
    enterpriseId: ENT,
    subjectType: "membership",
    subjectId: "membership-1",
    resourceType: "agent_asset",
    resourceId: "asset-1",
    permission: "agent.execute",
    effect: "allow",
    createdAt: NOW,
    ...overrides,
  };
}

/** Registry with a real asset plus the stray builtin asset existing tenants have. */
function stores() {
  const registry = createEmptyAgentRegistryStore();
  const sales = createAgentAsset({
    store: registry,
    enterpriseId: ENT,
    agentSlug: "sales-bot",
    displayName: "Sales Bot",
    nowIso: NOW,
    legacyAgentId: "legacy-sales",
  });
  const steward = createAgentAsset({
    store: registry,
    enterpriseId: ENT,
    agentSlug: "steward",
    displayName: "Steward",
    nowIso: NOW,
    legacyAgentId: "main",
  });
  for (const ref of [sales, steward]) {
    setPrimaryOwner({
      store: registry,
      ref: { enterpriseId: ENT, agentAssetId: ref.agentAssetId },
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso: NOW,
    });
  }
  const policyStore = createEmptyAccessPolicyStore();
  for (const entry of [
    policy({ policyId: "keep", resourceId: sales.agentAssetId }),
    policy({ policyId: "retire-1", resourceId: steward.agentAssetId }),
    policy({
      policyId: "retire-2",
      resourceId: steward.agentAssetId,
      subjectType: "seat",
      subjectId: "seat-1",
    }),
  ]) {
    policyStore.policies[entry.policyId] = entry;
  }
  return { registry, policyStore, salesId: sales.agentAssetId, stewardId: steward.agentAssetId };
}

describe("builtin artifact retirement", () => {
  it("selects only the builtin asset, its open binding, and its policies", () => {
    const { registry, policyStore, stewardId } = stores();
    const plan = planBuiltinArtifactRetirement({ registry, policyStore, enterpriseId: ENT });
    expect(plan.assetIds).toEqual([stewardId]);
    expect(plan.policyIds).toEqual(["retire-1", "retire-2"]);
    expect(plan.ownerBindingIds).toHaveLength(1);
  });

  it("matches on the slug as well, since agents.create keys on it", () => {
    const registry = createEmptyAgentRegistryStore();
    // No legacyAgentId at all: created through agents.create rather than backfilled.
    const asset = createAgentAsset({
      store: registry,
      enterpriseId: ENT,
      agentSlug: "main",
      displayName: "Steward",
      nowIso: NOW,
    });
    const plan = planBuiltinArtifactRetirement({
      registry,
      policyStore: createEmptyAccessPolicyStore(),
      enterpriseId: ENT,
    });
    expect(plan.assetIds).toEqual([asset.agentAssetId]);
  });

  it("ignores another enterprise and an already archived asset", () => {
    const { registry, policyStore } = stores();
    for (const asset of Object.values(registry.assets)) {
      asset.enterpriseId = "ent-b";
    }
    expect(
      planBuiltinArtifactRetirement({ registry, policyStore, enterpriseId: ENT }).assetIds,
    ).toEqual([]);

    const second = stores();
    const plan = planBuiltinArtifactRetirement({
      registry: second.registry,
      policyStore: second.policyStore,
      enterpriseId: ENT,
    });
    applyBuiltinArtifactRetirement({
      registry: second.registry,
      policyStore: second.policyStore,
      plan,
      nowIso: LATER,
    });
    // Second planning pass finds nothing: the work is idempotent.
    expect(
      planBuiltinArtifactRetirement({
        registry: second.registry,
        policyStore: second.policyStore,
        enterpriseId: ENT,
      }),
    ).toEqual({ assetIds: [], ownerBindingIds: [], policyIds: [] });
  });

  it("archives rather than deletes, and soft revokes the policies", () => {
    const { registry, policyStore, salesId, stewardId } = stores();
    const plan = planBuiltinArtifactRetirement({ registry, policyStore, enterpriseId: ENT });
    const result = applyBuiltinArtifactRetirement({ registry, policyStore, plan, nowIso: LATER });

    expect(result).toEqual({ archivedAssets: 1, closedBindings: 1, revokedPolicies: 2 });
    // History survives: the record that these artifacts existed is the point.
    expect(registry.assets[stewardId]).toMatchObject({ status: "archived", updatedAt: LATER });
    expect(policyStore.policies["retire-1"].revokedAt).toBe(LATER);
    expect(
      Object.values(registry.ownerBindings).find(
        (binding) => binding.agentAssetId === stewardId && binding.endedAt,
      ),
    ).toMatchObject({ endedReason: "asset_archived" });

    // The real asset is untouched.
    expect(registry.assets[salesId].status).toBe("active");
    expect(policyStore.policies.keep.revokedAt).toBeUndefined();
  });
});

describe("stale seat agent defaults", () => {
  function seats(defaults: string[]): SeatAgentDefaults[] {
    return [{ seatId: "seat-1", tenantId: ENT, defaultAgentAssetIds: [...defaults] }];
  }

  it("removes an agent that is both absent from the runtime and disowned", () => {
    const plan = planStaleSeatAgentDefaults({
      seats: seats(["legacy-sales", "bot"]),
      tenantId: ENT,
      configuredAgentIds: new Set(["legacy-sales"]),
      activelyOwnedAgentIds: new Set(["legacy-sales"]),
    });
    expect(plan.remove).toEqual([
      { seatId: "seat-1", legacyAgentId: "bot", missingFromConfig: true, ownershipGone: true },
    ]);
    expect(plan.review).toEqual([]);
  });

  it("only reports an entry that fails one condition", () => {
    // Either signal alone can be transient, so acting on it would risk taking away access.
    const plan = planStaleSeatAgentDefaults({
      seats: seats(["disowned", "unconfigured"]),
      tenantId: ENT,
      configuredAgentIds: new Set(["disowned"]),
      activelyOwnedAgentIds: new Set(["unconfigured"]),
    });
    expect(plan.remove).toEqual([]);
    expect(plan.review.map((entry) => entry.legacyAgentId)).toEqual(["disowned", "unconfigured"]);
  });

  it("never treats a universal builtin as stale", () => {
    // The runtime injects it for every employee, so a seat does not control access to it.
    const plan = planStaleSeatAgentDefaults({
      seats: seats(["main"]),
      tenantId: ENT,
      configuredAgentIds: new Set(),
      activelyOwnedAgentIds: new Set(),
    });
    expect(plan).toEqual({ remove: [], review: [] });
  });

  it("ignores seats from another tenant", () => {
    const plan = planStaleSeatAgentDefaults({
      seats: [{ seatId: "seat-9", tenantId: "ent-b", defaultAgentAssetIds: ["bot"] }],
      tenantId: ENT,
      configuredAgentIds: new Set(),
      activelyOwnedAgentIds: new Set(),
    });
    expect(plan.remove).toEqual([]);
  });

  it("drops only the planned ids and reports which seats changed", () => {
    const rows = seats(["legacy-sales", "bot"]);
    const plan = planStaleSeatAgentDefaults({
      seats: rows,
      tenantId: ENT,
      configuredAgentIds: new Set(["legacy-sales"]),
      activelyOwnedAgentIds: new Set(["legacy-sales"]),
    });
    expect(applyStaleSeatAgentDefaults({ seats: rows, plan })).toEqual(["seat-1"]);
    expect(rows[0].defaultAgentAssetIds).toEqual(["legacy-sales"]);
    // Idempotent: a second apply changes nothing.
    expect(applyStaleSeatAgentDefaults({ seats: rows, plan })).toEqual([]);
  });
});

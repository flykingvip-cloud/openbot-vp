// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import { createAgentAsset } from "../agent-registry/registry.js";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import {
  type MembershipLookupStore,
  migrateTenantPolicies,
  resolveTenantMembershipIdForUser,
} from "./migration-runner.js";
import type { LegacyAccessPolicyV1 } from "./policy-v1-adapter.js";

const NOW = "2026-07-31T00:00:00.000Z";

function platformStore(): MembershipLookupStore {
  return {
    memberships: {
      "mem-a": { id: "mem-a", userId: "user-1", enterpriseId: "ent-a" },
      // Same user in another enterprise: must not satisfy an ent-a lookup.
      "mem-b": { id: "mem-b", userId: "user-1", enterpriseId: "ent-b" },
    },
  };
}

function registryWithLegacy(): AgentRegistryStore {
  const registry = createEmptyAgentRegistryStore();
  createAgentAsset({
    store: registry,
    enterpriseId: "ent-a",
    agentSlug: "sales-bot",
    displayName: "Sales Bot",
    nowIso: NOW,
    legacyAgentId: "agent-legacy-1",
  });
  return registry;
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

function run(policies: LegacyAccessPolicyV1[], registry = registryWithLegacy()) {
  return migrateTenantPolicies({
    enterpriseId: "ent-a",
    policies,
    registry,
    platformStore: platformStore(),
    nowIso: NOW,
  });
}

describe("tenant membership resolution for v1 employees", () => {
  it("binds a user to its single membership inside the tenant", () => {
    expect(
      resolveTenantMembershipIdForUser({
        store: platformStore(),
        enterpriseId: "ent-a",
        userId: "user-1",
      }),
    ).toBe("mem-a");
  });

  it("does not borrow a membership from another enterprise", () => {
    expect(
      resolveTenantMembershipIdForUser({
        store: platformStore(),
        enterpriseId: "ent-c",
        userId: "user-1",
      }),
    ).toBeNull();
  });

  it("returns null when the user has two memberships in the same tenant", () => {
    expect(
      resolveTenantMembershipIdForUser({
        store: {
          memberships: {
            one: { id: "one", userId: "user-1", enterpriseId: "ent-a" },
            two: { id: "two", userId: "user-1", enterpriseId: "ent-a" },
          },
        },
        enterpriseId: "ent-a",
        userId: "user-1",
      }),
    ).toBeNull();
  });
});

describe("tenant policy migration report", () => {
  it("migrates a mappable grant with a deterministic id", () => {
    const report = run([legacy({})]);
    expect(report.migrated).toBe(1);
    expect(report.result.migrated[0]).toMatchObject({
      policyId: "v1:v1-1:agent.read",
      subjectType: "membership",
      subjectId: "mem-a",
      permission: "agent.read",
      derivedFrom: "v1-migration",
    });
    expect(report.needsDecision).toEqual([]);
  });

  it("counts expected skips without asking for a decision", () => {
    const report = run([
      legacy({ policyId: "revoked", revokedAt: NOW }),
      // `identity` is still outside V2 after ADR amendment 1.
      legacy({ policyId: "identity", resourceType: "identity", resourceId: "id-1" }),
    ]);
    expect(report.migrated).toBe(0);
    expect(report.skipped).toMatchObject({ revoked: 1, "unsupported-resource": 1 });
    expect(report.needsDecision).toEqual([]);
  });

  it("surfaces the four blocking reasons for adjudication", () => {
    const registry = registryWithLegacy();
    // A second asset with the same legacy id makes resolution ambiguous.
    createAgentAsset({
      store: registry,
      enterpriseId: "ent-a",
      agentSlug: "sales-bot-2",
      displayName: "Second",
      nowIso: NOW,
      legacyAgentId: "agent-legacy-dupe",
    });
    createAgentAsset({
      store: registry,
      enterpriseId: "ent-a",
      agentSlug: "sales-bot-3",
      displayName: "Third",
      nowIso: NOW,
      legacyAgentId: "agent-legacy-dupe",
    });

    const report = migrateTenantPolicies({
      enterpriseId: "ent-a",
      policies: [
        legacy({ policyId: "write", action: "write" }),
        legacy({ policyId: "missing-agent", resourceId: "agent-unknown" }),
        legacy({ policyId: "dupe-agent", resourceId: "agent-legacy-dupe" }),
        legacy({ policyId: "unknown-user", subjectId: "user-nobody" }),
      ],
      registry,
      platformStore: platformStore(),
      nowIso: NOW,
    });

    expect(report.migrated).toBe(0);
    expect(report.needsDecision.map((entry) => entry.reason).toSorted()).toEqual([
      "legacy-agent-ambiguous",
      "legacy-agent-unresolved",
      "membership-unresolved",
      "unmappable-action",
    ]);
  });

  it("keeps seat subjects out of the membership lookup", () => {
    const report = run([legacy({ subjectType: "seat", subjectId: "seat-1", action: "execute" })]);
    expect(report.result.migrated[0]).toMatchObject({
      subjectType: "seat",
      subjectId: "seat-1",
      permission: "agent.execute",
    });
  });

  it("ignores policies belonging to another tenant", () => {
    const report = run([legacy({ tenantId: "ent-b" })]);
    expect(report.migrated).toBe(0);
    expect(report.needsDecision).toEqual([]);
    expect(Object.values(report.skipped).every((count) => count === 0)).toBe(true);
  });
});

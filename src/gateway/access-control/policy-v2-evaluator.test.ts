// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import { setPrimaryOwner } from "../agent-registry/ownership.js";
import { createAgentAsset } from "../agent-registry/registry.js";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import type { AgentRef, AgentRegistryStore } from "../agent-registry/types.js";
import { buildOwnerBaselinePolicies, evaluateAgentAssetAccess } from "./policy-v2-evaluator.js";
import type { AccessSubject, EnterpriseAccessPolicyV2 } from "./policy-v2-types.js";
import { ANY_RESOURCE } from "./policy-v2-types.js";

const NOW = "2026-07-31T00:00:00.000Z";

function setup(): { registry: AgentRegistryStore; ref: AgentRef } {
  const registry = createEmptyAgentRegistryStore();
  const asset = createAgentAsset({
    store: registry,
    enterpriseId: "ent-a",
    agentSlug: "sales-bot",
    displayName: "Sales Bot",
    nowIso: NOW,
  });
  return { registry, ref: { enterpriseId: "ent-a", agentAssetId: asset.agentAssetId } };
}

function policy(overrides: Partial<EnterpriseAccessPolicyV2>): EnterpriseAccessPolicyV2 {
  return {
    policyId: overrides.policyId ?? "policy-1",
    version: 2,
    enterpriseId: "ent-a",
    subjectType: "membership",
    subjectId: "membership-1",
    resourceType: "agent_asset",
    resourceId: ANY_RESOURCE,
    permission: "agent.read",
    effect: "allow",
    createdAt: NOW,
    ...overrides,
  };
}

const MEMBER: AccessSubject = {
  subjectType: "membership",
  subjectId: "membership-1",
  status: "active",
};

function evaluate(params: {
  registry: AgentRegistryStore;
  ref: AgentRef;
  policies: EnterpriseAccessPolicyV2[];
  subject?: AccessSubject;
  permission?: string;
  resolveMembershipSubject?: (id: string) => AccessSubject | null;
}) {
  return evaluateAgentAssetAccess({
    policies: params.policies,
    registry: params.registry,
    subject: params.subject ?? MEMBER,
    resource: params.ref,
    permission: params.permission ?? "agent.read",
    ...(params.resolveMembershipSubject
      ? { resolveMembershipSubject: params.resolveMembershipSubject }
      : {}),
  });
}

describe("EnterpriseAccessPolicyV2 evaluator", () => {
  it("defaults to deny with no policy", () => {
    const { registry, ref } = setup();
    expect(evaluate({ registry, ref, policies: [] })).toEqual({
      allowed: false,
      reason: "no-matching-policy",
    });
  });

  it("allows an explicit matching policy", () => {
    const { registry, ref } = setup();
    expect(evaluate({ registry, ref, policies: [policy({})] })).toEqual({
      allowed: true,
      matchedPolicyId: "policy-1",
    });
  });

  it("lets an explicit deny win over an allow regardless of order", () => {
    const { registry, ref } = setup();
    const allow = policy({ policyId: "allow-1" });
    const deny = policy({ policyId: "deny-1", effect: "deny" });
    expect(evaluate({ registry, ref, policies: [allow, deny] })).toEqual({
      allowed: false,
      reason: "explicit-deny",
      matchedPolicyId: "deny-1",
    });
    expect(evaluate({ registry, ref, policies: [deny, allow] })).toEqual({
      allowed: false,
      reason: "explicit-deny",
      matchedPolicyId: "deny-1",
    });
  });

  it("hard denies when the policy or request crosses an enterprise", () => {
    const { registry, ref } = setup();
    // Policy issued for another enterprise must never apply.
    expect(evaluate({ registry, ref, policies: [policy({ enterpriseId: "ent-b" })] })).toEqual({
      allowed: false,
      reason: "no-matching-policy",
    });
    // Same asset id requested under the wrong enterprise resolves to nothing.
    expect(
      evaluate({
        registry,
        ref: { enterpriseId: "ent-b", agentAssetId: ref.agentAssetId },
        policies: [policy({ enterpriseId: "ent-b" })],
      }),
    ).toEqual({ allowed: false, reason: "asset-missing" });
  });

  it("rejects a permission outside the frozen set", () => {
    const { registry, ref } = setup();
    expect(evaluate({ registry, ref, policies: [policy({})], permission: "agent.write" })).toEqual({
      allowed: false,
      reason: "unknown-permission",
    });
  });

  it("fails closed for an inactive subject, revoked policy, or inactive asset", () => {
    const { registry, ref } = setup();
    expect(
      evaluate({
        registry,
        ref,
        policies: [policy({})],
        subject: { ...MEMBER, status: "suspended" },
      }),
    ).toEqual({ allowed: false, reason: "subject-inactive" });

    expect(evaluate({ registry, ref, policies: [policy({ revokedAt: NOW })] })).toEqual({
      allowed: false,
      reason: "no-matching-policy",
    });

    registry.assets[ref.agentAssetId].status = "suspended";
    expect(evaluate({ registry, ref, policies: [policy({})] })).toEqual({
      allowed: false,
      reason: "asset-inactive",
    });
  });

  it("fails closed on an unknown condition instead of ignoring it", () => {
    const { registry, ref } = setup();
    const broken = policy({
      conditions: [{ kind: "requireTimeWindow" } as never],
    });
    expect(evaluate({ registry, ref, policies: [broken] })).toEqual({
      allowed: false,
      reason: "unknown-condition",
    });
  });

  it("does not let an unknown condition neutralize a deny", () => {
    const { registry, ref } = setup();
    const deny = policy({
      policyId: "deny-1",
      effect: "deny",
      conditions: [{ kind: "requireTimeWindow" } as never],
    });
    // The deny cannot be enforced, so access must not be granted either.
    expect(evaluate({ registry, ref, policies: [policy({ policyId: "allow-1" }), deny] })).toEqual({
      allowed: false,
      reason: "unknown-condition",
    });
  });

  it("reports an unsatisfied typed condition separately from a missing policy", () => {
    const { registry, ref } = setup();
    expect(
      evaluate({
        registry,
        ref,
        policies: [policy({ conditions: [{ kind: "requireOwnerBinding" }] })],
      }),
    ).toEqual({ allowed: false, reason: "condition-unsatisfied" });
  });
});

describe("owner baseline materialization", () => {
  it("produces explicit auditable policies instead of an implicit bypass", () => {
    const { registry, ref } = setup();
    setPrimaryOwner({
      store: registry,
      ref,
      ownerType: "membership",
      ownerId: "membership-1",
      nowIso: NOW,
    });
    const baseline = buildOwnerBaselinePolicies({
      registry,
      resource: ref,
      nowIso: NOW,
      makePolicyId: (permission) => `owner-${permission}`,
    });
    expect(baseline.map((entry) => entry.permission)).toEqual([
      "agent.read",
      "agent.execute",
      "agent.manage",
      "growth.read",
    ]);
    expect(baseline.every((entry) => entry.derivedFrom === "owner-baseline")).toBe(true);

    expect(evaluate({ registry, ref, policies: baseline, permission: "agent.manage" })).toEqual({
      allowed: true,
      matchedPolicyId: "owner-agent.manage",
    });
    // Ownership does not imply transfer or Growth mutation rights.
    expect(
      evaluate({ registry, ref, policies: baseline, permission: "agent.ownership.transfer" }),
    ).toEqual({ allowed: false, reason: "no-matching-policy" });
    expect(evaluate({ registry, ref, policies: baseline, permission: "growth.correct" })).toEqual({
      allowed: false,
      reason: "no-matching-policy",
    });
  });

  it("stops granting baseline access once ownership moves", () => {
    const { registry, ref } = setup();
    setPrimaryOwner({
      store: registry,
      ref,
      ownerType: "membership",
      ownerId: "membership-1",
      nowIso: NOW,
    });
    const baseline = buildOwnerBaselinePolicies({
      registry,
      resource: ref,
      nowIso: NOW,
      makePolicyId: (permission) => `owner-${permission}`,
    });
    setPrimaryOwner({
      store: registry,
      ref,
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso: "2026-07-31T01:00:00.000Z",
    });
    // The stale policy still exists but its owner condition no longer holds.
    expect(evaluate({ registry, ref, policies: baseline })).toEqual({
      allowed: false,
      reason: "condition-unsatisfied",
    });
  });

  it("returns nothing when ownership is absent or ambiguous", () => {
    const { registry, ref } = setup();
    expect(
      buildOwnerBaselinePolicies({
        registry,
        resource: ref,
        nowIso: NOW,
        makePolicyId: (permission) => `owner-${permission}`,
      }),
    ).toEqual([]);
  });
});

describe("service principal delegation", () => {
  const PRINCIPAL: AccessSubject = {
    subjectType: "service_principal",
    subjectId: "sp-1",
    status: "active",
    onBehalfOfMembershipId: "membership-1",
  };

  function principalPolicies(): EnterpriseAccessPolicyV2[] {
    return [
      policy({ policyId: "sp-allow", subjectType: "service_principal", subjectId: "sp-1" }),
      policy({ policyId: "member-allow" }),
    ];
  }

  it("allows only the intersection of principal and membership permissions", () => {
    const { registry, ref } = setup();
    expect(
      evaluate({
        registry,
        ref,
        policies: principalPolicies(),
        subject: PRINCIPAL,
        resolveMembershipSubject: () => MEMBER,
      }),
    ).toEqual({ allowed: true, matchedPolicyId: "sp-allow" });
  });

  it("denies when the membership lacks the permission, even if the principal has it", () => {
    const { registry, ref } = setup();
    expect(
      evaluate({
        registry,
        ref,
        policies: [
          policy({ policyId: "sp-allow", subjectType: "service_principal", subjectId: "sp-1" }),
        ],
        subject: PRINCIPAL,
        resolveMembershipSubject: () => MEMBER,
      }),
    ).toEqual({ allowed: false, reason: "principal-intersection-empty" });
  });

  it("denies when the membership is unknown, inactive, or not declared", () => {
    const { registry, ref } = setup();
    expect(
      evaluate({
        registry,
        ref,
        policies: principalPolicies(),
        subject: PRINCIPAL,
        resolveMembershipSubject: () => null,
      }),
    ).toEqual({ allowed: false, reason: "principal-membership-missing" });

    expect(
      evaluate({
        registry,
        ref,
        policies: principalPolicies(),
        subject: PRINCIPAL,
        resolveMembershipSubject: () => ({ ...MEMBER, status: "revoked" }),
      }),
    ).toEqual({ allowed: false, reason: "principal-membership-missing" });

    expect(
      evaluate({
        registry,
        ref,
        policies: principalPolicies(),
        subject: { ...PRINCIPAL, onBehalfOfMembershipId: undefined },
        resolveMembershipSubject: () => MEMBER,
      }),
    ).toEqual({ allowed: false, reason: "principal-membership-missing" });
  });

  it("honours a deny that targets the delegated membership", () => {
    const { registry, ref } = setup();
    expect(
      evaluate({
        registry,
        ref,
        policies: [...principalPolicies(), policy({ policyId: "member-deny", effect: "deny" })],
        subject: PRINCIPAL,
        resolveMembershipSubject: () => MEMBER,
      }),
    ).toEqual({ allowed: false, reason: "explicit-deny", matchedPolicyId: "member-deny" });
  });

  it("fails closed when an unknown condition sits on the delegated membership", () => {
    // Regression: the principal's own scan checked `unknownCondition`, the delegated
    // membership scan did not. An unenforceable deny on the membership was therefore
    // skipped and the principal's allow carried the decision, widening delegated access.
    const { registry, ref } = setup();
    expect(
      evaluate({
        registry,
        ref,
        policies: [
          ...principalPolicies(),
          policy({
            policyId: "member-deny-unknown",
            effect: "deny",
            conditions: [{ kind: "requireTimeWindow" } as never],
          }),
        ],
        subject: PRINCIPAL,
        resolveMembershipSubject: () => MEMBER,
      }),
    ).toEqual({ allowed: false, reason: "unknown-condition" });
  });

  it("fails closed when the membership allow itself carries an unknown condition", () => {
    const { registry, ref } = setup();
    expect(
      evaluate({
        registry,
        ref,
        policies: [
          policy({ policyId: "sp-allow", subjectType: "service_principal", subjectId: "sp-1" }),
          policy({
            policyId: "member-allow-unknown",
            conditions: [{ kind: "requireTimeWindow" } as never],
          }),
        ],
        subject: PRINCIPAL,
        resolveMembershipSubject: () => MEMBER,
      }),
    ).toEqual({ allowed: false, reason: "unknown-condition" });
  });

  it("does not let a principal inherit the owner baseline of its membership", () => {
    const { registry, ref } = setup();
    setPrimaryOwner({
      store: registry,
      ref,
      ownerType: "membership",
      ownerId: "membership-1",
      nowIso: NOW,
    });
    const baseline = buildOwnerBaselinePolicies({
      registry,
      resource: ref,
      nowIso: NOW,
      makePolicyId: (permission) => `owner-${permission}`,
    });
    // The principal has its own allow, but the owner condition is subject scoped.
    expect(
      evaluate({
        registry,
        ref,
        policies: [
          ...baseline,
          policy({
            policyId: "sp-owner-like",
            subjectType: "service_principal",
            subjectId: "sp-1",
            conditions: [{ kind: "requireOwnerBinding" }],
          }),
        ],
        subject: PRINCIPAL,
        resolveMembershipSubject: () => MEMBER,
      }),
    ).toEqual({ allowed: false, reason: "condition-unsatisfied" });
  });
});

describe("non-canonical resource types (ADR amendment 1)", () => {
  const MEMORY = {
    enterpriseId: "ent-a",
    resourceType: "memory",
    resourceId: "mem-1",
  } as const;

  function memoryPolicy(overrides: Partial<EnterpriseAccessPolicyV2>): EnterpriseAccessPolicyV2 {
    return policy({
      resourceType: "memory",
      resourceId: "mem-1",
      permission: "memory.read",
      ...overrides,
    });
  }

  it("allows a matching grant without needing a registry entry", () => {
    const { registry } = setup();
    expect(
      evaluateAgentAssetAccess({
        policies: [memoryPolicy({})],
        registry,
        subject: MEMBER,
        resource: MEMORY,
        permission: "memory.read",
      }),
    ).toEqual({ allowed: true, matchedPolicyId: "policy-1" });
  });

  it("keeps default deny and explicit deny for the new types", () => {
    const { registry } = setup();
    expect(
      evaluateAgentAssetAccess({
        policies: [],
        registry,
        subject: MEMBER,
        resource: MEMORY,
        permission: "memory.write",
      }),
    ).toEqual({ allowed: false, reason: "no-matching-policy" });

    expect(
      evaluateAgentAssetAccess({
        policies: [
          memoryPolicy({ policyId: "allow-1", permission: "memory.write" }),
          memoryPolicy({ policyId: "deny-1", permission: "memory.write", effect: "deny" }),
        ],
        registry,
        subject: MEMBER,
        resource: MEMORY,
        permission: "memory.write",
      }),
    ).toEqual({ allowed: false, reason: "explicit-deny", matchedPolicyId: "deny-1" });
  });

  it("refuses a permission that belongs to another resource type", () => {
    const { registry, ref } = setup();
    // memory.read must not be assertable against an agent asset...
    expect(
      evaluateAgentAssetAccess({
        policies: [policy({ permission: "memory.read" })],
        registry,
        subject: MEMBER,
        resource: ref,
        permission: "memory.read",
      }),
    ).toEqual({ allowed: false, reason: "permission-resource-mismatch" });
    // ...and agent.read must not be assertable against a memory resource.
    expect(
      evaluateAgentAssetAccess({
        policies: [memoryPolicy({ permission: "agent.read" })],
        registry,
        subject: MEMBER,
        resource: MEMORY,
        permission: "agent.read",
      }),
    ).toEqual({ allowed: false, reason: "permission-resource-mismatch" });
  });

  it("does not let a policy for one resource type match another", () => {
    const { registry } = setup();
    expect(
      evaluateAgentAssetAccess({
        policies: [memoryPolicy({ resourceType: "space", permission: "space.read" })],
        registry,
        subject: MEMBER,
        resource: MEMORY,
        permission: "memory.read",
      }),
    ).toEqual({ allowed: false, reason: "no-matching-policy" });
  });

  it("still hard denies across enterprises", () => {
    const { registry } = setup();
    expect(
      evaluateAgentAssetAccess({
        policies: [memoryPolicy({})],
        registry,
        subject: MEMBER,
        resource: { ...MEMORY, enterpriseId: "ent-b" },
        permission: "memory.read",
      }),
    ).toEqual({ allowed: false, reason: "no-matching-policy" });
  });

  it("fails closed for agent-only conditions on a non-canonical resource", () => {
    const { registry } = setup();
    expect(
      evaluateAgentAssetAccess({
        policies: [memoryPolicy({ conditions: [{ kind: "requireOwnerBinding" }] })],
        registry,
        subject: MEMBER,
        resource: MEMORY,
        permission: "memory.read",
      }),
    ).toEqual({ allowed: false, reason: "condition-unsatisfied" });
  });

  it("honours a wildcard resource id inside the type", () => {
    const { registry } = setup();
    expect(
      evaluateAgentAssetAccess({
        policies: [memoryPolicy({ resourceId: ANY_RESOURCE })],
        registry,
        subject: MEMBER,
        resource: { ...MEMORY, resourceId: "mem-99" },
        permission: "memory.read",
      }),
    ).toEqual({ allowed: true, matchedPolicyId: "policy-1" });
  });

  it("keeps the inactive-subject gate", () => {
    const { registry } = setup();
    expect(
      evaluateAgentAssetAccess({
        policies: [memoryPolicy({})],
        registry,
        subject: { ...MEMBER, status: "revoked" },
        resource: MEMORY,
        permission: "memory.read",
      }),
    ).toEqual({ allowed: false, reason: "subject-inactive" });
  });
});

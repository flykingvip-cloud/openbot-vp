// Feature: shared-agent-identity-access-control-plane

import * as fc from "fast-check";
import { describe, it } from "vitest";
import { setPrimaryOwner } from "../agent-registry/ownership.js";
import { createAgentAsset } from "../agent-registry/registry.js";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import { evaluateAgentAssetAccess } from "./policy-v2-evaluator.js";
import {
  ACCESS_PERMISSIONS,
  type AccessPermission,
  type AccessSubject,
  type EnterpriseAccessPolicyV2,
  resourceTypeForPermission,
} from "./policy-v2-types.js";

/**
 * Property tests for the fail-closed invariants.
 *
 * Added because a real bypass on the delegated-membership path shipped while every
 * example-based test was green: the examples covered the shapes someone thought of, not the
 * combinations. These assert the invariants over generated policy sets instead.
 */

const NOW = "2026-08-01T00:00:00.000Z";
const ENTERPRISES = ["ent-a", "ent-b"] as const;

function registryWithAsset(): { registry: AgentRegistryStore; agentAssetId: string } {
  const registry = createEmptyAgentRegistryStore();
  const asset = createAgentAsset({
    store: registry,
    enterpriseId: "ent-a",
    agentSlug: "sales-bot",
    displayName: "Sales Bot",
    nowIso: NOW,
  });
  setPrimaryOwner({
    store: registry,
    ref: { enterpriseId: "ent-a", agentAssetId: asset.agentAssetId },
    ownerType: "seat",
    ownerId: "seat-1",
    nowIso: NOW,
  });
  return { registry, agentAssetId: asset.agentAssetId };
}

const permissionArb = fc.constantFrom(...ACCESS_PERMISSIONS);
const subjectTypeArb = fc.constantFrom("membership" as const, "seat" as const);
const effectArb = fc.constantFrom("allow" as const, "deny" as const);

/**
 * Conditions are part of the generated space on purpose.
 *
 * A first version of these properties omitted them, and the delegated-membership bypass
 * still passed: the bug needs an unrecognized condition on a membership policy, which a
 * condition-free generator can never produce.
 */
const conditionsArb = fc.constantFrom<EnterpriseAccessPolicyV2["conditions"] | undefined>(
  undefined,
  [{ kind: "requireOwnerBinding" }],
  [{ kind: "requireAssetStatus", status: "active" }],
  [{ kind: "requireTimeWindow" } as never],
);

/** A policy that always targets the asset under test, so matching is not accidental. */
function policyArb(agentAssetId: string) {
  return fc
    .record({
      policyId: fc.string({ minLength: 1, maxLength: 8 }),
      enterpriseId: fc.constantFrom(...ENTERPRISES),
      subjectType: subjectTypeArb,
      subjectId: fc.constantFrom("membership-1", "seat-1", "other-1"),
      permission: permissionArb,
      effect: effectArb,
      revoked: fc.boolean(),
      conditions: conditionsArb,
    })
    .map(
      (raw): EnterpriseAccessPolicyV2 => ({
        policyId: raw.policyId,
        version: 2,
        enterpriseId: raw.enterpriseId,
        subjectType: raw.subjectType,
        subjectId: raw.subjectId,
        resourceType: resourceTypeForPermission(raw.permission),
        resourceId:
          resourceTypeForPermission(raw.permission) === "agent_asset" ? agentAssetId : "r",
        permission: raw.permission,
        effect: raw.effect,
        ...(raw.conditions ? { conditions: raw.conditions } : {}),
        createdAt: NOW,
        ...(raw.revoked ? { revokedAt: NOW } : {}),
      }),
    );
}

/** True when a live matching policy carries a condition the evaluator cannot enforce. */
function hasUnenforceableCondition(
  policies: EnterpriseAccessPolicyV2[],
  subject: AccessSubject,
  permission: AccessPermission,
): boolean {
  return policies.some(
    (entry) =>
      !entry.revokedAt &&
      entry.enterpriseId === "ent-a" &&
      entry.permission === permission &&
      entry.subjectType === subject.subjectType &&
      entry.subjectId === subject.subjectId &&
      (entry.conditions ?? []).some(
        (condition) =>
          condition.kind !== "requireOwnerBinding" &&
          condition.kind !== "requireSeatBinding" &&
          condition.kind !== "requireAssetStatus",
      ),
  );
}

function evaluate(params: {
  registry: AgentRegistryStore;
  agentAssetId: string;
  policies: EnterpriseAccessPolicyV2[];
  subject: AccessSubject;
  permission: AccessPermission;
  resolveMembershipSubject?: (id: string) => AccessSubject | null;
}) {
  const resourceType = resourceTypeForPermission(params.permission);
  return evaluateAgentAssetAccess({
    policies: params.policies,
    registry: params.registry,
    subject: params.subject,
    resource: {
      enterpriseId: "ent-a",
      resourceType,
      resourceId: resourceType === "agent_asset" ? params.agentAssetId : "r",
    },
    permission: params.permission,
    ...(params.resolveMembershipSubject
      ? { resolveMembershipSubject: params.resolveMembershipSubject }
      : {}),
  });
}

describe("evaluator fail-closed properties", () => {
  it("never allows without an active, matching, non-revoked allow policy", () => {
    const { registry, agentAssetId } = registryWithAsset();
    fc.assert(
      fc.property(
        fc.array(policyArb(agentAssetId), { maxLength: 6 }),
        permissionArb,
        subjectTypeArb,
        (policies, permission, subjectType) => {
          const subject: AccessSubject = {
            subjectType,
            subjectId: subjectType === "seat" ? "seat-1" : "membership-1",
            status: "active",
          };
          const decision = evaluate({ registry, agentAssetId, policies, subject, permission });
          if (!decision.allowed) {
            return true;
          }
          const matched = policies.find((entry) => entry.policyId === decision.matchedPolicyId);
          // An allow must be traceable to a live policy for this exact subject and enterprise.
          return Boolean(
            matched &&
            matched.effect === "allow" &&
            !matched.revokedAt &&
            matched.enterpriseId === "ent-a" &&
            matched.permission === permission &&
            matched.subjectType === subject.subjectType &&
            matched.subjectId === subject.subjectId,
          );
        },
      ),
      { numRuns: 400 },
    );
  });

  it("never allows when any matching deny is present", () => {
    const { registry, agentAssetId } = registryWithAsset();
    fc.assert(
      fc.property(
        fc.array(policyArb(agentAssetId), { maxLength: 6 }),
        permissionArb,
        (policies, permission) => {
          const subject: AccessSubject = {
            subjectType: "membership",
            subjectId: "membership-1",
            status: "active",
          };
          const hasLiveDeny = policies.some(
            (entry) =>
              entry.effect === "deny" &&
              !entry.revokedAt &&
              entry.enterpriseId === "ent-a" &&
              entry.permission === permission &&
              entry.subjectType === "membership" &&
              entry.subjectId === "membership-1" &&
              !entry.conditions?.length,
          );
          const decision = evaluate({ registry, agentAssetId, policies, subject, permission });
          return hasLiveDeny ? !decision.allowed : true;
        },
      ),
      { numRuns: 400 },
    );
  });

  it("never allows an inactive subject, whatever the policy set says", () => {
    const { registry, agentAssetId } = registryWithAsset();
    fc.assert(
      fc.property(
        fc.array(policyArb(agentAssetId), { maxLength: 6 }),
        permissionArb,
        fc.constantFrom("suspended" as const, "revoked" as const),
        (policies, permission, status) =>
          !evaluate({
            registry,
            agentAssetId,
            policies,
            subject: { subjectType: "membership", subjectId: "membership-1", status },
            permission,
          }).allowed,
      ),
      { numRuns: 300 },
    );
  });

  it("never allows across an enterprise boundary", () => {
    const { registry, agentAssetId } = registryWithAsset();
    fc.assert(
      fc.property(
        fc.array(policyArb(agentAssetId), { maxLength: 6 }),
        permissionArb,
        (policies, permission) => {
          const resourceType = resourceTypeForPermission(permission);
          const decision = evaluateAgentAssetAccess({
            // Every policy is rewritten to the other enterprise, so none may apply.
            policies: policies.map((entry) => ({ ...entry, enterpriseId: "ent-b" })),
            registry,
            subject: { subjectType: "membership", subjectId: "membership-1", status: "active" },
            resource: {
              enterpriseId: "ent-a",
              resourceType,
              resourceId: resourceType === "agent_asset" ? agentAssetId : "r",
            },
            permission,
          });
          return !decision.allowed;
        },
      ),
      { numRuns: 300 },
    );
  });

  it("never lets an unknown condition anywhere in the matched set produce an allow", () => {
    const { registry, agentAssetId } = registryWithAsset();
    fc.assert(
      fc.property(
        fc.array(policyArb(agentAssetId), { maxLength: 5 }),
        permissionArb,
        effectArb,
        (policies, permission, effect) => {
          const resourceType = resourceTypeForPermission(permission);
          const broken: EnterpriseAccessPolicyV2 = {
            policyId: "broken",
            version: 2,
            enterpriseId: "ent-a",
            subjectType: "membership",
            subjectId: "membership-1",
            resourceType,
            resourceId: resourceType === "agent_asset" ? agentAssetId : "r",
            permission,
            effect,
            conditions: [{ kind: "requireTimeWindow" } as never],
            createdAt: NOW,
          };
          const decision = evaluate({
            registry,
            agentAssetId,
            policies: [...policies, broken],
            subject: { subjectType: "membership", subjectId: "membership-1", status: "active" },
            permission,
          });
          return !decision.allowed;
        },
      ),
      { numRuns: 400 },
    );
  });

  it("never grants a service principal more than its delegated membership", () => {
    // The delegated space is enumerated rather than sampled. A first version drew random
    // policy arrays and still passed with the bypass present, because reaching it needs a
    // satisfied membership allow AND a membership policy with an unrecognized condition on
    // the SAME permission, which random draws almost never line up.
    const { registry, agentAssetId } = registryWithAsset();
    const conditionKindArb = fc.constantFrom<"none" | "satisfied" | "unknown">(
      "none",
      "satisfied",
      "unknown",
    );
    fc.assert(
      fc.property(
        fc.constantFrom<AccessPermission>("agent.read", "agent.execute", "memory.read"),
        fc.boolean(),
        conditionKindArb,
        fc.boolean(),
        conditionKindArb,
        (permission, memberAllow, allowCondition, memberDeny, denyCondition) => {
          const resourceType = resourceTypeForPermission(permission);
          const resourceId = resourceType === "agent_asset" ? agentAssetId : "r";
          const conditionsFor = (
            kind: "none" | "satisfied" | "unknown",
          ): EnterpriseAccessPolicyV2["conditions"] | undefined =>
            kind === "none"
              ? undefined
              : kind === "satisfied"
                ? [{ kind: "requireAssetStatus", status: "active" }]
                : [{ kind: "requireTimeWindow" } as never];
          const base = {
            version: 2 as const,
            enterpriseId: "ent-a",
            resourceType,
            resourceId,
            permission,
            createdAt: NOW,
          };
          const policies: EnterpriseAccessPolicyV2[] = [
            {
              ...base,
              policyId: "sp-allow",
              subjectType: "service_principal",
              subjectId: "sp-1",
              effect: "allow",
            },
          ];
          if (memberAllow) {
            policies.push({
              ...base,
              policyId: "member-allow",
              subjectType: "membership",
              subjectId: "membership-1",
              effect: "allow",
              ...(conditionsFor(allowCondition)
                ? { conditions: conditionsFor(allowCondition) }
                : {}),
            });
          }
          if (memberDeny) {
            policies.push({
              ...base,
              policyId: "member-deny",
              subjectType: "membership",
              subjectId: "membership-1",
              effect: "deny",
              ...(conditionsFor(denyCondition) ? { conditions: conditionsFor(denyCondition) } : {}),
            });
          }

          const member: AccessSubject = {
            subjectType: "membership",
            subjectId: "membership-1",
            status: "active",
          };
          const principal = evaluate({
            registry,
            agentAssetId,
            policies,
            subject: {
              subjectType: "service_principal",
              subjectId: "sp-1",
              status: "active",
              onBehalfOfMembershipId: "membership-1",
            },
            permission,
            resolveMembershipSubject: () => member,
          });
          if (!principal.allowed) {
            return true;
          }
          // An unenforceable condition on the delegated side must fail the whole decision,
          // not be skipped while the principal's own allow carries it.
          if (hasUnenforceableCondition(policies, member, permission)) {
            return false;
          }
          // Delegation is an intersection, so the membership must be allowed on its own.
          return evaluate({ registry, agentAssetId, policies, subject: member, permission })
            .allowed;
        },
      ),
      { numRuns: 500 },
    );
  });
});

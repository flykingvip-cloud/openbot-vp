// Feature: shared-agent-identity-access-control-plane

import { findPrimaryOwnerBinding } from "../agent-registry/ownership.js";
import { findAgentAsset } from "../agent-registry/registry.js";
import type { AgentRef, AgentRegistryStore } from "../agent-registry/types.js";
import {
  type AccessCondition,
  type AccessDecision,
  type AccessPermission,
  type AccessResourceRef,
  type AccessSubject,
  ANY_RESOURCE,
  type EnterpriseAccessPolicyV2,
  isAccessPermission,
  permissionMatchesResourceType,
} from "./policy-v2-types.js";

/**
 * Normalizes either accepted resource shape. An `AgentRef` (no `resourceType`) means the
 * canonical agent asset, which keeps every existing agent call site working unchanged.
 */
export function toResourceRef(resource: AgentRef | AccessResourceRef): AccessResourceRef {
  return "resourceType" in resource
    ? resource
    : {
        enterpriseId: resource.enterpriseId,
        resourceType: "agent_asset",
        resourceId: resource.agentAssetId,
      };
}

export type EvaluateAccessParams = {
  policies: EnterpriseAccessPolicyV2[];
  registry: AgentRegistryStore;
  subject: AccessSubject;
  /**
   * An `AgentRef` keeps the agent-asset call sites unchanged; a full
   * `AccessResourceRef` is used for the non-canonical resource types.
   */
  resource: AgentRef | AccessResourceRef;
  /** Accepts any string so an unknown permission is rejected, not a type error. */
  permission: string;
  /**
   * Resolves the membership a service principal acts for. Returning null means the
   * membership is unknown or inactive, which fails closed.
   */
  resolveMembershipSubject?: (membershipId: string) => AccessSubject | null;
};

function isActivePolicy(policy: EnterpriseAccessPolicyV2): boolean {
  return !policy.revokedAt;
}

function matchesResource(policy: EnterpriseAccessPolicyV2, resource: AccessResourceRef): boolean {
  return (
    policy.resourceType === resource.resourceType &&
    (policy.resourceId === ANY_RESOURCE || policy.resourceId === resource.resourceId)
  );
}

function matchesSubject(policy: EnterpriseAccessPolicyV2, subject: AccessSubject): boolean {
  return policy.subjectType === subject.subjectType && policy.subjectId === subject.subjectId;
}

/**
 * Conditions are closed-world: an unrecognized `kind` is reported so the caller
 * denies rather than treating an unenforceable condition as satisfied.
 */
function evaluateCondition(params: {
  condition: AccessCondition;
  registry: AgentRegistryStore;
  subject: AccessSubject;
  resource: AccessResourceRef;
}): "satisfied" | "unsatisfied" | "unknown" {
  const { condition } = params;
  // Ownership and lifecycle are modelled for AgentAsset only, so these conditions
  // cannot be satisfied for a non-canonical resource type rather than silently pass.
  const agentRef: AgentRef | null =
    params.resource.resourceType === "agent_asset"
      ? {
          enterpriseId: params.resource.enterpriseId,
          agentAssetId: params.resource.resourceId,
        }
      : null;
  switch (condition.kind) {
    case "requireOwnerBinding": {
      if (!agentRef) {
        return "unsatisfied";
      }
      const binding = findPrimaryOwnerBinding(params.registry, agentRef);
      if (!binding) {
        return "unsatisfied";
      }
      // A service principal never inherits owner baseline by acting on behalf of.
      return binding.ownerType === params.subject.subjectType &&
        binding.ownerId === params.subject.subjectId
        ? "satisfied"
        : "unsatisfied";
    }
    case "requireSeatBinding": {
      if (!agentRef) {
        return "unsatisfied";
      }
      const binding = findPrimaryOwnerBinding(params.registry, agentRef);
      return binding && binding.ownerType === "seat" && binding.ownerId === condition.seatId
        ? "satisfied"
        : "unsatisfied";
    }
    case "requireAssetStatus": {
      if (!agentRef) {
        return "unsatisfied";
      }
      const asset = findAgentAsset(params.registry, agentRef);
      return asset && asset.status === condition.status ? "satisfied" : "unsatisfied";
    }
    default:
      return "unknown";
  }
}

type PolicyScan = {
  denied: EnterpriseAccessPolicyV2 | null;
  allowed: EnterpriseAccessPolicyV2 | null;
  unknownCondition: boolean;
  conditionUnsatisfied: boolean;
};

function scanPolicies(params: {
  policies: EnterpriseAccessPolicyV2[];
  registry: AgentRegistryStore;
  subject: AccessSubject;
  resource: AccessResourceRef;
  permission: AccessPermission;
}): PolicyScan {
  const scan: PolicyScan = {
    denied: null,
    allowed: null,
    unknownCondition: false,
    conditionUnsatisfied: false,
  };
  for (const policy of params.policies) {
    if (
      policy.version !== 2 ||
      !isActivePolicy(policy) ||
      policy.enterpriseId !== params.resource.enterpriseId ||
      policy.permission !== params.permission ||
      !matchesSubject(policy, params.subject) ||
      !matchesResource(policy, params.resource)
    ) {
      continue;
    }

    let satisfied = true;
    for (const condition of policy.conditions ?? []) {
      const result = evaluateCondition({
        condition,
        registry: params.registry,
        subject: params.subject,
        resource: params.resource,
      });
      if (result === "unknown") {
        // An unenforceable condition must never widen access, on either effect.
        scan.unknownCondition = true;
        satisfied = false;
        break;
      }
      if (result === "unsatisfied") {
        satisfied = false;
        break;
      }
    }

    if (policy.effect === "deny") {
      // A deny whose conditions do not hold simply does not apply.
      if (satisfied) {
        scan.denied = policy;
        return scan;
      }
      continue;
    }
    if (!satisfied) {
      scan.conditionUnsatisfied = true;
      continue;
    }
    scan.allowed ??= policy;
  }
  return scan;
}

/**
 * Evaluates one permission against the authoritative policy set.
 *
 * Order matters: enterprise mismatch and subject/asset lifecycle are checked
 * before any policy is consulted, an explicit deny always wins, and the default
 * outcome is deny.
 */
export function evaluateAgentAssetAccess(params: EvaluateAccessParams): AccessDecision {
  if (!isAccessPermission(params.permission)) {
    return { allowed: false, reason: "unknown-permission" };
  }
  const permission = params.permission;
  const resource = toResourceRef(params.resource);

  // A permission belongs to exactly one resource type, so `memory.read` can never be
  // matched against an agent asset (or the reverse) even if a policy claims it.
  if (!permissionMatchesResourceType(permission, resource.resourceType)) {
    return { allowed: false, reason: "permission-resource-mismatch" };
  }

  if (params.subject.status !== "active") {
    return { allowed: false, reason: "subject-inactive" };
  }

  // Only the canonical agent asset has a registry entry whose existence and lifecycle
  // can be checked here; the other types are governed by their own stores.
  if (resource.resourceType === "agent_asset") {
    const asset = findAgentAsset(params.registry, {
      enterpriseId: resource.enterpriseId,
      agentAssetId: resource.resourceId,
    });
    if (!asset) {
      // Also covers a matching id owned by another enterprise.
      return { allowed: false, reason: "asset-missing" };
    }
    if (asset.status !== "active") {
      return { allowed: false, reason: "asset-inactive" };
    }
  }

  const scan = scanPolicies({
    policies: params.policies,
    registry: params.registry,
    subject: params.subject,
    resource,
    permission,
  });
  if (scan.denied) {
    return { allowed: false, reason: "explicit-deny", matchedPolicyId: scan.denied.policyId };
  }
  // An unenforceable condition anywhere in the matched set fails the whole
  // decision closed. Skipping only that policy would let an unevaluatable deny be
  // bypassed by an unrelated allow.
  if (scan.unknownCondition) {
    return { allowed: false, reason: "unknown-condition" };
  }
  if (!scan.allowed) {
    return {
      allowed: false,
      reason: scan.conditionUnsatisfied ? "condition-unsatisfied" : "no-matching-policy",
    };
  }

  if (params.subject.subjectType !== "service_principal") {
    return { allowed: true, matchedPolicyId: scan.allowed.policyId };
  }

  // Service principal: effective permissions are the INTERSECTION with the
  // membership it acts for, so delegation can never widen access.
  const membershipId = params.subject.onBehalfOfMembershipId?.trim();
  if (!membershipId || !params.resolveMembershipSubject) {
    return { allowed: false, reason: "principal-membership-missing" };
  }
  const membershipSubject = params.resolveMembershipSubject(membershipId);
  if (!membershipSubject || membershipSubject.status !== "active") {
    return { allowed: false, reason: "principal-membership-missing" };
  }
  const membershipScan = scanPolicies({
    policies: params.policies,
    registry: params.registry,
    subject: membershipSubject,
    resource,
    permission,
  });
  if (membershipScan.denied) {
    return {
      allowed: false,
      reason: "explicit-deny",
      matchedPolicyId: membershipScan.denied.policyId,
    };
  }
  // The delegated side needs the same fail-closed treatment as the principal side.
  // Checking only deny and allow here let an unenforceable deny on the membership be
  // skipped while the principal's allow carried the decision, which widened delegation.
  if (membershipScan.unknownCondition) {
    return { allowed: false, reason: "unknown-condition" };
  }
  if (!membershipScan.allowed) {
    return { allowed: false, reason: "principal-intersection-empty" };
  }
  return { allowed: true, matchedPolicyId: scan.allowed.policyId };
}

/**
 * Materializes the owner baseline as explicit, auditable policies. The evaluator
 * has no implicit owner shortcut, so ownership only grants what is listed here.
 */
export const OWNER_BASELINE_PERMISSIONS: readonly AccessPermission[] = [
  "agent.read",
  "agent.execute",
  "agent.manage",
  "growth.read",
];

export function buildOwnerBaselinePolicies(params: {
  registry: AgentRegistryStore;
  resource: AgentRef;
  nowIso: string;
  makePolicyId: (permission: AccessPermission) => string;
}): EnterpriseAccessPolicyV2[] {
  const binding = findPrimaryOwnerBinding(params.registry, params.resource);
  if (!binding) {
    return [];
  }
  return OWNER_BASELINE_PERMISSIONS.map((permission) => ({
    policyId: params.makePolicyId(permission),
    version: 2 as const,
    enterpriseId: params.resource.enterpriseId,
    subjectType: binding.ownerType,
    subjectId: binding.ownerId,
    resourceType: "agent_asset" as const,
    resourceId: params.resource.agentAssetId,
    permission,
    effect: "allow" as const,
    conditions: [{ kind: "requireOwnerBinding" }, { kind: "requireAssetStatus", status: "active" }],
    derivedFrom: "owner-baseline" as const,
    createdAt: params.nowIso,
  }));
}

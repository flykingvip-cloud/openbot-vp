// Feature: shared-agent-identity-access-control-plane
// Decided by docs/design/agent-registry-unified-acl-adr-2026-07-31.md.

/** Subjects recognized by V2. `employee` (user scoped) is deliberately absent. */
export type AccessSubjectType = "membership" | "seat" | "service_principal";

/**
 * Resource types recognized by V2 (ADR amendment 1).
 *
 * Only `agent_asset` has a canonical registry identity; the others are still keyed by
 * their v1 resource id, always scoped by `enterpriseId`.
 */
export type AccessResourceType = "agent_asset" | "seat" | "space" | "memory" | "capability";

/** Resource types that carry no canonical registry entry and no ownership model. */
export const NON_CANONICAL_RESOURCE_TYPES: ReadonlySet<AccessResourceType> = new Set([
  "seat",
  "space",
  "memory",
  "capability",
]);

/**
 * Frozen permission set; no permission may be invented at runtime. The non-agent
 * entries mirror exactly the (resource, action) pairs v1 expresses, so migration never
 * widens a grant.
 */
export const ACCESS_PERMISSIONS = [
  "agent.read",
  "agent.execute",
  "agent.manage",
  "agent.ownership.transfer",
  "growth.read",
  "growth.observation.write",
  "growth.correct",
  "growth.repair",
  "growth.aggregate",
  "growth.export",
  "seat.read",
  "space.read",
  "memory.read",
  "memory.write",
  "capability.execute",
] as const;

export type AccessPermission = (typeof ACCESS_PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(ACCESS_PERMISSIONS);

export function isAccessPermission(value: unknown): value is AccessPermission {
  return typeof value === "string" && PERMISSION_SET.has(value);
}

/**
 * Typed conditions only. An unknown key or a wrong value type fails closed, so no
 * expression DSL is needed and no condition can be silently ignored.
 */
export type AccessCondition =
  | { kind: "requireOwnerBinding" }
  | { kind: "requireSeatBinding"; seatId: string }
  | { kind: "requireAssetStatus"; status: "active" };

export type AccessPolicyEffect = "allow" | "deny";

/**
 * Ownership baseline permissions are materialized as policies with
 * `derivedFrom: "owner-baseline"` so an owner still passes through the evaluator
 * and remains auditable.
 */
export type EnterpriseAccessPolicyV2 = {
  policyId: string;
  version: 2;
  enterpriseId: string;
  subjectType: AccessSubjectType;
  subjectId: string;
  resourceType: AccessResourceType;
  /**
   * Canonical `agentAssetId` for `agent_asset`, otherwise the v1 resource id, or `*`
   * for every resource of that type inside the enterprise.
   */
  resourceId: string;
  permission: AccessPermission;
  effect: AccessPolicyEffect;
  conditions?: AccessCondition[];
  derivedFrom?: "owner-baseline" | "v1-migration";
  createdAt: string;
  revokedAt?: string;
};

export const ANY_RESOURCE = "*" as const;

export type AccessSubject = {
  subjectType: AccessSubjectType;
  subjectId: string;
  /** Lifecycle of the subject itself; anything but active fails closed. */
  status: "active" | "suspended" | "revoked";
  /**
   * Only meaningful for `service_principal`. When present the effective
   * permissions are the intersection with that membership's permissions.
   */
  onBehalfOfMembershipId?: string;
};

export type AccessDecision =
  | { allowed: true; matchedPolicyId: string }
  | { allowed: false; reason: AccessDenyReason; matchedPolicyId?: string };

export type AccessDenyReason =
  | "enterprise-mismatch"
  | "unknown-permission"
  | "permission-resource-mismatch"
  | "subject-inactive"
  | "asset-missing"
  | "asset-inactive"
  | "explicit-deny"
  | "no-matching-policy"
  | "condition-unsatisfied"
  | "unknown-condition"
  | "principal-membership-missing"
  | "principal-intersection-empty";

/**
 * Which resource type each permission may be asserted against.
 *
 * Without this, a policy could grant `memory.read` on an `agent_asset` (or vice versa)
 * and the evaluator would happily match it. `growth.*` belongs to the agent asset,
 * because Growth is keyed by `(enterpriseId, agentAssetId)`.
 */
const PERMISSION_RESOURCE_TYPE: Record<AccessPermission, AccessResourceType> = {
  "agent.read": "agent_asset",
  "agent.execute": "agent_asset",
  "agent.manage": "agent_asset",
  "agent.ownership.transfer": "agent_asset",
  "growth.read": "agent_asset",
  "growth.observation.write": "agent_asset",
  "growth.correct": "agent_asset",
  "growth.repair": "agent_asset",
  "growth.aggregate": "agent_asset",
  "growth.export": "agent_asset",
  "seat.read": "seat",
  "space.read": "space",
  "memory.read": "memory",
  "memory.write": "memory",
  "capability.execute": "capability",
};

export function resourceTypeForPermission(permission: AccessPermission): AccessResourceType {
  return PERMISSION_RESOURCE_TYPE[permission];
}

export function permissionMatchesResourceType(
  permission: AccessPermission,
  resourceType: AccessResourceType,
): boolean {
  return PERMISSION_RESOURCE_TYPE[permission] === resourceType;
}

/** A resource being authorized. `agent_asset` ids are canonical; others are v1 ids. */
export type AccessResourceRef = {
  enterpriseId: string;
  resourceType: AccessResourceType;
  resourceId: string;
};

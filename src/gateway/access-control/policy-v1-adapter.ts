// Feature: shared-agent-identity-access-control-plane

import { resolveLegacyAgentId } from "../agent-registry/legacy-resolver.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import type {
  AccessPermission,
  AccessResourceType,
  AccessSubjectType,
  EnterpriseAccessPolicyV2,
} from "./policy-v2-types.js";

/** The v1 shape this adapter consumes (see enterprise-seat-assets-store.ts). */
export type LegacyAccessPolicyV1 = {
  policyId: string;
  tenantId: string;
  subjectType: "employee" | "seat";
  subjectId: string;
  resourceType: string;
  resourceId: string;
  action: "read" | "write" | "execute" | "manage";
  effect: "allow";
  createdAt: string;
  revokedAt?: string;
};

/**
 * Why a v1 row could not be migrated. Every reason is reported rather than
 * dropped, so a migration never silently loses or widens an authorization.
 */
export type MigrationSkipReason =
  | "revoked"
  | "unsupported-resource"
  | "unmappable-action"
  | "legacy-agent-unresolved"
  | "legacy-agent-ambiguous"
  | "membership-unresolved"
  /**
   * A universal builtin agent, which is not an enterprise asset (ADR amendment 2).
   * Unlike the other reasons this loses nothing: the runtime grants that agent to every
   * employee regardless of policy, so there is no access to carry over.
   */
  | "builtin-not-an-asset";

export type MigrationSkip = {
  policyId: string;
  reason: MigrationSkipReason;
  detail?: string;
};

export type MigrationResult = {
  migrated: EnterpriseAccessPolicyV2[];
  skipped: MigrationSkip[];
};

/**
 * Per-resource action mapping (ADR amendment 1).
 *
 * Only pairs that v1 can actually express are listed, so migration never widens a
 * grant. Notably `agent.write` stays absent: folding it into `agent.manage` would add
 * configuration and ownership-adjacent rights. `memory.write`, by contrast, is a
 * first-class v1 concept with no broader permission to fold into.
 */
const RESOURCE_ACTION_TO_PERMISSION: Record<
  string,
  Partial<Record<LegacyAccessPolicyV1["action"], AccessPermission>>
> = {
  agent: { read: "agent.read", execute: "agent.execute", manage: "agent.manage" },
  seat: { read: "seat.read" },
  space: { read: "space.read" },
  memory: { read: "memory.read", write: "memory.write" },
  capability: { execute: "capability.execute" },
};

/** v1 resource types that V2 represents; anything else stays in the v1 domain. */
const SUPPORTED_RESOURCE_TYPES = new Set(Object.keys(RESOURCE_ACTION_TO_PERMISSION));

/** Maps a v1 resource type onto its V2 counterpart. */
const RESOURCE_TYPE_TO_V2: Record<string, AccessResourceType> = {
  agent: "agent_asset",
  seat: "seat",
  space: "space",
  memory: "memory",
  capability: "capability",
};

export type MigratePoliciesParams = {
  policies: LegacyAccessPolicyV1[];
  registry: AgentRegistryStore;
  enterpriseId: string;
  nowIso: string;
  /**
   * Resolves a v1 `employee` subject (a user id) to an exact membership inside the
   * tenant. Returning null means unknown or ambiguous, which is skipped.
   */
  resolveMembershipIdForUser: (userId: string) => string | null;
  makePolicyId: (legacyPolicyId: string, permission: AccessPermission) => string;
};

/**
 * Translates v1 rows into V2 policies for one enterprise.
 *
 * The adapter is strictly narrowing: it only ever emits `allow`, never invents a
 * permission v1 could not express, and never guesses a membership or an asset.
 */
export function migrateAccessPoliciesToV2(params: MigratePoliciesParams): MigrationResult {
  const migrated: EnterpriseAccessPolicyV2[] = [];
  const skipped: MigrationSkip[] = [];

  for (const legacy of params.policies) {
    if (legacy.tenantId !== params.enterpriseId) {
      continue;
    }
    if (legacy.revokedAt) {
      skipped.push({ policyId: legacy.policyId, reason: "revoked" });
      continue;
    }
    if (!SUPPORTED_RESOURCE_TYPES.has(legacy.resourceType)) {
      // Resource types V2 does not represent stay in the v1 domain.
      skipped.push({
        policyId: legacy.policyId,
        reason: "unsupported-resource",
        detail: legacy.resourceType,
      });
      continue;
    }
    const permission = RESOURCE_ACTION_TO_PERMISSION[legacy.resourceType]?.[legacy.action];
    if (!permission) {
      skipped.push({
        policyId: legacy.policyId,
        reason: "unmappable-action",
        detail: `${legacy.resourceType}.${legacy.action}`,
      });
      continue;
    }

    // Only the agent resource has a canonical identity to resolve; the other types keep
    // their v1 id, scoped by enterprise (ADR amendment 1).
    let resourceId = legacy.resourceId;
    if (legacy.resourceType === "agent") {
      const resolution = resolveLegacyAgentId({
        store: params.registry,
        enterpriseId: params.enterpriseId,
        legacyAgentId: legacy.resourceId,
      });
      if (resolution.kind === "ambiguous") {
        skipped.push({
          policyId: legacy.policyId,
          reason: "legacy-agent-ambiguous",
          detail: legacy.resourceId,
        });
        continue;
      }
      if (resolution.kind === "builtin-universal") {
        skipped.push({
          policyId: legacy.policyId,
          reason: "builtin-not-an-asset",
          detail: legacy.resourceId,
        });
        continue;
      }
      if (resolution.kind === "not-found") {
        skipped.push({
          policyId: legacy.policyId,
          reason: "legacy-agent-unresolved",
          detail: legacy.resourceId,
        });
        continue;
      }
      resourceId = resolution.ref.agentAssetId;
    }

    let subjectType: AccessSubjectType;
    let subjectId: string;
    if (legacy.subjectType === "seat") {
      subjectType = "seat";
      subjectId = legacy.subjectId;
    } else {
      const membershipId = params.resolveMembershipIdForUser(legacy.subjectId);
      if (!membershipId) {
        skipped.push({
          policyId: legacy.policyId,
          reason: "membership-unresolved",
          detail: legacy.subjectId,
        });
        continue;
      }
      subjectType = "membership";
      subjectId = membershipId;
    }

    const resourceType = RESOURCE_TYPE_TO_V2[legacy.resourceType];
    migrated.push({
      policyId: params.makePolicyId(legacy.policyId, permission),
      version: 2,
      enterpriseId: params.enterpriseId,
      subjectType,
      subjectId,
      resourceType,
      resourceId,
      permission,
      effect: "allow",
      // The asset-status condition only means something for the canonical agent asset.
      ...(resourceType === "agent_asset"
        ? { conditions: [{ kind: "requireAssetStatus" as const, status: "active" as const }] }
        : {}),
      derivedFrom: "v1-migration",
      createdAt: params.nowIso,
    });
  }

  return { migrated, skipped };
}

/**
 * Guard for the "one authoritative policy set per tenant" rule: a tenant may not
 * be served by v1 and V2 at the same time.
 */
export function assertSingleAuthoritativePolicySet(params: {
  enterpriseId: string;
  activeV1Count: number;
  v2Enabled: boolean;
}): void {
  if (params.v2Enabled && params.activeV1Count > 0) {
    throw new Error(
      `Enterprise "${params.enterpriseId}" still has ${params.activeV1Count} active v1 policies; ` +
        "complete the migration before enabling V2 as the authoritative set.",
    );
  }
}

// Feature: shared-agent-identity-access-control-plane

import type { AgentRegistryStore } from "../agent-registry/types.js";
import {
  type LegacyAccessPolicyV1,
  migrateAccessPoliciesToV2,
  type MigrationResult,
  type MigrationSkipReason,
} from "./policy-v1-adapter.js";

/** Minimal platform-store shape needed to bind a v1 `employee` subject. */
export type MembershipLookupStore = {
  memberships: Record<string, { id: string; userId: string; enterpriseId: string }>;
};

/**
 * Maps a v1 `employee` subject (a user id) to an exact membership **inside one
 * tenant**.
 *
 * Returns null unless exactly one membership matches: a user with two memberships in
 * the same enterprise, or none at all, is ambiguous and must be adjudicated rather
 * than guessed.
 */
export function resolveTenantMembershipIdForUser(params: {
  store: MembershipLookupStore;
  enterpriseId: string;
  userId: string;
}): string | null {
  const matches = Object.values(params.store.memberships ?? {}).filter(
    (membership) =>
      membership.userId === params.userId && membership.enterpriseId === params.enterpriseId,
  );
  return matches.length === 1 ? matches[0].id : null;
}

export type TenantMigrationReport = {
  enterpriseId: string;
  migrated: number;
  skipped: Record<MigrationSkipReason, number>;
  /** Rows a human must decide on, kept verbatim for the operator report. */
  needsDecision: MigrationResult["skipped"];
  result: MigrationResult;
};

function emptySkipCounts(): TenantMigrationReport["skipped"] {
  return {
    revoked: 0,
    "unsupported-resource": 0,
    "unmappable-action": 0,
    "legacy-agent-unresolved": 0,
    "legacy-agent-ambiguous": 0,
    "membership-unresolved": 0,
    "builtin-not-an-asset": 0,
  };
}

/**
 * Reasons that block a grant from carrying over and therefore need a decision.
 *
 * `revoked`, `unsupported-resource`, and `builtin-not-an-asset` are expected outcomes,
 * not blockers: the first was already inactive, the second stays in the v1 domain for
 * this phase, and the third loses nothing because the runtime grants that agent to every
 * employee regardless of policy.
 */
const DECISION_REASONS: ReadonlySet<MigrationSkipReason> = new Set([
  "unmappable-action",
  "legacy-agent-unresolved",
  "legacy-agent-ambiguous",
  "membership-unresolved",
]);

/**
 * Runs the v1 to V2 migration for one tenant and summarizes it for an operator.
 *
 * Policy ids are derived from the source policy id, so applying the same report twice
 * updates in place instead of duplicating grants.
 */
export function migrateTenantPolicies(params: {
  enterpriseId: string;
  policies: LegacyAccessPolicyV1[];
  registry: AgentRegistryStore;
  platformStore: MembershipLookupStore;
  nowIso: string;
}): TenantMigrationReport {
  const result = migrateAccessPoliciesToV2({
    policies: params.policies,
    registry: params.registry,
    enterpriseId: params.enterpriseId,
    nowIso: params.nowIso,
    resolveMembershipIdForUser: (userId) =>
      resolveTenantMembershipIdForUser({
        store: params.platformStore,
        enterpriseId: params.enterpriseId,
        userId,
      }),
    makePolicyId: (legacyPolicyId, permission) => `v1:${legacyPolicyId}:${permission}`,
  });

  const skipped = emptySkipCounts();
  for (const entry of result.skipped) {
    skipped[entry.reason] += 1;
  }

  return {
    enterpriseId: params.enterpriseId,
    migrated: result.migrated.length,
    skipped,
    needsDecision: result.skipped.filter((entry) => DECISION_REASONS.has(entry.reason)),
    result,
  };
}

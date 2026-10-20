// Feature: shared-agent-identity-access-control-plane

import type { LegacyAccessPolicyV1 } from "./policy-v1-adapter.js";

/**
 * Source-side cleanup of v1 access policies, decided by the operator on 2026-07-31:
 *
 *  - grants pointing at an agent that no longer has enterprise ownership are revoked
 *    rather than carried into V2;
 *  - `employee` subjects stored as an email address are normalized to the platform
 *    user id, so the migration's user-id lookup can bind them.
 *
 * Both are planned as pure data first: the plan is reviewable, and applying it is a
 * separate, idempotent step.
 */

export type NormalizationPlanEntry =
  | {
      action: "revoke";
      policyId: string;
      tenantId: string;
      resourceId: string;
      reason: "agent-not-enterprise-owned";
    }
  | {
      action: "normalize-subject";
      policyId: string;
      tenantId: string;
      fromSubjectId: string;
      toSubjectId: string;
    }
  | {
      action: "skip";
      policyId: string;
      tenantId: string;
      reason: "email-unresolved" | "email-ambiguous" | "membership-not-in-tenant";
      detail: string;
    };

export type NormalizationPlan = {
  entries: NormalizationPlanEntry[];
  counts: Record<NormalizationPlanEntry["action"], number>;
};

/** Read-only view of the platform store needed to resolve an email to a user. */
export type EmailResolutionStore = {
  users: Record<string, { id: string; normalizedEmail?: string; email?: string }>;
  memberships: Record<string, { id: string; userId: string; enterpriseId: string }>;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isEmailSubject(subjectId: string): boolean {
  return subjectId.includes("@");
}

/**
 * Resolves an email subject to a user id, but only when the mapping is unambiguous
 * **and** that user actually holds exactly one membership in the policy's tenant.
 * Anything else is skipped, because rebinding a grant to the wrong subject would
 * silently move an authorization.
 */
function resolveEmailSubject(params: {
  store: EmailResolutionStore;
  email: string;
  tenantId: string;
}):
  | { userId: string }
  | { reason: "email-unresolved" | "email-ambiguous" | "membership-not-in-tenant" } {
  const email = normalizeEmail(params.email);
  const matches = Object.values(params.store.users).filter(
    (user) => normalizeEmail(user.normalizedEmail ?? user.email ?? "") === email,
  );
  if (matches.length === 0) {
    return { reason: "email-unresolved" };
  }
  if (matches.length > 1) {
    return { reason: "email-ambiguous" };
  }
  const userId = matches[0].id;
  const memberships = Object.values(params.store.memberships).filter(
    (membership) => membership.userId === userId && membership.enterpriseId === params.tenantId,
  );
  return memberships.length === 1 ? { userId } : { reason: "membership-not-in-tenant" };
}

export type PlanNormalizationParams = {
  policies: LegacyAccessPolicyV1[];
  platformStore: EmailResolutionStore;
  /** Agent resource ids whose grants the operator decided to revoke. */
  revokeAgentResourceIds: string[];
  /** Restrict the plan to one tenant when set. */
  tenantId?: string | null;
};

/**
 * Builds the cleanup plan. Already revoked rows are ignored, so a re-plan after
 * applying yields an empty revoke set and no repeated subject rewrites.
 */
export function planV1PolicyNormalization(params: PlanNormalizationParams): NormalizationPlan {
  const revokeTargets = new Set(
    params.revokeAgentResourceIds.map((id) => id.trim()).filter(Boolean),
  );
  const entries: NormalizationPlanEntry[] = [];
  const counts: NormalizationPlan["counts"] = { revoke: 0, "normalize-subject": 0, skip: 0 };
  const record = (entry: NormalizationPlanEntry): void => {
    entries.push(entry);
    counts[entry.action] += 1;
  };

  for (const policy of params.policies) {
    if (policy.revokedAt) {
      continue;
    }
    if (params.tenantId && policy.tenantId !== params.tenantId) {
      continue;
    }

    if (policy.resourceType === "agent" && revokeTargets.has(policy.resourceId)) {
      record({
        action: "revoke",
        policyId: policy.policyId,
        tenantId: policy.tenantId,
        resourceId: policy.resourceId,
        reason: "agent-not-enterprise-owned",
      });
      continue;
    }

    if (policy.subjectType !== "employee" || !isEmailSubject(policy.subjectId)) {
      continue;
    }
    const resolved = resolveEmailSubject({
      store: params.platformStore,
      email: policy.subjectId,
      tenantId: policy.tenantId,
    });
    if ("reason" in resolved) {
      record({
        action: "skip",
        policyId: policy.policyId,
        tenantId: policy.tenantId,
        reason: resolved.reason,
        detail: policy.subjectId,
      });
      continue;
    }
    record({
      action: "normalize-subject",
      policyId: policy.policyId,
      tenantId: policy.tenantId,
      fromSubjectId: policy.subjectId,
      toSubjectId: resolved.userId,
    });
  }

  return { entries, counts };
}

/**
 * Applies a plan to the v1 policy records in place. Returns what actually changed, so
 * a second run over an applied plan reports zero mutations.
 */
export function applyV1PolicyNormalization(params: {
  policies: Record<string, LegacyAccessPolicyV1>;
  plan: NormalizationPlan;
  nowIso: string;
}): { revoked: string[]; normalized: string[] } {
  const revoked: string[] = [];
  const normalized: string[] = [];
  for (const entry of params.plan.entries) {
    const policy = params.policies[entry.policyId];
    if (!policy) {
      continue;
    }
    if (entry.action === "revoke" && !policy.revokedAt) {
      policy.revokedAt = params.nowIso;
      revoked.push(entry.policyId);
      continue;
    }
    if (entry.action === "normalize-subject" && policy.subjectId === entry.fromSubjectId) {
      policy.subjectId = entry.toSubjectId;
      normalized.push(entry.policyId);
    }
  }
  return { revoked, normalized };
}

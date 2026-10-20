// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import type { LegacyAccessPolicyV1 } from "./policy-v1-adapter.js";
import {
  applyV1PolicyNormalization,
  type EmailResolutionStore,
  planV1PolicyNormalization,
} from "./v1-normalization.js";

const NOW = "2026-07-31T00:00:00.000Z";

function platformStore(overrides?: Partial<EmailResolutionStore>): EmailResolutionStore {
  return {
    users: {
      "user-1": { id: "user-1", normalizedEmail: "member@example.com" },
      "user-2": { id: "user-2", normalizedEmail: "other@example.com" },
    },
    memberships: {
      "mem-1": { id: "mem-1", userId: "user-1", enterpriseId: "ent-a" },
      "mem-2": { id: "mem-2", userId: "user-2", enterpriseId: "ent-b" },
    },
    ...overrides,
  };
}

function policy(overrides: Partial<LegacyAccessPolicyV1>): LegacyAccessPolicyV1 {
  return {
    policyId: "p1",
    tenantId: "ent-a",
    subjectType: "employee",
    subjectId: "member@example.com",
    resourceType: "agent",
    resourceId: "agent-1",
    action: "execute",
    effect: "allow",
    createdAt: NOW,
    ...overrides,
  };
}

function plan(policies: LegacyAccessPolicyV1[], revoke: string[] = []) {
  return planV1PolicyNormalization({
    policies,
    platformStore: platformStore(),
    revokeAgentResourceIds: revoke,
    tenantId: "ent-a",
  });
}

describe("v1 policy normalization plan", () => {
  it("normalizes an email subject to its platform user id", () => {
    expect(plan([policy({})]).entries).toEqual([
      {
        action: "normalize-subject",
        policyId: "p1",
        tenantId: "ent-a",
        fromSubjectId: "member@example.com",
        toSubjectId: "user-1",
      },
    ]);
  });

  it("matches an email case-insensitively", () => {
    expect(plan([policy({ subjectId: "  MEMBER@Example.com " })]).counts["normalize-subject"]).toBe(
      1,
    );
  });

  it("leaves user-id subjects untouched", () => {
    expect(plan([policy({ subjectId: "user-1" })]).entries).toEqual([]);
  });

  it("revokes grants for an agent the operator decided is not enterprise owned", () => {
    expect(plan([policy({ subjectId: "user-1", resourceId: "bot" })], ["bot"]).entries).toEqual([
      {
        action: "revoke",
        policyId: "p1",
        tenantId: "ent-a",
        resourceId: "bot",
        reason: "agent-not-enterprise-owned",
      },
    ]);
  });

  it("prefers revocation over rewriting the subject of a doomed grant", () => {
    const result = plan([policy({ resourceId: "bot" })], ["bot"]);
    expect(result.counts).toMatchObject({ revoke: 1, "normalize-subject": 0 });
  });

  it("skips an unknown or ambiguous email instead of rebinding it", () => {
    expect(plan([policy({ subjectId: "nobody@example.com" })]).entries).toEqual([
      {
        action: "skip",
        policyId: "p1",
        tenantId: "ent-a",
        reason: "email-unresolved",
        detail: "nobody@example.com",
      },
    ]);

    const ambiguous = planV1PolicyNormalization({
      policies: [policy({})],
      platformStore: platformStore({
        users: {
          a: { id: "a", normalizedEmail: "member@example.com" },
          b: { id: "b", normalizedEmail: "member@example.com" },
        },
      }),
      revokeAgentResourceIds: [],
      tenantId: "ent-a",
    });
    expect(ambiguous.entries[0]).toMatchObject({ action: "skip", reason: "email-ambiguous" });
  });

  it("refuses to bind a user whose membership is in another tenant", () => {
    expect(plan([policy({ subjectId: "other@example.com" })]).entries).toEqual([
      {
        action: "skip",
        policyId: "p1",
        tenantId: "ent-a",
        reason: "membership-not-in-tenant",
        detail: "other@example.com",
      },
    ]);
  });

  it("ignores already revoked rows and other tenants", () => {
    expect(
      plan([policy({ revokedAt: NOW }), policy({ policyId: "p2", tenantId: "ent-b" })]).entries,
    ).toEqual([]);
  });
});

describe("v1 policy normalization apply", () => {
  it("applies both actions and is a no-op on a second run", () => {
    const policies: Record<string, LegacyAccessPolicyV1> = {
      keep: policy({ policyId: "keep" }),
      doomed: policy({ policyId: "doomed", subjectId: "user-1", resourceId: "bot" }),
    };
    const built = plan(Object.values(policies), ["bot"]);

    const first = applyV1PolicyNormalization({ policies, plan: built, nowIso: NOW });
    expect(first).toEqual({ revoked: ["doomed"], normalized: ["keep"] });
    expect(policies.keep.subjectId).toBe("user-1");
    expect(policies.doomed.revokedAt).toBe(NOW);

    const second = applyV1PolicyNormalization({ policies, plan: built, nowIso: LATER });
    expect(second).toEqual({ revoked: [], normalized: [] });
    expect(policies.doomed.revokedAt).toBe(NOW);
  });

  it("skips a policy that vanished between plan and apply", () => {
    const built = plan([policy({})]);
    expect(applyV1PolicyNormalization({ policies: {}, plan: built, nowIso: NOW })).toEqual({
      revoked: [],
      normalized: [],
    });
  });
});

const LATER = "2026-07-31T01:00:00.000Z";

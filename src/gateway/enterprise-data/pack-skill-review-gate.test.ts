import { describe, expect, it } from "vitest";
import type { GovernanceRegistryEntry } from "../capability-governance-store.js";
import {
  createCapabilityAccessRequest,
  fulfillGovernanceApprovalRequest,
} from "./capability-access-request.js";
import { decideGovernanceApprovalRequest } from "./governance-approval-store.js";
import {
  evaluatePackSkillReviewUnlock,
  resolveReviewRequiredPackSkill,
} from "./pack-skill-review-gate.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-10-16T00:00:00.000Z";

function registryEntry(params: {
  id: string;
  skillKey: string;
  packId?: string;
  employeeVisibilityMode:
    | "enterprise_review_required"
    | "direct_employee_visible"
    | "enterprise_only";
}): GovernanceRegistryEntry {
  return {
    manifest: {
      id: params.id,
      kind: "skill",
      version: "1.0.0",
      skillKey: params.skillKey,
      name: params.skillKey,
      description: params.skillKey,
      ...(params.packId ? { packId: params.packId } : {}),
      source: { kind: "builtin", origin: "test", trustTier: "first-party" },
      risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
    },
    lifecycleState: "active",
    distribution: {
      capabilityId: params.id,
      scope: {},
      defaultEnabled: true,
      employeeVisibilityMode: params.employeeVisibilityMode,
      updatedAt: nowIso,
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

describe("resolveReviewRequiredPackSkill", () => {
  it("matches cn-office skills that require enterprise review", () => {
    expect(
      resolveReviewRequiredPackSkill(
        registryEntry({
          id: "urn:openbot:skill:feishu-integration@1.0.0",
          skillKey: "feishu-integration",
          packId: "cn-office",
          employeeVisibilityMode: "enterprise_review_required",
        }),
      ),
    ).toEqual({ packId: "cn-office", skillKey: "feishu-integration" });
  });

  it("matches by skill key when packId was not stored on the manifest", () => {
    expect(
      resolveReviewRequiredPackSkill(
        registryEntry({
          id: "legacy-feishu",
          skillKey: "feishu-integration",
          employeeVisibilityMode: "enterprise_review_required",
        }),
      ),
    ).toEqual({ packId: "cn-office", skillKey: "feishu-integration" });
  });

  it("does not gate starter skills or non-pack review defaults", () => {
    expect(
      resolveReviewRequiredPackSkill(
        registryEntry({
          id: "urn:openbot:skill:summarize@1.0.0",
          skillKey: "summarize",
          packId: "starter",
          employeeVisibilityMode: "direct_employee_visible",
        }),
      ),
    ).toBeNull();
    expect(
      resolveReviewRequiredPackSkill(
        registryEntry({
          id: "personal-1",
          skillKey: "personal-note",
          employeeVisibilityMode: "enterprise_review_required",
        }),
      ),
    ).toBeNull();
  });

  it("does not gate a cn-office skill whose distribution was opened to employees", () => {
    expect(
      resolveReviewRequiredPackSkill(
        registryEntry({
          id: "urn:openbot:skill:feishu-integration@1.0.0",
          skillKey: "feishu-integration",
          packId: "cn-office",
          employeeVisibilityMode: "direct_employee_visible",
        }),
      ),
    ).toBeNull();
  });
});

describe("evaluatePackSkillReviewUnlock", () => {
  const subject = {
    packId: "cn-office",
    skillKey: "feishu-integration",
    targetRobotId: "robot-1",
  };

  it("blocks until the same requester has an approved and fulfilled review", () => {
    const store = normalizeEnterpriseDataStore(null);
    expect(
      evaluatePackSkillReviewUnlock({
        store,
        tenantId,
        requestedBy: "emp-member-001",
        ...subject,
      }).status,
    ).toBe("missing");

    const request = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "pack_skill_review",
      ...subject,
      requestedBy: "emp-member-001",
      nowIso,
    });
    expect(
      evaluatePackSkillReviewUnlock({
        store,
        tenantId,
        requestedBy: "emp-member-001",
        ...subject,
      }).status,
    ).toBe("pending");

    decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      nowIso,
      fulfillmentMode: "approve_intent_only",
    });
    const pendingFulfill = evaluatePackSkillReviewUnlock({
      store,
      tenantId,
      requestedBy: "emp-member-001",
      ...subject,
    });
    expect(pendingFulfill.unlocked).toBe(false);
    expect(pendingFulfill.status).toBe("approved_pending_fulfillment");

    fulfillGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      fulfilledBy: "emp-admin-001",
      nowIso,
      provisionReceipt: {
        handlerRef: "pack-skill-review-unlock",
        packId: "cn-office",
        skillKey: "feishu-integration",
        targetRobotId: "robot-1",
      },
    });
    const unlocked = evaluatePackSkillReviewUnlock({
      store,
      tenantId,
      requestedBy: "emp-member-001",
      ...subject,
    });
    expect(unlocked.unlocked).toBe(true);
    expect(unlocked.status).toBe("fulfilled");
    expect(unlocked.approvalId).toBe(request.approvalId);
    expect(Object.keys(store.seatActionGrants)).toHaveLength(0);
    expect(Object.keys(store.dataCapabilities)).toHaveLength(0);
  });

  it("does not unlock another requester, tenant, or robot", () => {
    const store = normalizeEnterpriseDataStore(null);
    const request = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "pack_skill_review",
      ...subject,
      requestedBy: "emp-member-001",
      nowIso,
    });
    decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      nowIso,
    });
    fulfillGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      fulfilledBy: "emp-admin-001",
      nowIso,
      provisionReceipt: { handlerRef: "pack-skill-review-unlock", packId: "cn-office" },
    });

    expect(
      evaluatePackSkillReviewUnlock({
        store,
        tenantId,
        requestedBy: "emp-member-002",
        ...subject,
      }).unlocked,
    ).toBe(false);
    expect(
      evaluatePackSkillReviewUnlock({
        store,
        tenantId: "tenant-other",
        requestedBy: "emp-member-001",
        ...subject,
      }).unlocked,
    ).toBe(false);
    expect(
      evaluatePackSkillReviewUnlock({
        store,
        tenantId,
        requestedBy: "emp-member-001",
        packId: "cn-office",
        skillKey: "feishu-integration",
        targetRobotId: "robot-2",
      }).unlocked,
    ).toBe(false);
  });

  it("keeps approve_and_provision disabled so decide cannot install", () => {
    const store = normalizeEnterpriseDataStore(null);
    const request = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "pack_skill_review",
      ...subject,
      requestedBy: "emp-member-001",
      nowIso,
    });
    expect(() =>
      decideGovernanceApprovalRequest({
        store,
        tenantId,
        approvalId: request.approvalId,
        decision: "approved",
        decidedBy: "emp-admin-001",
        nowIso,
        fulfillmentMode: "approve_and_provision",
      }),
    ).toThrow(/only supported for mcp_tool_mapping/);
    expect(request.status).toBe("pending");
    expect(Object.keys(store.seatActionGrants)).toHaveLength(0);
    expect(Object.keys(store.dataCapabilities)).toHaveLength(0);
  });
});

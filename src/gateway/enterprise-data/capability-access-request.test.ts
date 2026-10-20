// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildMcpToolMappingSubjectId,
  cancelGovernanceApprovalRequest,
  createCapabilityAccessRequest,
  fulfillGovernanceApprovalRequest,
} from "./capability-access-request.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  decideGovernanceApprovalRequest,
  listGovernanceApprovalRequests,
  resolveGovernanceApprovalCenterOverview,
} from "./governance-approval-store.js";
import { upsertMcpToolMapping } from "./mcp-mapping.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-10-16T01:00:00.000Z";

describe("capability-access MVP (cn-office approval backend)", () => {
  it("lets an employee create mcp_tool_mapping without writing mapping/grant", () => {
    const store = normalizeEnterpriseDataStore(null);
    const request = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "feishu",
      mcpTool: "docs.search",
      discoveryStatusSnapshot: "unmapped",
      requestedBy: "emp-member-001",
      requesterSeatId: "seat-1",
      catalogId: "catalog-daibai",
      templateId: "tpl-cn-office",
      reason: "需要飞书文档检索",
      nowIso,
    });

    expect(request.category).toBe("mcp_tool_mapping");
    expect(request.status).toBe("pending");
    expect(request.reviewState).toBe("submitted");
    expect(request.fulfillmentStatus).toBe("not_required");
    expect(request.subjectId).toBe(buildMcpToolMappingSubjectId("feishu", "docs.search"));
    expect(request.subjectPayload).toMatchObject({
      mcpServer: "feishu",
      mcpTool: "docs.search",
      discoveryStatusSnapshot: "unmapped",
      catalogId: "catalog-daibai",
      templateId: "tpl-cn-office",
    });
    expect(Object.keys(store.dataCapabilities)).toHaveLength(0);
    expect(Object.keys(store.seatActionGrants)).toHaveLength(0);

    const overview = resolveGovernanceApprovalCenterOverview({ store, tenantId });
    expect(overview.pendingByCategory.mcp_tool_mapping).toBe(1);
  });

  it("rejects duplicate pending mcp requests for the same requester+subject", () => {
    const store = normalizeEnterpriseDataStore(null);
    createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "feishu",
      mcpTool: "docs.search",
      requestedBy: "emp-member-001",
      nowIso,
    });
    expect(() =>
      createCapabilityAccessRequest({
        store,
        tenantId,
        category: "mcp_tool_mapping",
        mcpServer: "feishu",
        mcpTool: "docs.search",
        requestedBy: "emp-member-001",
        nowIso,
      }),
    ).toThrow(EnterpriseDataStoreError);

    // Different requester can still open a parallel pending request.
    const other = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "feishu",
      mcpTool: "docs.search",
      requestedBy: "emp-member-002",
      nowIso,
    });
    expect(other.requestedBy).toBe("emp-member-002");
  });

  it("returns the same request for a repeated clientRequestId", () => {
    const store = normalizeEnterpriseDataStore(null);
    const first = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "jira",
      mcpTool: "issue.get",
      requestedBy: "emp-member-001",
      clientRequestId: "client-req-1",
      nowIso,
    });
    const second = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "jira",
      mcpTool: "issue.get",
      requestedBy: "emp-member-001",
      clientRequestId: "client-req-1",
      nowIso: "2026-10-16T02:00:00.000Z",
    });
    expect(second.approvalId).toBe(first.approvalId);
  });

  it("approve_intent_only sets pending_admin_save and never upserts mapping", () => {
    const store = normalizeEnterpriseDataStore(null);
    const request = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "feishu",
      mcpTool: "docs.search",
      requestedBy: "emp-member-001",
      nowIso,
    });

    const decided = decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      decisionNote: "同意映射意图",
      nowIso,
      fulfillmentMode: "approve_intent_only",
    });

    expect(decided.status).toBe("approved");
    expect(decided.fulfillmentMode).toBe("approve_intent_only");
    expect(decided.fulfillmentStatus).toBe("pending_admin_save");
    expect(decided.decidedBy).toBe("emp-admin-001");
    expect(Object.keys(store.dataCapabilities)).toHaveLength(0);
    expect(Object.keys(store.connectorActions)).toHaveLength(0);
  });

  it("approve_and_provision maps the tool and grants the requester seat", () => {
    const store = normalizeEnterpriseDataStore(null);
    const request = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "feishu",
      mcpTool: "docs.search",
      requestedBy: "emp-member-001",
      requesterSeatId: "seat-requester",
      discoveryStatusSnapshot: "mapped_pending_grant",
      nowIso,
    });
    request.subjectPayload = {
      ...request.subjectPayload,
      seatId: "seat-spoof",
    };

    const decided = decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      decisionNote: "批准并开通",
      nowIso,
      fulfillmentMode: "approve_and_provision",
    });

    expect(decided.status).toBe("approved");
    expect(decided.fulfillmentMode).toBe("approve_and_provision");
    expect(decided.fulfillmentStatus).toBe("fulfilled");
    expect(decided.provisionReceipt?.handlerRef).toContain("feishu");
    expect(decided.provisionReceipt?.capabilityId).toBeTruthy();
    expect(decided.provisionReceipt?.grantId).toBeTruthy();
    const grants = Object.values(store.seatActionGrants);
    expect(grants.map((grant) => grant.seatId)).toEqual(["seat-requester"]);
    expect(grants.some((grant) => grant.seatId === "seat-spoof")).toBe(false);
  });

  it("approve_and_provision without a seat-grant subject does not write a grant", () => {
    const store = normalizeEnterpriseDataStore(null);
    const request = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "feishu",
      mcpTool: "docs.search",
      requestedBy: "emp-member-001",
      requesterSeatId: "seat-requester",
      discoveryStatusSnapshot: "unmapped",
      nowIso,
    });
    const decided = decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      nowIso,
      fulfillmentMode: "approve_and_provision",
    });
    expect(decided.fulfillmentStatus).toBe("fulfilled");
    expect(decided.provisionReceipt?.capabilityId).toBeTruthy();
    expect(decided.provisionReceipt?.grantId).toBeUndefined();
    expect(Object.keys(store.seatActionGrants)).toHaveLength(0);
  });

  it("keeps approved plus failed when provision cannot grant, then retries without changing the decision", () => {
    const store = normalizeEnterpriseDataStore(null);
    const request = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "feishu",
      mcpTool: "docs.search",
      requestedBy: "emp-member-001",
      discoveryStatusSnapshot: "mapped_pending_grant",
      nowIso,
    });
    const decided = decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      decisionNote: "开通",
      nowIso,
      fulfillmentMode: "approve_and_provision",
    });
    expect(decided.status).toBe("approved");
    expect(decided.fulfillmentStatus).toBe("failed");
    expect(decided.provisionError).toContain("没有席位");
    expect(decided.provisionReceipt).toBeUndefined();
    expect(Object.keys(store.dataCapabilities).length).toBeGreaterThan(0);
    expect(Object.keys(store.seatActionGrants)).toHaveLength(0);

    request.requesterSeatId = "seat-requester";
    const retried = decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      decision: "approved",
      decidedBy: "emp-other-admin",
      decisionNote: "不应覆盖",
      nowIso: "2026-10-16T03:00:00.000Z",
      fulfillmentMode: "approve_and_provision",
    });
    expect(retried.status).toBe("approved");
    expect(retried.decidedBy).toBe("emp-admin-001");
    expect(retried.decidedAt).toBe(nowIso);
    expect(retried.decisionNote).toBe("开通");
    expect(retried.fulfillmentStatus).toBe("fulfilled");
    expect(retried.provisionReceipt?.grantId).toBeTruthy();
    expect(Object.values(store.seatActionGrants).map((grant) => grant.seatId)).toEqual([
      "seat-requester",
    ]);
  });

  it("rejects approve_and_provision for oi and pack without writing grants", () => {
    const store = normalizeEnterpriseDataStore(null);
    const oi = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "oi_enrollment",
      identityScope: "enterprise",
      identityId: "oi-1",
      targetAgentId: "agent-1",
      requestedBy: "emp-member-001",
      requesterSeatId: "seat-requester",
      nowIso,
    });
    expect(() =>
      decideGovernanceApprovalRequest({
        store,
        tenantId,
        approvalId: oi.approvalId,
        decision: "approved",
        decidedBy: "emp-admin-001",
        nowIso,
        fulfillmentMode: "approve_and_provision",
      }),
    ).toThrow(/only supported for mcp_tool_mapping/);
    expect(oi.status).toBe("pending");
    expect(Object.keys(store.seatActionGrants)).toHaveLength(0);
  });

  it("does not decide a request that belongs to another tenant", () => {
    const store = normalizeEnterpriseDataStore(null);
    const request = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "feishu",
      mcpTool: "docs.search",
      requestedBy: "emp-member-001",
      requesterSeatId: "seat-requester",
      discoveryStatusSnapshot: "mapped_pending_grant",
      nowIso,
    });
    expect(() =>
      decideGovernanceApprovalRequest({
        store,
        tenantId: "tenant-other",
        approvalId: request.approvalId,
        decision: "approved",
        decidedBy: "emp-admin-001",
        nowIso,
        fulfillmentMode: "approve_and_provision",
      }),
    ).toThrow(/not found/);
    expect(request.status).toBe("pending");
    expect(Object.keys(store.seatActionGrants)).toHaveLength(0);
    expect(Object.keys(store.dataCapabilities)).toHaveLength(0);
  });

  it("supports reject and requester cancel", () => {
    const store = normalizeEnterpriseDataStore(null);
    const toReject = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "a",
      mcpTool: "t1",
      requestedBy: "emp-member-001",
      nowIso,
    });
    const rejected = decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: toReject.approvalId,
      decision: "rejected",
      decidedBy: "emp-admin-001",
      decisionNote: "风险过高",
      nowIso,
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.fulfillmentStatus).toBe("not_required");

    const toCancel = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "a",
      mcpTool: "t2",
      requestedBy: "emp-member-001",
      nowIso,
    });
    expect(() =>
      cancelGovernanceApprovalRequest({
        store,
        tenantId,
        approvalId: toCancel.approvalId,
        actorId: "emp-member-002",
        asAdmin: false,
        nowIso,
      }),
    ).toThrow(/Only the requester/);

    const cancelled = cancelGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: toCancel.approvalId,
      actorId: "emp-member-001",
      asAdmin: false,
      nowIso,
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("fulfills after explicit admin mapping Save", () => {
    const store = normalizeEnterpriseDataStore(null);
    const request = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "feishu",
      mcpTool: "docs.search",
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

    const mapped = upsertMcpToolMapping({
      store,
      tenantId,
      nowIso,
      input: { mcpServer: "feishu", mcpTool: "docs.search" },
      createdBy: "emp-admin-001",
    });
    const fulfilled = fulfillGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      fulfilledBy: "emp-admin-001",
      nowIso,
      provisionReceipt: {
        handlerRef: mapped.handlerRef,
        capabilityId: mapped.capability.capabilityId,
      },
    });
    expect(fulfilled.fulfillmentStatus).toBe("fulfilled");
    expect(fulfilled.fulfilledBy).toBe("emp-admin-001");
    expect(fulfilled.provisionReceipt?.capabilityId).toBe(mapped.capability.capabilityId);
    // Still no seat grant from approve/fulfill alone.
    expect(Object.keys(store.seatActionGrants)).toHaveLength(0);
  });

  it("creates pack_skill_review with cn-office enterprise_review_required mark", () => {
    const store = normalizeEnterpriseDataStore(null);
    const request = createCapabilityAccessRequest({
      store,
      tenantId,
      category: "pack_skill_review",
      packId: "cn-office",
      skillKey: "meeting.schedule",
      targetRobotId: "robot-1",
      requestedBy: "emp-member-001",
      nowIso,
    });
    expect(request.subjectPayload?.employeeVisibilityMode).toBe("enterprise_review_required");
    expect(request.subjectId).toContain("pack:cn-office:skill:");
  });

  it("filters list by requestedBy for mine views", () => {
    const store = normalizeEnterpriseDataStore(null);
    createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "a",
      mcpTool: "t1",
      requestedBy: "emp-member-001",
      nowIso,
    });
    createCapabilityAccessRequest({
      store,
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "a",
      mcpTool: "t2",
      requestedBy: "emp-member-002",
      nowIso,
    });
    const mine = listGovernanceApprovalRequests({
      store,
      tenantId,
      requestedBy: "emp-member-001",
    });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.requestedBy).toBe("emp-member-001");
  });
});

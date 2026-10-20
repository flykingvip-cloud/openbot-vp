import { describe, expect, it } from "vitest";
import {
  createMemoryDiagnosisApprovalStore,
  decideEnterpriseDiagnosisApproval,
  type DiagnosisApprovalRequest,
  type DiagnosisConsultGrant,
} from "./approval-ledger.js";

const TENANT = "tenant-fixture-a";

function grant(over: Partial<DiagnosisConsultGrant> = {}): DiagnosisConsultGrant {
  return {
    grantId: "grant-a",
    status: "REQUESTED",
    approverRole: "enterprise",
    targetTenant: TENANT,
    ...over,
  };
}

function request(over: Partial<DiagnosisApprovalRequest> = {}): DiagnosisApprovalRequest {
  return {
    schemaVersion: 1,
    idempotencyKey: "idem-1",
    subject: { kind: "authorization", grantId: "grant-a" },
    decision: "approve",
    reason: null,
    ...over,
  };
}

async function decide(
  store: ReturnType<typeof createMemoryDiagnosisApprovalStore>,
  body: DiagnosisApprovalRequest,
  resolve: () =>
    | { ok: true; sessionKey: string }
    | {
        ok: false;
        reason: "conversation_not_found" | "session_key_unavailable" | "tenant_mismatch";
      } = () => ({
    ok: false,
    reason: "conversation_not_found",
  }),
) {
  return decideEnterpriseDiagnosisApproval({
    tenantId: TENANT,
    actorId: "admin-a",
    now: "2026-10-12T00:00:00.000Z",
    request: body,
    store,
    resolveConversation: resolve,
    createApprovalId: () => "dap-1",
  });
}

describe("enterprise diagnosis approval ledger", () => {
  it("records a grant decision only after the status write", async () => {
    const store = createMemoryDiagnosisApprovalStore();
    store.putGrant(TENANT, grant());
    const result = await decide(store, request());
    expect(result).toMatchObject({
      status: "recorded",
      approvalId: "dap-1",
      subjectKind: "authorization",
      decision: "approve",
      grantId: "grant-a",
      effect: { type: "grant", grantId: "grant-a", grantStatus: "APPROVED" },
    });
    expect(store.getGrant(TENANT, "grant-a")?.status).toBe("APPROVED");
    expect(store.listApprovals(TENANT)).toHaveLength(1);
  });

  it("replays the same idempotency key and refuses a different body", async () => {
    const store = createMemoryDiagnosisApprovalStore();
    store.putGrant(TENANT, grant());
    const first = await decide(store, request());
    const replay = await decide(store, request());
    expect(replay).toEqual(first);
    expect(store.listApprovals(TENANT)).toHaveLength(1);
    const conflict = await decide(store, request({ decision: "deny" }));
    expect(conflict).toMatchObject({ status: "refused", reason: "idempotency_conflict" });
    expect(conflict).not.toHaveProperty("approvalId");
    expect(store.getGrant(TENANT, "grant-a")?.status).toBe("APPROVED");
  });

  it("refuses a platform grant and a missing session without keeping a row", async () => {
    const store = createMemoryDiagnosisApprovalStore();
    store.putGrant(TENANT, grant({ approverRole: "platform" }));
    const mismatch = await decide(store, request());
    expect(mismatch).toMatchObject({ status: "refused", reason: "approver_role_mismatch" });
    expect(store.listApprovals(TENANT)).toHaveLength(0);

    const missingSession = await decide(
      store,
      request({
        idempotencyKey: "idem-open",
        subject: { kind: "conversation", signalId: "sig-a", caseId: "case-a" },
      }),
      () => ({ ok: false, reason: "session_key_unavailable" }),
    );
    expect(missingSession).toMatchObject({ status: "refused", reason: "session_key_unavailable" });
    expect(store.listApprovals(TENANT)).toHaveLength(0);
  });

  it("opens a conversation only when a live session key comes back", async () => {
    const store = createMemoryDiagnosisApprovalStore();
    const opened = await decide(
      store,
      request({
        subject: { kind: "conversation", signalId: "sig-a" },
        decision: "approve",
      }),
      () => ({ ok: true, sessionKey: "agent:daibai:main" }),
    );
    expect(opened).toMatchObject({
      status: "recorded",
      subjectKind: "conversation",
      grantId: null,
      effect: { type: "conversation", opened: true, sessionKey: "agent:daibai:main" },
    });
  });

  it("refuses a conversation that only has a target ref", async () => {
    const store = createMemoryDiagnosisApprovalStore();
    const result = await decide(
      store,
      request({
        subject: {
          kind: "conversation",
          targetRef: { targetType: "agent", targetId: "bot-a", tenantId: TENANT },
        },
      }),
    );
    expect(result).toMatchObject({ status: "refused", reason: "subject_incomplete" });
    expect(store.listApprovals(TENANT)).toHaveLength(0);
  });
});

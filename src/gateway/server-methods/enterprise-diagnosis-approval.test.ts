import { describe, expect, it, afterEach } from "vitest";
import {
  createMemoryDiagnosisApprovalStore,
  ENTERPRISE_DIAGNOSIS_APPROVAL_DECIDE_METHOD,
} from "../../diagnosis/approval-ledger.js";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";
import { listGatewayMethods } from "../server-methods-list.js";
import {
  enterpriseDiagnosisApprovalHandlers,
  setEnterpriseDiagnosisApprovalDepsForTests,
} from "./enterprise-diagnosis-approval.js";
import type { GatewayClient } from "./types.js";

const METHOD = ENTERPRISE_DIAGNOSIS_APPROVAL_DECIDE_METHOD;

function client(over: Partial<GatewayClient> = {}): GatewayClient {
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 3,
      client: {
        id: "openbot-control-ui",
        displayName: "test",
        version: "0",
        platform: "web",
        mode: "webchat",
      },
      scopes: ["operator.approvals"],
    },
    user: "ent-admin",
    sessionDomain: "enterprise",
    sessionKind: "enterprise-admin",
    sessionEnterpriseId: "tenant-fixture-a",
    ...over,
  };
}

function invoke(params: Record<string, unknown>, caller: GatewayClient | null = client()) {
  const handler = enterpriseDiagnosisApprovalHandlers[METHOD];
  return new Promise<{
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { code?: string; message?: string };
  }>((resolve) => {
    void handler({
      req: { id: "1", method: METHOD, type: "req" },
      params,
      client: caller,
      isWebchatConnect: () => false,
      respond: (ok, payload, error) => {
        resolve({
          ok,
          payload: payload as Record<string, unknown> | undefined,
          error: error as { code?: string; message?: string } | undefined,
        });
      },
      context: {} as never,
    });
  });
}

const approveGrant = {
  schemaVersion: 1,
  idempotencyKey: "idem-grant",
  subject: { kind: "authorization", grantId: "grant-a" },
  decision: "approve",
  reason: null,
};

describe("enterprise.diagnosis.approval.decide", () => {
  afterEach(() => {
    setEnterpriseDiagnosisApprovalDepsForTests(null);
  });

  it("is registered under operator.approvals beside the platform method", () => {
    expect(listGatewayMethods()).toContain(METHOD);
    expect(listGatewayMethods()).toContain("platform.diagnosis.approval.decide");
    expect(authorizeOperatorScopesForMethod(METHOD, ["operator.approvals"]).allowed).toBe(true);
    expect(authorizeOperatorScopesForMethod(METHOD, ["operator.read"]).allowed).toBe(false);
    expect(authorizeOperatorScopesForMethod(METHOD, ["operator.write"]).allowed).toBe(false);
  });

  it("rejects a platform session and an admin scope that lacks operator.approvals", async () => {
    const platform = await invoke(
      approveGrant,
      client({
        sessionDomain: "platform",
        sessionKind: "platform-admin",
        sessionEnterpriseId: undefined,
      }),
    );
    expect(platform.ok).toBe(false);
    expect(platform.error?.message).toContain("platform session");

    const adminOnly = await invoke(
      approveGrant,
      client({
        connect: {
          ...client().connect,
          scopes: ["operator.admin"],
        },
      }),
    );
    expect(adminOnly.ok).toBe(false);
    expect(adminOnly.error?.message).toContain("operator.approvals");
  });

  it("approves an enterprise grant and refuses a second different body", async () => {
    const store = createMemoryDiagnosisApprovalStore();
    store.putGrant("tenant-fixture-a", {
      grantId: "grant-a",
      status: "REQUESTED",
      approverRole: "enterprise",
      targetTenant: "tenant-fixture-a",
    });
    setEnterpriseDiagnosisApprovalDepsForTests({
      store,
      sessionKeys: () => [],
      projectionsDir: "/tmp/diagnosis-approvals-none",
      now: () => "2026-10-12T00:00:00.000Z",
    });
    const ok = await invoke(approveGrant);
    expect(ok.ok).toBe(true);
    expect(ok.payload).toMatchObject({
      status: "recorded",
      effect: { type: "grant", grantId: "grant-a", grantStatus: "APPROVED" },
    });
    const conflict = await invoke({ ...approveGrant, decision: "deny" });
    expect(conflict.ok).toBe(true);
    expect(conflict.payload).toMatchObject({
      status: "refused",
      reason: "idempotency_conflict",
    });
    expect(conflict.payload).not.toHaveProperty("approvalId");
  });

  it("does not record an approval when the Daibai session cannot be opened", async () => {
    const store = createMemoryDiagnosisApprovalStore();
    setEnterpriseDiagnosisApprovalDepsForTests({
      store,
      sessionKeys: () => [],
      projectionsDir: "/tmp/diagnosis-approvals-none",
      now: () => "2026-10-12T00:00:00.000Z",
    });
    const result = await invoke({
      schemaVersion: 1,
      idempotencyKey: "idem-open",
      subject: { kind: "conversation", signalId: "sig-a", caseId: "case-a" },
      decision: "approve",
      reason: null,
    });
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      status: "refused",
      reason: "conversation_not_found",
    });
    expect(store.listApprovals("tenant-fixture-a")).toHaveLength(0);
  });
});

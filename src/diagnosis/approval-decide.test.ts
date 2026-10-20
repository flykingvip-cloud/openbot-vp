import { describe, expect, it } from "vitest";
import {
  DiagnosisApprovalInvalidRequest,
  createMemoryDiagnosisApprovalLedger,
  decideDiagnosisApproval,
  type DiagnosisApprovalGrant,
  type DiagnosisApprovalLedger,
  type DiagnosisApprovalPorts,
} from "./approval-decide.js";

const actor = {
  principalId: "plat-admin",
  sessionKind: "platform-admin",
  domain: "platform" as const,
};

function grant(over: Partial<DiagnosisApprovalGrant> = {}): DiagnosisApprovalGrant {
  return {
    grantId: "grant-1",
    status: "REQUESTED",
    approverRole: "platform",
    targetTenant: "tenant-a",
    ...over,
  };
}

function setup() {
  const grants = new Map<string, DiagnosisApprovalGrant>([["grant-1", grant()]]);
  const known = new Set<string>(["sig-1", "case-1"]);
  const reports = new Map<string, unknown>([
    ["cdr-1", { reportId: "cdr-1", tenantId: "tenant-a" }],
  ]);
  const ledger = createMemoryDiagnosisApprovalLedger();
  const ops: string[] = [];
  let openFails = false;
  let serializeFails = false;
  let ids = 0;
  const tracking: DiagnosisApprovalLedger = {
    lookup: (key) => ledger.lookup(key),
    insert(row) {
      ops.push("insert");
      ledger.insert(row);
    },
    remove(id) {
      ops.push("remove");
      ledger.remove(id);
    },
    finish(row, result, key, body) {
      ops.push("finish");
      ledger.finish(row, result, key, body);
    },
    remember(key, body, result) {
      ops.push("remember");
      ledger.remember(key, body, result);
    },
    hasAny: (id) => ledger.hasAny(id),
    finishedCount: () => ledger.finishedCount(),
  };
  const ports: DiagnosisApprovalPorts = {
    now: () => "2026-10-12T00:00:00.000Z",
    newId: () => `appr-${++ids}`,
    ledger: tracking,
    grants: {
      async get(id) {
        return grants.get(id);
      },
      async applyStatus(id, status) {
        ops.push(`effect:${status}`);
        const current = grants.get(id);
        if (!current) {
          throw new Error("missing");
        }
        grants.set(id, { ...current, status });
      },
    },
    conversations: {
      async find(input) {
        return known.has(input.signalId ?? "") || known.has(input.caseId ?? "");
      },
      async openSession() {
        ops.push("open-session");
        if (openFails) {
          throw new Error("open failed");
        }
        return "agent:daibai:diagnosis:opened";
      },
    },
    reports: {
      async load(id) {
        ops.push("load-report");
        return reports.get(id) ?? null;
      },
      serialize(report) {
        ops.push("serialize");
        if (serializeFails) {
          throw new Error("serialize failed");
        }
        return JSON.stringify(report);
      },
    },
  };
  return {
    grants,
    known,
    reports,
    ledger,
    ops,
    ports,
    setOpenFails: (value: boolean) => {
      openFails = value;
    },
    setSerializeFails: (value: boolean) => {
      serializeFails = value;
    },
  };
}

function params(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    idempotencyKey: "key-1",
    decision: "approve",
    reason: null,
    subject: { kind: "authorization", grantId: "grant-1" },
    ...over,
  };
}

describe("decideDiagnosisApproval", () => {
  it("requires idempotencyKey before any write", async () => {
    const env = setup();
    const { idempotencyKey: _ignored, ...rest } = params();
    await expect(
      decideDiagnosisApproval({ domain: "platform", actor, params: rest }, env.ports),
    ).rejects.toBeInstanceOf(DiagnosisApprovalInvalidRequest);
    expect(env.ops).toEqual([]);
  });

  it("writes the approval row before the grant effect and records APPROVED", async () => {
    const env = setup();
    const result = await decideDiagnosisApproval(
      { domain: "platform", actor, params: params() },
      env.ports,
    );
    expect(result).toMatchObject({
      status: "recorded",
      approvalId: "appr-1",
      subjectKind: "authorization",
      decision: "approve",
      grantId: "grant-1",
      effect: { type: "grant", grantId: "grant-1", grantStatus: "APPROVED" },
    });
    expect(env.grants.get("grant-1")?.status).toBe("APPROVED");
    expect(env.ops.indexOf("insert")).toBeLessThan(env.ops.indexOf("effect:APPROVED"));
    expect(env.ledger.finishedCount()).toBe(1);
  });

  it("denies a REQUESTED grant", async () => {
    const env = setup();
    const result = await decideDiagnosisApproval(
      { domain: "platform", actor, params: params({ decision: "deny" }) },
      env.ports,
    );
    expect(result).toMatchObject({
      status: "recorded",
      effect: { type: "grant", grantStatus: "DENIED" },
    });
    expect(env.grants.get("grant-1")?.status).toBe("DENIED");
  });

  it("replays the same key and body without a second effect", async () => {
    const env = setup();
    const first = await decideDiagnosisApproval(
      { domain: "platform", actor, params: params() },
      env.ports,
    );
    const second = await decideDiagnosisApproval(
      { domain: "platform", actor, params: params() },
      env.ports,
    );
    expect(second).toEqual(first);
    expect(env.ops.filter((op) => op.startsWith("effect:"))).toEqual(["effect:APPROVED"]);
    expect(env.ledger.finishedCount()).toBe(1);
  });

  it("refuses a conflicting body and does not write a second row", async () => {
    const env = setup();
    await decideDiagnosisApproval({ domain: "platform", actor, params: params() }, env.ports);
    const conflict = await decideDiagnosisApproval(
      { domain: "platform", actor, params: params({ decision: "deny" }) },
      env.ports,
    );
    expect(conflict).toMatchObject({ status: "refused", reason: "idempotency_conflict" });
    expect(conflict).not.toHaveProperty("approvalId");
    expect(env.grants.get("grant-1")?.status).toBe("APPROVED");
    expect(env.ledger.finishedCount()).toBe(1);
  });

  it("refuses a non-pending grant and writes no row", async () => {
    const env = setup();
    env.grants.set("grant-1", grant({ status: "APPROVED" }));
    const result = await decideDiagnosisApproval(
      { domain: "platform", actor, params: params() },
      env.ports,
    );
    expect(result).toMatchObject({ status: "refused", reason: "grant_not_pending" });
    expect(env.ops).not.toContain("insert");
    expect(env.ledger.hasAny("appr-1")).toBe(false);
    expect(env.grants.get("grant-1")?.status).toBe("APPROVED");
  });

  it("refuses a missing grant and an enterprise approver role", async () => {
    const env = setup();
    const missing = await decideDiagnosisApproval(
      {
        domain: "platform",
        actor,
        params: params({
          idempotencyKey: "missing",
          subject: { kind: "authorization", grantId: "nope" },
        }),
      },
      env.ports,
    );
    expect(missing).toMatchObject({ status: "refused", reason: "grant_not_found" });
    env.grants.set("grant-1", grant({ approverRole: "enterprise" }));
    const mismatch = await decideDiagnosisApproval(
      { domain: "platform", actor, params: params({ idempotencyKey: "role" }) },
      env.ports,
    );
    expect(mismatch).toMatchObject({ status: "refused", reason: "approver_role_mismatch" });
    expect(env.ledger.finishedCount()).toBe(0);
  });

  it("treats targetRef alone as subject_incomplete", async () => {
    const env = setup();
    const result = await decideDiagnosisApproval(
      {
        domain: "platform",
        actor,
        params: params({
          subject: {
            kind: "conversation",
            targetRef: { targetType: "session", targetId: "session-a", tenantId: "tenant-a" },
          },
        }),
      },
      env.ports,
    );
    expect(result).toMatchObject({ status: "refused", reason: "subject_incomplete" });
    expect(env.ops).not.toContain("insert");
    expect(env.ops).not.toContain("open-session");
  });

  it("returns a session key only when the conversation approve is recorded", async () => {
    const env = setup();
    const opened = await decideDiagnosisApproval(
      {
        domain: "platform",
        actor,
        params: params({
          subject: { kind: "conversation", signalId: "sig-1", caseId: "case-1" },
        }),
      },
      env.ports,
    );
    expect(opened).toMatchObject({
      status: "recorded",
      effect: { type: "conversation", opened: true, sessionKey: "agent:daibai:diagnosis:opened" },
    });
    expect(env.ops.indexOf("insert")).toBeLessThan(env.ops.indexOf("open-session"));

    env.setOpenFails(true);
    const failed = await decideDiagnosisApproval(
      {
        domain: "platform",
        actor,
        params: params({
          idempotencyKey: "open-fail",
          subject: { kind: "conversation", caseId: "case-1" },
        }),
      },
      env.ports,
    );
    expect(failed).toEqual({
      status: "refused",
      reason: "session_key_unavailable",
      effect: { type: "none", reason: "session_key_unavailable" },
    });
    expect(failed).not.toHaveProperty("approvalId");
    expect(env.ledger.finishedCount()).toBe(1);
    expect(env.ledger.hasAny("appr-2")).toBe(false);
  });

  it("records a conversation deny without a session key", async () => {
    const env = setup();
    const result = await decideDiagnosisApproval(
      {
        domain: "platform",
        actor,
        params: params({
          decision: "deny",
          subject: { kind: "conversation", signalId: "sig-1" },
        }),
      },
      env.ports,
    );
    expect(result).toMatchObject({
      status: "recorded",
      effect: { type: "none", reason: "denied" },
    });
    expect(env.ops).not.toContain("open-session");
  });

  it("refuses an unknown conversation and keeps no row", async () => {
    const env = setup();
    const result = await decideDiagnosisApproval(
      {
        domain: "platform",
        actor,
        params: params({ subject: { kind: "conversation", signalId: "missing" } }),
      },
      env.ports,
    );
    expect(result).toMatchObject({ status: "refused", reason: "conversation_not_found" });
    expect(env.ledger.finishedCount()).toBe(0);
    expect(env.ops).toContain("insert");
    expect(env.ops).toContain("remove");
  });

  it("exports a report body only when the approve is recorded", async () => {
    const env = setup();
    const exported = await decideDiagnosisApproval(
      {
        domain: "platform",
        actor,
        params: params({
          subject: { kind: "report-export", reportId: "cdr-1", redactionProfile: "administrator" },
        }),
      },
      env.ports,
    );
    expect(exported).toMatchObject({
      status: "recorded",
      subjectKind: "report-export",
      effect: { type: "export", mediaType: "application/json" },
    });
    if (exported.status === "recorded" && exported.effect.type === "export") {
      expect(exported.effect.body.length).toBeGreaterThan(0);
    }
    expect(env.ops.indexOf("insert")).toBeLessThan(env.ops.indexOf("serialize"));

    const denied = await decideDiagnosisApproval(
      {
        domain: "platform",
        actor,
        params: params({
          idempotencyKey: "export-deny",
          decision: "deny",
          subject: { kind: "report-export", reportId: "cdr-1", redactionProfile: "administrator" },
        }),
      },
      env.ports,
    );
    expect(denied).toMatchObject({
      status: "recorded",
      effect: { type: "none", reason: "denied" },
    });
    expect(denied).not.toHaveProperty("body");
  });

  it("drops the approval row when export fails", async () => {
    const env = setup();
    const missing = await decideDiagnosisApproval(
      {
        domain: "platform",
        actor,
        params: params({
          subject: { kind: "report-export", reportId: "missing", redactionProfile: "user" },
        }),
      },
      env.ports,
    );
    expect(missing).toMatchObject({ status: "refused", reason: "report_not_found" });
    expect(missing).not.toHaveProperty("approvalId");
    if (missing.status === "refused") {
      expect(missing.effect).toEqual({ type: "none", reason: "report_not_found" });
    }

    env.setSerializeFails(true);
    const failed = await decideDiagnosisApproval(
      {
        domain: "platform",
        actor,
        params: params({
          idempotencyKey: "serialize-fail",
          subject: { kind: "report-export", reportId: "cdr-1", redactionProfile: "administrator" },
        }),
      },
      env.ports,
    );
    expect(failed).toMatchObject({ status: "refused", reason: "export_unavailable" });
    expect(env.ledger.finishedCount()).toBe(0);
    expect(env.ledger.hasAny("appr-1")).toBe(false);
    expect(env.ledger.hasAny("appr-2")).toBe(false);
  });

  it("rejects report-export on the enterprise decide path and enforces tenant match", async () => {
    const env = setup();
    const enterpriseActor = {
      ...actor,
      domain: "enterprise" as const,
      sessionKind: "enterprise-admin",
    };
    const exported = await decideDiagnosisApproval(
      {
        domain: "enterprise",
        membershipTenantId: "tenant-a",
        actor: enterpriseActor,
        params: params({
          subject: { kind: "report-export", reportId: "cdr-1", redactionProfile: "administrator" },
        }),
      },
      env.ports,
    );
    expect(exported).toMatchObject({ status: "refused", reason: "subject_incomplete" });
    expect(env.ops).not.toContain("insert");
    expect(env.ops).not.toContain("load-report");

    env.grants.set("grant-1", grant({ approverRole: "enterprise", targetTenant: "other" }));
    const mismatch = await decideDiagnosisApproval(
      {
        domain: "enterprise",
        membershipTenantId: "tenant-a",
        actor: enterpriseActor,
        params: params({ idempotencyKey: "tenant" }),
      },
      env.ports,
    );
    expect(mismatch).toMatchObject({ status: "refused", reason: "tenant_mismatch" });
    expect(env.ledger.finishedCount()).toBe(0);
  });
});

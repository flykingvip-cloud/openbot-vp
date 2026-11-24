import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import { createConversationDiagnosisMachine } from "./conversation-run.js";
import {
  computeDiagnosisDaibaiDeliveryId,
  createDiagnosisDaibaiDeliveryQueue,
  createMemoryDaibaiTransport,
} from "./daibai-delivery.js";
import { createDiagnosisDelegationMachine } from "./delegation.js";
import type { DelegationActor, DelegationCommandInput } from "./delegation.js";
import {
  DIAGNOSIS_CANARY_POLICY,
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_P24_5_CANARY_TENANT,
  DIAGNOSIS_PRODUCTION_GATES,
  DIAGNOSIS_PRODUCTION_ROLLBACK_TRIGGERS,
  DIAGNOSIS_PRODUCTION_SLO,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
  assertDiagnosisProductionCutoverClosed,
  attachDiagnosisProductionStatus,
  bindConversationDiagnosisToLiveChat,
  drillDiagnosisProductionRollback,
  evaluateDiagnosisProductionCutover,
  injectDiagnosisProductionFault,
  isDiagnosisProductionSloHealthy,
  resolveProductionDaibaiTransport,
  resolveProductionRemediationExecutor,
} from "./production-cutover.js";
import { createUnavailableRemediationExecutor } from "./remediation.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import {
  createDiagnosisReportGatewayHandlers,
  resolveDiagnosisProductionAuth,
} from "./report-query-gateway.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import type { DiagnosticSignal } from "./signal.js";
import { isDiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal, DiagnosticTarget, TrustedTenantContext } from "./types.js";
import { projectDiagnosisVisualization } from "./visualization.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-fixture-b";
const TRUSTED_A: TrustedTenantContext = { tenantId: TENANT_A };
const TRUSTED_PLATFORM: TrustedTenantContext = { tenantId: null };
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function principal(id: string, tenantId: string | null): DiagnosticPrincipal {
  return { schemaVersion: 1, principalId: id, kind: "user", tenantId };
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (err) {
    expect(isDiagnosisContractError(err)).toBe(true);
    if (isDiagnosisContractError(err)) {
      expect(err.code).toBe(code);
    }
  }
}

function target(): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-a",
    tenantId: TENANT_A,
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-a" },
  };
}

function signal(over: Partial<DiagnosticSignal> = {}): DiagnosticSignal {
  return {
    schemaVersion: 1,
    signalId: "sig:p11:tenant-fixture-a:session:session-a:1",
    kind: "scheduled",
    tenantId: TENANT_A,
    fingerprint: "scheduled|tenant-fixture-a|session:session-a|p11",
    status: "open",
    target: target(),
    evidenceIds: ["ev-a"],
    findingIds: ["find-a"],
    caseId: "case-open",
    completion: "CONFIRMED",
    reasonCode: "inspection_scheduled",
    occurrenceCount: 1,
    retryCount: 0,
    observedAt: "2026-09-03T02:00:00.000Z",
    lastSeenAt: "2026-09-03T02:00:00.000Z",
    expiresAt: "2026-09-03T04:00:00.000Z",
    ...over,
  };
}

const platform: DelegationActor = { role: "platform", principal: principal("plat-admin", null) };
const enterprise: DelegationActor = {
  role: "enterprise",
  principal: principal("ent-admin", TENANT_A),
};

function request(
  over: Partial<DelegationCommandInput> &
    Pick<DelegationCommandInput, "commandId" | "actor" | "trusted">,
): DelegationCommandInput {
  return {
    command: "request",
    scenario: "platform_to_employee",
    issuer: platform,
    approver: enterprise,
    grantee: { role: "employee", principal: principal("user-a", TENANT_A) },
    targetTenant: TENANT_A,
    targetPrincipal: "user-a",
    targetScope: { tenantId: TENANT_A, targetType: "session", targetId: "session-a" },
    allowedEvidence: ["finding_ref"],
    allowedActions: ["inspect"],
    purpose: "remote consult",
    expiresAt: "2026-09-04T00:00:00.000Z",
    ...over,
  };
}

describe("P11 production cutover pack", () => {
  it("keeps every production gate closed and records rehearsal provenance", () => {
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const originMainSha = execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const report = evaluateDiagnosisProductionCutover({
      candidateSha,
      originMainSha,
      livePacks: GATEWAY_METHOD_PACKS,
      coreHandlerNames: Object.keys(coreGatewayHandlers),
    });
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.canaryStarted).toBe(false);
    expect(report.trafficSwitched).toBe(false);
    expect(report.canary).toEqual(DIAGNOSIS_CANARY_POLICY);
    expect(report.slo.completeness).toBe("empty");
    expect(isDiagnosisProductionSloHealthy(DIAGNOSIS_PRODUCTION_SLO)).toBe(false);
    expect(report.livePackPreview.wouldRegister).toBe(false);
    expect(report.provenance.published).toBe(false);
    expect(report.provenance.tagged).toBe(false);
    expect(report.provenance.candidateSha).toBe(candidateSha);
    expect(report.provenance.originMainSha).toBe(originMainSha);
    expect(Object.values(DIAGNOSIS_PRODUCTION_GATES).every((gate) => !gate.default)).toBe(true);
    expect(() => assertDiagnosisProductionCutoverClosed(report)).not.toThrow();
  });

  it("reuses existing gateway handlers and hides existence on auth failure", async () => {
    const handlers = createDiagnosisReportGatewayHandlers();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    const auth = await resolveDiagnosisProductionAuth({
      user: "plat-admin",
      sessionDomain: "platform",
      sessionTenantId: TENANT_B,
    });
    expect(auth?.trusted.tenantId).not.toBe(TENANT_B);
    let captured: { ok?: boolean; payload?: unknown; error?: { code?: string } } | undefined;
    await handlers["diagnosis.reports.get"]({
      req: { type: "req", id: "p11", method: "diagnosis.reports.get" },
      params: { reportId: "missing-report", claimedTenantId: TENANT_A },
      client: { user: "anon", sessionTenantId: TENANT_A },
      isWebchatConnect: () => false,
      respond: (ok: boolean, payload: unknown, error?: { code?: string }) => {
        captured = { ok, payload, ...(error ? { error: { code: error.code } } : {}) };
      },
      context: {},
    } as never);
    expect(captured?.ok).toBe(false);
    expect(
      captured?.error?.code ?? (captured?.payload as { error?: { code?: string } })?.error?.code,
    ).not.toBe("not_found");
    expect(JSON.stringify(captured)).not.toMatch(/prompt|toolResult|messageBody/);
  });

  it("fails closed on incomplete platform to employee delegation", () => {
    const machine = createDiagnosisDelegationMachine({
      now: () => Date.parse("2026-09-03T03:10:00.000Z"),
    });
    const dual = machine.dispatch(
      request({
        commandId: "p11-bypass",
        actor: platform,
        trusted: TRUSTED_PLATFORM,
        scenario: "platform_to_employee",
        approver: enterprise,
        grantee: { role: "employee", principal: principal("user-a", TENANT_A) },
        missionId: "msn-p11",
      }),
    );
    expect(dual.reason).toBe("dual_authorization_required");
    expect(dual.status).toBe("REQUESTED");
    expect(machine.getMission("msn-p11")?.status).toBe("REQUESTED");
  });

  it("retries Da Bai delivery idempotently; explicit enabled:false stays unavailable", async () => {
    const memory = createMemoryDaibaiTransport();
    const queue = createDiagnosisDaibaiDeliveryQueue({
      now: () => Date.parse("2026-09-03T03:00:00.000Z"),
      transport: memory,
    });
    const first = await queue.enqueue(signal(), { sessionDomain: "enterprise" });
    const second = await queue.enqueue(signal(), { sessionDomain: "enterprise" });
    expect(first.deliveryId).toBe(
      computeDiagnosisDaibaiDeliveryId(signal().signalId, "enterprise"),
    );
    expect(second.deliveryId).toBe(first.deliveryId);
    expect(memory.projections).toHaveLength(1);
    const gateClosedTransport = resolveProductionDaibaiTransport({ enabled: false });
    expect(await gateClosedTransport.deliver(memory.projections[0])).toBe("unavailable");
    expectCode(
      () => resolveProductionDaibaiTransport({ enabled: true, allowlisted: false }),
      "daibai_transport_not_allowlisted",
    );
    const production = resolveProductionDaibaiTransport({
      enabled: true,
      send: async () => "accepted",
    });
    // Non-canary fixture tenant stays unavailable; canary tenant 001 accepts.
    expect(await production.deliver(memory.projections[0])).toBe("unavailable");
    expect(
      await production.deliver({
        ...memory.projections[0],
        tenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
      }),
    ).toBe("accepted");
  });

  it("keeps unauthorized conversation runs in WAITING_AUTHORIZATION", () => {
    const machine = createConversationDiagnosisMachine({
      now: () => Date.parse("2026-09-03T03:20:00.000Z"),
    });
    const actor = { principal: principal("user-a", TENANT_A), trusted: TRUSTED_A };
    const started = machine.dispatch({
      commandId: "p11-start",
      command: "start",
      signal: signal(),
      ...actor,
    });
    const waiting = machine.dispatch({
      commandId: "p11-ask",
      command: "ask",
      conversationRunId: started.conversationRunId,
      question: "approve session read?",
      authorization: {
        authorizationId: "auth-p11",
        capability: "diagnosis:read",
        expiresAt: "2026-09-03T04:20:00.000Z",
      },
      ...actor,
    });
    expect(waiting.state).toBe("WAITING_AUTHORIZATION");
    expectCode(
      () =>
        machine.dispatch({
          commandId: "p11-collect",
          command: "answer",
          conversationRunId: started.conversationRunId,
          ...actor,
        }),
      "collection_paused",
    );
    expectCode(() => bindConversationDiagnosisToLiveChat(), "live_chat_binding_required");
  });

  it("keeps production remediation on dry-run/unavailable until an allowlisted executor is approved", () => {
    const executor = resolveProductionRemediationExecutor({ enabled: false });
    expect(
      executor.execute({
        actionType: "read_only_check",
        target: target(),
        remediationId: "rem-p11",
      }),
    ).toEqual({ ok: false, reason: "unavailable", evidence: ["executor_unavailable"] });
    expect(
      createUnavailableRemediationExecutor().execute({
        actionType: "read_only_check",
        target: target(),
        remediationId: "rem-p11",
      }).ok,
    ).toBe(false);
    expectCode(
      () => resolveProductionRemediationExecutor({ enabled: true }),
      "remediation_executor_not_allowlisted",
    );
    expectCode(
      () => resolveProductionRemediationExecutor({ enabled: true, allowlisted: true }),
      "remediation_live_executor_undeployed",
    );
  });

  it("fail-closes injected production faults and drills rollback without deleting audit", () => {
    for (const kind of [
      "reader_unavailable",
      "audit_missing",
      "quota_unavailable",
      "schema_incompatible",
      "stale_reader",
      "unauthorized_delivery",
    ] as const) {
      expectCode(
        () => injectDiagnosisProductionFault(kind),
        kind === "stale_reader" ? "reader_stale" : kind,
      );
    }
    const audit = [{ receipt: "audit-1" }, { receipt: "audit-2" }];
    for (const trigger of DIAGNOSIS_PRODUCTION_ROLLBACK_TRIGGERS) {
      const drill = drillDiagnosisProductionRollback({
        trigger,
        auditRecords: audit,
        pendingTaskCount: 3,
      });
      expect(drill.gatesDisabled).toBe(true);
      expect(drill.livePackRevoked).toBe(true);
      expect(drill.newTasksStopped).toBe(true);
      expect(drill.auditRetained).toBe(true);
      expect(drill.historyDeleted).toBe(false);
      expect(drill.remainingAuditCount).toBe(2);
      expect(drill.stoppedTaskCount).toBe(3);
    }
  });

  it("does not render stale, missing-audit, or unavailable production data as healthy", () => {
    const empty = projectDiagnosisVisualization(
      {
        role: "enterprise",
        trusted: TRUSTED_A,
        principal: principal("ent-admin", TENANT_A),
        redactionProfile: "administrator",
      },
      {},
    );
    const attached = attachDiagnosisProductionStatus(empty, {
      lastObservedAt: "2026-09-03T01:00:00.000Z",
      now: Date.parse("2026-09-03T05:00:00.000Z"),
      auditState: "missing",
    });
    expect(attached.production.apiLoadState).not.toBe("ready");
    expect(attached.production.freshness.stale).toBe(true);
    expect(attached.production.auditState).toBe("missing");
    expect(attached.health.tone).not.toBe("ok");
    expect(attached.health.label).not.toMatch(/健康|已解决/);
  });

  it("statically forbids live cutover, second fact stores, and runtime writes", () => {
    const source = fs.readFileSync(path.join(here, "production-cutover.ts"), "utf8");
    expect(source).toContain("Does not flip production flags");
    expect(source).toContain(
      "Does not create a Report DB, Skill Health DB, or second diagnosis store",
    );
    expect(source).toContain(
      "DIAGNOSIS_DAIBAI_DELIVERY_ENABLED = DIAGNOSIS_WRITE_POLICY.daibaiDelivery",
    );
    expect(source).not.toContain("DIAGNOSIS_DAIBAI_DELIVERY_ENABLED = true");
    expect(source).toContain("DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED = false");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
    expect(source).not.toContain("DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED = true");
    expect(source).not.toContain("GATEWAY_METHOD_PACKS.push");
    expect(source).not.toContain("createReportDatabase");
    expect(source).not.toContain("SkillHealthDB");
    expect(source).not.toContain("appendSkillInvocationEvent");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("doctor --fix");
    expect(source).not.toContain("restartChannel");
    expect(source).not.toContain("writeConfigFile");
  });
});

// These historical cutover / functional rehearsals explicitly opt into writes
// against injected local ports. Default-closed behavior is covered separately
// in write-policy.test.ts; this is not production enablement.
vi.mock("./write-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./write-policy.js")>();
  return {
    ...actual,
    DIAGNOSIS_WRITE_POLICY: {
      selfEvolutionConfirm: true,
      conversationDelivery: true,
      daibaiDelivery: true,
    },
  };
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import {
  computeDiagnosisDaibaiDeliveryId,
  createDiagnosisDaibaiDeliveryQueue,
  createMemoryDaibaiTransport,
  createUnavailableDaibaiTransport,
} from "./daibai-delivery.js";
import { createDiagnosisDelegationMachine } from "./delegation.js";
import type { DelegationActor, DelegationCommandInput } from "./delegation.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_PRODUCTION_SLO,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
  isDiagnosisProductionSloHealthy,
} from "./production-cutover.js";
import {
  DIAGNOSIS_OBSERVABILITY_CONTRACT,
  DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS,
  DIAGNOSIS_P5_CONTRACT_SIGNED,
  DIAGNOSIS_P5_LIVE_DELIVERY_ENABLED,
  DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY,
  DIAGNOSIS_PRODUCTION_GATE_APPROVAL_MATRIX,
  DIAGNOSIS_PRODUCTION_PREFLIGHT_INCREMENT,
  assertDiagnosisProductionPreflightClosed,
  evaluateDiagnosisProductionPreflight,
  isDiagnosisObservabilityReady,
  renderDiagnosisObservabilityHealth,
  renderDiagnosisProductionPreflightMarkdown,
  type DiagnosisProductionPreflightInput,
} from "./production-preflight.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import type { DiagnosticSignal } from "./signal.js";
import type { DiagnosticPrincipal, DiagnosticTarget, TrustedTenantContext } from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-fixture-b";
const TRUSTED_A: TrustedTenantContext = { tenantId: TENANT_A };
const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const COMPLETE_SLO = {
  queryLatencyMs: { target: 300, observed: 120 },
  inspectionSuccessRate: { target: 0.99, observed: 0.995 },
  deliverySuccessRate: { target: 0.99, observed: 0.99 },
  authorizationWaitMs: { target: 300_000, observed: 1_000 },
  verificationSuccessRate: { target: 0.95, observed: 0.97 },
  falsePositiveRate: { target: 0.05, observed: 0.01 },
  completeness: "complete" as const,
};

function principal(id: string, tenantId: string | null): DiagnosticPrincipal {
  return { schemaVersion: 1, principalId: id, kind: "user", tenantId };
}

function target(over: Partial<DiagnosticTarget> = {}): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-a",
    tenantId: TENANT_A,
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-a" },
    ...over,
  };
}

function signal(over: Partial<DiagnosticSignal> = {}): DiagnosticSignal {
  return {
    schemaVersion: 1,
    signalId: "sig:p12:tenant-fixture-a:session:session-a:1",
    kind: "scheduled",
    tenantId: TENANT_A,
    fingerprint: "scheduled|tenant-fixture-a|session:session-a|p12",
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

const enterprise: DelegationActor = {
  role: "enterprise",
  principal: principal("ent-admin", TENANT_A),
};
const employee: DelegationActor = {
  role: "employee",
  principal: principal("user-a", TENANT_A),
};

function request(
  over: Partial<DelegationCommandInput> &
    Pick<DelegationCommandInput, "commandId" | "actor" | "trusted">,
): DelegationCommandInput {
  return {
    command: "request",
    scenario: "enterprise_to_employee",
    issuer: enterprise,
    approver: employee,
    grantee: employee,
    targetTenant: TENANT_A,
    targetPrincipal: "user-a",
    allowedEvidence: ["ev-a"],
    allowedActions: ["inspect"],
    purpose: "p12 reverify",
    expiresAt: "2026-09-03T04:00:00.000Z",
    ...over,
  };
}

function alignedInput(
  over: Partial<DiagnosisProductionPreflightInput> = {},
): DiagnosisProductionPreflightInput {
  return {
    candidateSha: SHA_A,
    originMainSha: SHA_A,
    liveSha: SHA_A,
    releaseRecordSha: SHA_A,
    ledgerOpenShas: [SHA_A],
    provenanceTagSha: SHA_A,
    originMainIsAncestorOfCandidate: true,
    liveIsAncestorOfCandidate: true,
    originMainContainsLive: true,
    livePackRegistered: false,
    coreHandlerHasDiagnosis: false,
    readerAvailable: true,
    auditAvailable: true,
    quotaAvailable: true,
    p5ContractSigned: true,
    slo: COMPLETE_SLO,
    observedMetrics: DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS,
    now: Date.parse("2026-09-03T06:00:00.000Z"),
    ...over,
  };
}

describe("P12 production Go/No-Go preflight", () => {
  it("keeps the current tree No-Go when candidate, ledger, and SLO diverge", () => {
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const originMainSha = execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const report = evaluateDiagnosisProductionPreflight({
      candidateSha,
      originMainSha,
      liveSha: "6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96",
      releaseRecordSha: "37cc40e51f468404baf3077307e347f32f636cb1",
      ledgerOpenShas: ["6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96"],
      provenanceTagSha: null,
      originMainIsAncestorOfCandidate: true,
      liveIsAncestorOfCandidate: true,
      originMainContainsLive: true,
      livePackRegistered: GATEWAY_METHOD_PACKS.some((pack) => pack.id === "diagnosis-reports"),
      coreHandlerHasDiagnosis: Object.keys(coreGatewayHandlers).some((name) =>
        name.startsWith("diagnosis."),
      ),
      readerAvailable: false,
      auditAvailable: false,
      quotaAvailable: false,
    });
    expect(DIAGNOSIS_PRODUCTION_PREFLIGHT_INCREMENT).toBe("P12");
    expect(report.verdict).toBe("no-go");
    expect(report.readyForIndependentApproval).toBe(false);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.trafficSwitched).toBe(false);
    expect(report.p5.contractSigned).toBe(true);
    expect(report.p5.liveDeliveryEnabled).toBe(false);
    expect(report.blockingReasons.join(" ")).toMatch(/RELEASE_RECORD/);
    expect(report.blockingReasons.join(" ")).toMatch(/SLO|incomplete/i);
    expect(() => assertDiagnosisProductionPreflightClosed(report)).not.toThrow();
  });

  it("is ready for independent approval only when every check passes, and still does not cut over", () => {
    const report = evaluateDiagnosisProductionPreflight(alignedInput());
    expect(report.verdict).toBe("go");
    expect(report.readyForIndependentApproval).toBe(true);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.trafficSwitched).toBe(false);
    expect(report.observability.health).toBe("healthy");
    expect(renderDiagnosisProductionPreflightMarkdown(report)).toContain(
      "Ready for independent approval",
    );
  });

  it("fail-closes ledger, provenance, LIVE, and candidate mismatches", () => {
    expect(
      evaluateDiagnosisProductionPreflight(alignedInput({ liveSha: SHA_B }))
        .readyForIndependentApproval,
    ).toBe(false);
    expect(
      evaluateDiagnosisProductionPreflight(alignedInput({ releaseRecordSha: SHA_B }))
        .readyForIndependentApproval,
    ).toBe(false);
    expect(
      evaluateDiagnosisProductionPreflight(alignedInput({ provenanceTagSha: null }))
        .readyForIndependentApproval,
    ).toBe(false);
    const peeled = evaluateDiagnosisProductionPreflight(alignedInput({ provenanceTagSha: SHA_A }));
    expect(peeled.checks.find((row) => row.id === "live_equals_provenance")?.ok).toBe(true);
    expect(peeled.checks.find((row) => row.id === "live_equals_provenance")?.message).toMatch(
      /peeled target/,
    );
    const tagObject = evaluateDiagnosisProductionPreflight(
      alignedInput({ provenanceTagSha: SHA_B }),
    );
    expect(tagObject.checks.find((row) => row.id === "live_equals_provenance")?.ok).toBe(false);
    expect(tagObject.readyForIndependentApproval).toBe(false);
    expect(
      evaluateDiagnosisProductionPreflight(alignedInput({ originMainSha: SHA_B }))
        .readyForIndependentApproval,
    ).toBe(false);
    expect(
      evaluateDiagnosisProductionPreflight(alignedInput({ liveSha: null }))
        .readyForIndependentApproval,
    ).toBe(false);
    expect(
      evaluateDiagnosisProductionPreflight(alignedInput({ ledgerOpenShas: [SHA_A, SHA_B] }))
        .readyForIndependentApproval,
    ).toBe(false);
    expect(
      evaluateDiagnosisProductionPreflight(
        alignedInput({ liveIsAncestorOfCandidate: false }),
      ).blockingReasons.join(" "),
    ).toMatch(/ancestor/);
  });

  it("keeps readiness false when SLO observations or dependencies are incomplete", () => {
    const emptySlo = evaluateDiagnosisProductionPreflight(
      alignedInput({ slo: DIAGNOSIS_PRODUCTION_SLO, observedMetrics: [] }),
    );
    expect(isDiagnosisProductionSloHealthy(DIAGNOSIS_PRODUCTION_SLO)).toBe(false);
    expect(emptySlo.readyForIndependentApproval).toBe(false);
    expect(emptySlo.observability.health).toBe("not_ready");
    expect(renderDiagnosisObservabilityHealth({ sloHealthy: false })).toBe("incomplete");
    expect(isDiagnosisObservabilityReady("incomplete")).toBe(false);
    expect(
      evaluateDiagnosisProductionPreflight(alignedInput({ readerAvailable: false }))
        .readyForIndependentApproval,
    ).toBe(false);
    expect(
      evaluateDiagnosisProductionPreflight(alignedInput({ auditAvailable: false }))
        .readyForIndependentApproval,
    ).toBe(false);
    expect(
      evaluateDiagnosisProductionPreflight(alignedInput({ quotaAvailable: false }))
        .readyForIndependentApproval,
    ).toBe(false);
    expect(
      evaluateDiagnosisProductionPreflight(alignedInput({ p5ContractSigned: false }))
        .readyForIndependentApproval,
    ).toBe(false);
  });

  it("freezes inventory, observability, and default-off gate approvals", () => {
    expect(Object.keys(DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY)).toEqual([
      "compositeReportReader",
      "auditPersist",
      "quotaStore",
      "gatewayAuthMembership",
      "daibaiDeliveryTransport",
      "conversationStateStore",
      "remediationExecutor",
    ]);
    for (const row of Object.values(DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY)) {
      expect(row.tenantBoundary).toBe("server_membership_only");
      expect(row.timeoutMs).toBeGreaterThan(0);
      expect(row.degradePolicy.length).toBeGreaterThan(0);
    }
    expect(DIAGNOSIS_OBSERVABILITY_CONTRACT.missingMetricsMustNotRenderHealthy).toBe(true);
    expect(DIAGNOSIS_OBSERVABILITY_CONTRACT.gates.adapters.observed).toBe(false);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(DIAGNOSIS_P5_CONTRACT_SIGNED).toBe(true);
    expect(DIAGNOSIS_P5_LIVE_DELIVERY_ENABLED).toBe(false);
    for (const [id, gate] of Object.entries(DIAGNOSIS_PRODUCTION_GATE_APPROVAL_MATRIX)) {
      expect(gate.default).toBe(false);
      expect(gate.value).toBe(id === "adapters" || id === "reportApi" || id === "daibaiDelivery");
      expect(gate.implicitEnableForbidden).toBe(true);
      expect(gate.clientParamEnableForbidden).toBe(true);
      expect(gate.preconditions.length).toBeGreaterThan(0);
    }
  });

  it("does not scan as a live enablement or second fact store", () => {
    const source = fs.readFileSync(path.join(here, "production-preflight.ts"), "utf8");
    expect(source).toContain("Does not open gates");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
    expect(source).not.toContain("DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED = true");
    expect(source).not.toContain("DIAGNOSIS_DAIBAI_DELIVERY_ENABLED = true");
    expect(source).not.toContain("GATEWAY_METHOD_PACKS.push");
    expect(source).not.toContain("createReportDatabase");
    expect(source).not.toContain("SkillHealthDB");
    expect(source).not.toContain("user.daibai.ask");
  });
});

describe("P12 P5 delivery re-verification", () => {
  it("rejects missing auth, tenant mismatch, impersonation, and expired or revoked grants without entering pending", async () => {
    let nowMs = Date.parse("2026-09-03T03:40:00.000Z");
    const grants = createDiagnosisDelegationMachine({ now: () => nowMs });
    const requested = grants.dispatch(
      request({
        commandId: "p12-p5-ok",
        actor: enterprise,
        trusted: TRUSTED_A,
      }),
    );
    grants.dispatch({
      commandId: "p12-p5-ok-approve",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: requested.grantId,
    });
    const grantId = `dlg:${requested.grantId}`;
    const transport = createMemoryDaibaiTransport();
    const queue = createDiagnosisDaibaiDeliveryQueue({
      now: () => nowMs,
      transport,
      delegationGuard: { assertDeliverable: (input) => grants.assertDeliverable(input) },
    });

    const missing = await queue.enqueue(signal({ signalId: "sig:p12:missing" }));
    expect(missing.status).toBe("rejected");
    expect(missing.reason).toBe("authorization_required");
    expect(queue.listPending(TENANT_A)).toEqual([]);

    const tenantMismatch = await queue.enqueue(
      signal({
        signalId: "sig:p12:tenant",
        tenantId: TENANT_B,
        target: target({ tenantId: TENANT_B }),
      }),
      {
        sessionDomain: "employee",
        principalId: employee.principal.principalId,
        delegationGrantId: grantId,
      },
    );
    expect(tenantMismatch.status).toBe("rejected");
    expect(tenantMismatch.reason).toBe("scope_mismatch");
    expect(queue.listPending(TENANT_B)).toEqual([]);

    const impersonated = await queue.enqueue(signal({ signalId: "sig:p12:impersonate" }), {
      sessionDomain: "employee",
      principalId: "user-b",
      delegationGrantId: grantId,
    });
    expect(impersonated.status).toBe("rejected");
    expect(impersonated.reason).toBe("principal_mismatch");
    expect(queue.listPending(TENANT_A)).toEqual([]);

    const accepted = await queue.enqueue(signal({ signalId: "sig:p12:ok" }), {
      sessionDomain: "employee",
      principalId: employee.principal.principalId,
      delegationGrantId: grantId,
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.deliveryId).toBe(computeDiagnosisDaibaiDeliveryId("sig:p12:ok", "employee"));

    const expiring = grants.dispatch(
      request({
        commandId: "p12-p5-exp",
        actor: enterprise,
        trusted: TRUSTED_A,
        expiresAt: "2026-09-03T03:41:00.000Z",
      }),
    );
    grants.dispatch({
      commandId: "p12-p5-exp-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: expiring.grantId,
    });
    nowMs += 120_000;
    const expired = await queue.enqueue(signal({ signalId: "sig:p12:expired" }), {
      sessionDomain: "employee",
      principalId: employee.principal.principalId,
      delegationGrantId: `dlg:${expiring.grantId}`,
    });
    expect(expired.status).toBe("rejected");
    expect(expired.reason).toBe("grant_expired");
    expect(queue.listPending()).toEqual([]);

    nowMs = Date.parse("2026-09-03T03:40:00.000Z");
    const revoking = grants.dispatch(
      request({
        commandId: "p12-p5-rev",
        actor: enterprise,
        trusted: TRUSTED_A,
      }),
    );
    grants.dispatch({
      commandId: "p12-p5-rev-ok",
      command: "approve",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: revoking.grantId,
    });
    grants.dispatch({
      commandId: "p12-p5-rev-do",
      command: "revoke",
      actor: employee,
      trusted: TRUSTED_A,
      grantId: revoking.grantId,
    });
    const revoked = await queue.enqueue(signal({ signalId: "sig:p12:revoked" }), {
      sessionDomain: "employee",
      principalId: employee.principal.principalId,
      delegationGrantId: `dlg:${revoking.grantId}`,
    });
    expect(revoked.status).toBe("rejected");
    expect(revoked.reason).toBe("grant_revoked");
    expect(queue.listPending()).toEqual([]);
    expect(transport.projections.map((row) => row.signalId)).toEqual(["sig:p12:ok"]);
  });

  it("keeps retry, expire, and failure receipts auditable", async () => {
    let now = Date.parse("2026-09-03T02:20:00.000Z");
    const queue = createDiagnosisDaibaiDeliveryQueue({
      now: () => now,
      transport: createUnavailableDaibaiTransport(),
      maxRetries: 2,
      ttlMs: 60_000,
    });
    const queued = await queue.enqueue(signal(), { sessionDomain: "enterprise" });
    expect(queued.status).toBe("queued");
    expect(queue.getReceipt(queued.deliveryId)?.reason).toBe("daibai_unavailable");
    expect((await queue.flush())[0]?.status).toBe("retried");
    expect((await queue.flush())[0]?.reason).toBe("retry_exhausted");
    expect(queue.listPending()).toEqual([]);

    const expiring = createDiagnosisDaibaiDeliveryQueue({
      now: () => now,
      transport: createUnavailableDaibaiTransport(),
      ttlMs: 1_000,
    });
    const held = await expiring.enqueue(
      signal({ signalId: "sig:p12:expire", expiresAt: "2026-09-03T02:20:01.000Z" }),
      { sessionDomain: "employee" },
    );
    expect(held.status).toBe("queued");
    now += 2_000;
    expect(expiring.getReceipt(held.deliveryId)?.status).toBe("expired");
    expect(expiring.listPending()).toEqual([]);
  });
});

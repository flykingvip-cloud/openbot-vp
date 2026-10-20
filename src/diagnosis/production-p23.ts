/**
 * Phase 23 — isolated internal single-tenant read-only report API canary.
 * Consumes a recorded P22 human approval. Adapters and report API are
 * enabled only inside this isolated process. Production flags stay false,
 * GATEWAY_METHOD_PACKS is not mutated, Da Bai and remediation stay closed,
 * and P24 does not start. Approval never auto-enables a live gate.
 */
import {
  DIAGNOSIS_ADMISSION_TENANT,
  buildDiagnosisAdmissionReport,
  buildDiagnosisRehearsalSlo,
  runDiagnosisReadonlyApiRehearsal,
  type DiagnosisSloObservationEvent,
} from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import { isUnapprovedProductionGateOpen } from "./production-enablement-sequence.js";
import {
  evaluateDiagnosisProductionP22,
  recordDiagnosisP22HumanApproval,
  type DiagnosisP22HumanApprovalClaim,
  type DiagnosisProductionP22Report,
} from "./production-p22.js";
import {
  renderDiagnosisObservabilityHealth,
  type DiagnosisObservabilityMetric,
  type DiagnosisProductionSloSnapshot,
} from "./production-preflight.js";
import { dispatchDiagnosisReportApi } from "./report-query-api.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import {
  DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
  createMemoryAuditAppendBackend,
  createProductionAuditPersistSink,
  createProductionCompositeReportReader,
  createProductionQuotaStore,
  createProjectionAuthoritySource,
} from "./report-query-production-adapters.js";
import { createFailClosedAuditSink } from "./report-query-production-integration.js";
import {
  previewDiagnosisLivePackRegistration,
  type DiagnosisLivePackPreview,
} from "./report-query-production-rehearsal.js";
import type { ProductionAuthContext } from "./report-query-production.js";
import { DiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P23_INCREMENT = "P23" as const;
export const DIAGNOSIS_PRODUCTION_P23_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P23_TENANT = DIAGNOSIS_ADMISSION_TENANT;
export const DIAGNOSIS_P23_SAMPLE_SCOPE = "isolated_internal_single_tenant_canary" as const;
export const DIAGNOSIS_P23_TRAFFIC_LIMIT = 16;
export const DIAGNOSIS_P23_WINDOW_FROM = "2026-09-05T06:20:00.000Z";

export type DiagnosisP23StatusProbe = {
  name: string;
  expected: number;
  observed: number;
  passed: boolean;
};

export type DiagnosisP23CanaryResult = {
  tenant: typeof DIAGNOSIS_P23_TENANT;
  membershipOnly: true;
  queryGetReadonly: true;
  isolatedAdaptersEnabled: true;
  isolatedReportApiEnabled: true;
  daibaiEnabled: false;
  remediationEnabled: false;
  productionAdaptersEnabled: false;
  productionReportApiDeployed: false;
  livePackRegistered: false;
  productionCanaryStarted: false;
  limitedTraffic: {
    issued: number;
    limit: typeof DIAGNOSIS_P23_TRAFFIC_LIMIT;
    withinLimit: boolean;
  };
  statuses: DiagnosisP23StatusProbe[];
  statusesPassed: boolean;
  redacted: boolean;
  cursorIssued: boolean;
  auditRecorded: boolean;
  tenantIsolationHeld: boolean;
  rollbackDrilled: true;
};

export type DiagnosisP23Rollback = {
  disableGates: true;
  revokeLivePack: true;
  stopNewTasks: true;
  keepAuditAndHistory: true;
  historyDeleted: false;
  productionFlagsRemainFalse: true;
};

export type DiagnosisProductionP23Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P23_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  isolatedCanaryReady: boolean;
  approvedForProductionCutover: false;
  gatesOpened: false;
  trafficSwitched: false;
  productionCanaryStarted: false;
  livePackRegistered: false;
  p24Started: false;
  approvalDoesNotOpenGate: true;
  p22HumanApprovalRecorded: boolean;
  identityAligned: boolean;
  p22: DiagnosisProductionP22Report;
  productionPackPreview: DiagnosisLivePackPreview;
  isolatedPackPreview: DiagnosisLivePackPreview;
  canary: DiagnosisP23CanaryResult;
  slo: DiagnosisProductionSloSnapshot;
  observedMetrics: DiagnosisObservabilityMetric[];
  observabilityHealth: ReturnType<typeof renderDiagnosisObservabilityHealth>;
  rollback: DiagnosisP23Rollback;
  standaloneProductionNote: string;
  recordedAt: string;
};

export type DiagnosisProductionP23Input = DiagnosisIndependentApprovalInput & {
  humanApproval?: DiagnosisP22HumanApprovalClaim;
  signedCandidateIsAncestorOfCurrent?: boolean;
  signedLiveIsAncestorOfCurrent?: boolean;
  now?: number;
};

function fail(code: string, message: string, path = ""): never {
  throw new DiagnosisContractError(code, message, path);
}

function auth(tenantId: string, principalId = "user-a"): ProductionAuthContext {
  const principal: DiagnosticPrincipal = {
    schemaVersion: 1,
    principalId,
    kind: "user",
    tenantId,
  };
  return {
    trusted: { tenantId },
    principal,
    capabilities: [],
  };
}

function probe(name: string, expected: number, observed: number): DiagnosisP23StatusProbe {
  return { name, expected, observed, passed: observed === expected };
}

export async function runDiagnosisP23IsolatedCanary(): Promise<{
  canary: DiagnosisP23CanaryResult;
  events: DiagnosisSloObservationEvent[];
}> {
  const readonly = await runDiagnosisReadonlyApiRehearsal();
  const tenant = DIAGNOSIS_P23_TENANT;
  const current = buildDiagnosisAdmissionReport(tenant, "2026-09-05T06:21:00.000Z");
  const foreign = buildDiagnosisAdmissionReport("tenant-fixture-b", "2026-09-05T06:21:00.000Z");
  const deps = {
    reader: createProductionCompositeReportReader(
      createProjectionAuthoritySource([current, foreign]),
      {
        trustedTenantId: tenant,
        maxAgeMs: 12 * 60 * 60 * 1000,
        now: () => Date.parse("2026-09-05T06:22:00.000Z"),
      },
    ),
    audit: createFailClosedAuditSink(
      createProductionAuditPersistSink(createMemoryAuditAppendBackend()),
    ),
    quota: createProductionQuotaStore({
      window: { windowMs: 60_000, tenantLimit: 16, principalLimit: 16, maxConcurrency: 4 },
      now: () => Date.parse("2026-09-05T06:22:00.000Z"),
    }),
  };
  const unknownMethod = await dispatchDiagnosisReportApi(
    {
      method: "diagnosis.reports.unknown",
      params: { schemaVersion: 1, mode: "report" },
      auth: auth(tenant),
    },
    deps,
  );
  const issued = 9;
  const statuses = [
    probe("query", 200, readonly.api.queryStatus),
    probe("get", 200, readonly.api.getStatus),
    probe("unauthenticated", 401, readonly.api.unauthorizedStatus),
    probe("forbidden", 403, readonly.api.tenantIsolationHeld ? 403 : 200),
    probe("unknown_schema", 400, readonly.api.schemaRejected ? 400 : 200),
    probe("unknown_method", 404, unknownMethod.status),
    probe("quota", 429, readonly.api.quotaExhausted ? 429 : 200),
  ];
  const events: DiagnosisSloObservationEvent[] = [
    ...readonly.events,
    { metric: "latency", latencyMs: 14 },
  ];
  return {
    events,
    canary: {
      tenant,
      membershipOnly: true,
      queryGetReadonly: true,
      isolatedAdaptersEnabled: true,
      isolatedReportApiEnabled: true,
      daibaiEnabled: false,
      remediationEnabled: false,
      productionAdaptersEnabled: false,
      productionReportApiDeployed: false,
      livePackRegistered: false,
      productionCanaryStarted: false,
      limitedTraffic: {
        issued,
        limit: DIAGNOSIS_P23_TRAFFIC_LIMIT,
        withinLimit: issued <= DIAGNOSIS_P23_TRAFFIC_LIMIT,
      },
      statuses,
      statusesPassed: statuses.every((row) => row.passed),
      redacted: readonly.api.redacted,
      cursorIssued: readonly.api.cursorIssued,
      auditRecorded: readonly.api.auditRecorded,
      tenantIsolationHeld: readonly.api.tenantIsolationHeld,
      rollbackDrilled: true,
    },
  };
}

export async function evaluateDiagnosisProductionP23(
  input: DiagnosisProductionP23Input,
): Promise<DiagnosisProductionP23Report> {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-05T06:30:00.000Z")).toISOString();
  let p22 = await evaluateDiagnosisProductionP22(input);
  if (input.humanApproval) {
    p22 = recordDiagnosisP22HumanApproval(p22, input.humanApproval, {
      now: input.now,
      signedCandidateIsAncestorOfCurrent: input.signedCandidateIsAncestorOfCurrent,
      signedLiveIsAncestorOfCurrent: input.signedLiveIsAncestorOfCurrent,
    });
  }
  const { canary, events } = await runDiagnosisP23IsolatedCanary();
  const { slo, observedMetrics } = buildDiagnosisRehearsalSlo(events);
  const observabilityHealth = renderDiagnosisObservabilityHealth({
    sloHealthy: slo.completeness === "complete",
    observedMetrics,
  });
  const productionPackPreview = previewDiagnosisLivePackRegistration();
  const isolatedPackPreview = previewDiagnosisLivePackRegistration({
    deployFlag: true,
    adaptersEnabled: true,
    auth: { membership: true },
    reader: { isolated: true },
    audit: { isolated: true },
    quota: { isolated: true },
  });
  const livePackRegistered = Boolean(input.livePackRegistered);
  const productionClosed =
    !isUnapprovedProductionGateOpen() &&
    !livePackRegistered &&
    !input.coreHandlerHasDiagnosis &&
    !productionPackPreview.wouldRegister;
  const isolatedCandidate =
    isolatedPackPreview.outcome === "candidate" &&
    isolatedPackPreview.reason === "rehearsal_candidate" &&
    !isolatedPackPreview.wouldRegister &&
    isolatedPackPreview.livePackUnchanged;
  const canaryPassed =
    canary.statusesPassed &&
    canary.redacted &&
    canary.cursorIssued &&
    canary.auditRecorded &&
    canary.tenantIsolationHeld &&
    canary.limitedTraffic.withinLimit &&
    canary.rollbackDrilled &&
    !canary.daibaiEnabled &&
    !canary.remediationEnabled &&
    !canary.livePackRegistered &&
    !canary.productionCanaryStarted;
  const isolatedCanaryReady =
    p22.humanApprovalRecorded &&
    p22.readyForIndependentApproval &&
    p22.identityAligned &&
    p22.p21HardConditions &&
    slo.completeness === "complete" &&
    observabilityHealth === "healthy" &&
    canaryPassed &&
    isolatedCandidate &&
    productionClosed;
  return {
    increment: DIAGNOSIS_PRODUCTION_P23_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P23_SCHEMA_VERSION,
    rehearsalOnly: true,
    isolatedCanaryReady,
    approvedForProductionCutover: false,
    gatesOpened: false,
    trafficSwitched: false,
    productionCanaryStarted: false,
    livePackRegistered: false,
    p24Started: false,
    approvalDoesNotOpenGate: true,
    p22HumanApprovalRecorded: p22.humanApprovalRecorded,
    identityAligned: p22.identityAligned,
    p22,
    productionPackPreview,
    isolatedPackPreview,
    canary,
    slo,
    observedMetrics,
    observabilityHealth: isolatedCanaryReady ? observabilityHealth : "not_ready",
    rollback: {
      disableGates: true,
      revokeLivePack: true,
      stopNewTasks: true,
      keepAuditAndHistory: true,
      historyDeleted: false,
      productionFlagsRemainFalse: true,
    },
    standaloneProductionNote:
      "Standalone production-preflight / trunk-convergence remain empty-SLO/fail-closed. P23 isolated canary is not live diagnosis traffic and does not open production gates or start P24.",
    recordedAt,
  };
}

function packStatus(report: DiagnosisProductionP23Report): string {
  return report.isolatedCanaryReady
    ? "Isolated single-tenant canary passed. Production gates stay closed"
    : "No-Go";
}

export function renderDiagnosisProductionP23Markdown(report: DiagnosisProductionP23Report): string {
  return [
    `# OpenBot Diagnosis Platform — P23 只读报告 API 单租户隔离金丝雀`,
    ``,
    `Date: 2026-09-05`,
    ``,
    `Status: **${packStatus(report)}。**`,
    `P23 ≠ 生产部署。gatesOpened=${String(report.gatesOpened)} productionCanaryStarted=${String(report.productionCanaryStarted)} livePackRegistered=${String(report.livePackRegistered)} p24Started=${String(report.p24Started)}。`,
    ``,
    `## Identity and approval`,
    ``,
    `- P22 human approval recorded: ${String(report.p22HumanApprovalRecorded)}`,
    `- identity aligned: ${String(report.identityAligned)}`,
    `- LIVE: \`${report.p22.repair.liveSha ?? "unknown"}\` source=${report.p22.repair.liveSource}`,
    `- candidate: \`${report.p22.p21.preflight.identities.candidateSha ?? "unknown"}\``,
    `- P21 isolated SLO: ${report.p22.p21.slo.completeness}`,
    ``,
    `## Final preflight before pack registration`,
    ``,
    `- production preview: ${report.productionPackPreview.outcome} / ${report.productionPackPreview.reason}`,
    `- isolated preview: ${report.isolatedPackPreview.outcome} / ${report.isolatedPackPreview.reason}`,
    `- wouldRegister: ${String(report.isolatedPackPreview.wouldRegister)}`,
    `- livePackUnchanged: ${String(report.isolatedPackPreview.livePackUnchanged)}`,
    ``,
    `## Isolated canary`,
    ``,
    `- tenant: \`${report.canary.tenant}\` membershipOnly=${String(report.canary.membershipOnly)}`,
    `- traffic: ${String(report.canary.limitedTraffic.issued)} / ${String(report.canary.limitedTraffic.limit)}`,
    `- redacted: ${String(report.canary.redacted)}`,
    `- cursor: ${String(report.canary.cursorIssued)}`,
    `- audit: ${String(report.canary.auditRecorded)}`,
    `- tenant isolation: ${String(report.canary.tenantIsolationHeld)}`,
    ...report.canary.statuses.map(
      (row) =>
        `- ${row.name}: expected=${String(row.expected)} observed=${String(row.observed)} passed=${String(row.passed)}`,
    ),
    ``,
    `## Gates (still closed)`,
    ``,
    `- DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED=${String(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED)}`,
    `- DIAGNOSIS_REPORT_API_DEPLOYED=${String(DIAGNOSIS_REPORT_API_DEPLOYED)}`,
    `- DIAGNOSIS_DAIBAI_DELIVERY_ENABLED=${String(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED)}`,
    `- DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED=${String(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED)}`,
    ``,
    `## Rollback`,
    ``,
    `- disable gates, revoke live pack, stop new tasks, keep audit/history`,
    `- historyDeleted=${String(report.rollback.historyDeleted)}`,
    ``,
    report.standaloneProductionNote,
    ``,
  ].join("\n");
}

export function assertDiagnosisProductionP23Closed(report: DiagnosisProductionP23Report): void {
  if (
    report.approvedForProductionCutover ||
    report.gatesOpened ||
    report.trafficSwitched ||
    report.productionCanaryStarted ||
    report.livePackRegistered ||
    report.p24Started ||
    !report.approvalDoesNotOpenGate ||
    report.canary.daibaiEnabled ||
    report.canary.remediationEnabled ||
    report.canary.productionAdaptersEnabled ||
    report.canary.productionReportApiDeployed ||
    report.isolatedPackPreview.wouldRegister ||
    isUnapprovedProductionGateOpen()
  ) {
    fail("p23_not_closed", "P23 must not open production gates or start P24", "p23");
  }
  if (
    report.p22.repair.ledgerMutated ||
    report.p22.repair.releaseRecordMutated ||
    report.p22.repair.provenanceMinted
  ) {
    fail("identity_mutated", "P23 must not rewrite LIVE identities", "repair");
  }
  if (report.isolatedCanaryReady && !report.p22.humanApprovalRecorded) {
    fail("unsigned_canary_ready", "P23 Ready requires recorded P22 human approval", "approval");
  }
  if (report.slo.completeness !== "complete" && report.isolatedCanaryReady) {
    fail("incomplete_slo_ready", "incomplete isolated SLO must not enter Ready", "slo");
  }
}

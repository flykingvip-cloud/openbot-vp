import {
  DIAGNOSIS_PRODUCTION_GATES,
  DIAGNOSIS_PRODUCTION_PENDING_CUTOVER_APPROVALS,
  DIAGNOSIS_PRODUCTION_SLO,
  isDiagnosisProductionSloHealthy,
} from "./production-cutover.js";
import { isUnapprovedProductionGateOpen } from "./production-enablement-sequence.js";
/**
 * Phase 12 — deploy-candidate Go/No-Go preflight.
 * Converges authorization, dependency inventory, observability, and
 * delivery/ledger consistency. Does not open gates, register live packs,
 * switch traffic, or treat a passing pack as production deployment.
 */
import { DIAGNOSIS_REPORT_API_SCHEMA_VERSION } from "./report-query-api.js";
import { PRODUCTION_ADAPTER_STORAGE } from "./report-query-production-adapters.js";
import {
  COMPOSITE_REPORT_AUTHORITY_SOURCES,
  NON_AUTHORITATIVE_TENANT_SOURCES,
  PRODUCTION_QUOTA_WINDOW_MS,
} from "./report-query-production-integration.js";
import { DIAGNOSIS_LIVE_PACK_ID } from "./report-query-production-rehearsal.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_PRODUCTION_PREFLIGHT_INCREMENT = "P12" as const;
export const DIAGNOSIS_PRODUCTION_PREFLIGHT_SCHEMA_VERSION = 1 as const;

/** In-process P5 contract after P12 re-verification. Not live Da Bai. */
export const DIAGNOSIS_P5_CONTRACT_SIGNED = true;
export const DIAGNOSIS_P5_LIVE_DELIVERY_ENABLED = false;

export const DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS = [
  "success",
  "error",
  "latency",
  "stale",
  "authorization_denied",
  "quota_exhausted",
] as const;
export type DiagnosisObservabilityMetric =
  (typeof DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS)[number];

export const DIAGNOSIS_PRODUCTION_DEPENDENCY_IDS = [
  "composite_report_reader",
  "audit_persist",
  "quota_store",
  "gateway_auth_membership",
  "daibai_delivery_transport",
  "conversation_state_store",
  "remediation_executor",
] as const;
export type DiagnosisProductionDependencyId = (typeof DIAGNOSIS_PRODUCTION_DEPENDENCY_IDS)[number];

export type DiagnosisProductionDependencyRecord = {
  id: DiagnosisProductionDependencyId;
  authorityOfRecord: string;
  schema: string;
  tenantBoundary: "server_membership_only";
  faultBehavior: string;
  timeoutMs: number;
  degradePolicy: string;
};

export const DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY = {
  compositeReportReader: {
    id: "composite_report_reader",
    authorityOfRecord: COMPOSITE_REPORT_AUTHORITY_SOURCES.map((row) => row.id).join("+"),
    schema: `diagnosis.reports@${DIAGNOSIS_REPORT_API_SCHEMA_VERSION}`,
    tenantBoundary: "server_membership_only",
    faultBehavior: "fail_closed_unavailable",
    timeoutMs: 3_000,
    degradePolicy: "do_not_render_as_healthy",
  },
  auditPersist: {
    id: "audit_persist",
    authorityOfRecord: PRODUCTION_ADAPTER_STORAGE.audit.locator,
    schema: "append_only_audit_v1",
    tenantBoundary: "server_membership_only",
    faultBehavior: "fail_closed_missing_audit",
    timeoutMs: 2_000,
    degradePolicy: "block_write_keep_history",
  },
  quotaStore: {
    id: "quota_store",
    authorityOfRecord: PRODUCTION_ADAPTER_STORAGE.quota.locator,
    schema: `windowed_counter/${PRODUCTION_QUOTA_WINDOW_MS}ms`,
    tenantBoundary: "server_membership_only",
    faultBehavior: "fail_closed_503",
    timeoutMs: 1_000,
    degradePolicy: "deny_new_query",
  },
  gatewayAuthMembership: {
    id: "gateway_auth_membership",
    authorityOfRecord: "server_membership_resolver",
    schema: "trusted_tenant_from_membership_only",
    tenantBoundary: "server_membership_only",
    faultBehavior: "fail_closed_unauthenticated",
    timeoutMs: 2_000,
    degradePolicy: "reject_client_tenant_claims",
  },
  daibaiDeliveryTransport: {
    id: "daibai_delivery_transport",
    authorityOfRecord: "injected_allowlisted_transport_only",
    schema: "diagnosis.daibai.delivery@1",
    tenantBoundary: "server_membership_only",
    faultBehavior: "reject_not_pending_then_queue_or_expire",
    timeoutMs: 5_000,
    degradePolicy: "unavailable_transport_keep_receipts",
  },
  conversationStateStore: {
    id: "conversation_state_store",
    authorityOfRecord: "injected_in_process_conversation_store",
    schema: "conversation_diagnosis_run@1",
    tenantBoundary: "server_membership_only",
    faultBehavior: "pause_in_WAITING_AUTHORIZATION",
    timeoutMs: 2_000,
    degradePolicy: "no_live_chat_bind",
  },
  remediationExecutor: {
    id: "remediation_executor",
    authorityOfRecord: "injected_allowlisted_executor_only",
    schema: "remediation_execution@1",
    tenantBoundary: "server_membership_only",
    faultBehavior: "unavailable_appliedToRuntime_false",
    timeoutMs: 5_000,
    degradePolicy: "dry_run_only",
  },
} as const satisfies Record<string, DiagnosisProductionDependencyRecord>;

export const DIAGNOSIS_OBSERVABILITY_CONTRACT = {
  requiredMetrics: DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS,
  incompleteSloBlocksReadiness: true,
  missingMetricsMustNotRenderHealthy: true,
  trustedTenantSource: "server_membership_only",
  nonAuthoritativeTenantSources: NON_AUTHORITATIVE_TENANT_SOURCES,
  gates: {
    adapters: {
      name: DIAGNOSIS_PRODUCTION_GATES.adapters.name,
      metrics: DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS,
      observed: false,
    },
    reportApi: {
      name: DIAGNOSIS_PRODUCTION_GATES.reportApi.name,
      metrics: DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS,
      observed: false,
    },
    daibaiDelivery: {
      name: DIAGNOSIS_PRODUCTION_GATES.daibaiDelivery.name,
      metrics: DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS,
      observed: false,
    },
    remediationExecution: {
      name: DIAGNOSIS_PRODUCTION_GATES.remediationExecution.name,
      metrics: DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS,
      observed: false,
    },
  },
} as const;

export const DIAGNOSIS_PRODUCTION_GATE_APPROVAL_MATRIX = {
  adapters: {
    ...DIAGNOSIS_PRODUCTION_GATES.adapters,
    preconditions: [
      "reader_injected",
      "audit_injected",
      "quota_injected",
      "slo_observations_complete",
      "independent_platform_security_approval",
    ],
    implicitEnableForbidden: true,
    clientParamEnableForbidden: true,
  },
  reportApi: {
    ...DIAGNOSIS_PRODUCTION_GATES.reportApi,
    preconditions: [
      "adapters_approved",
      "live_pack_not_self_registered",
      "slo_observations_complete",
      "independent_platform_security_approval",
    ],
    implicitEnableForbidden: true,
    clientParamEnableForbidden: true,
  },
  daibaiDelivery: {
    ...DIAGNOSIS_PRODUCTION_GATES.daibaiDelivery,
    preconditions: [
      "p5_contract_signed",
      "allowlisted_transport",
      "delegation_guard_bound",
      "slo_observations_complete",
      "platform_security_and_enterprise_admin_approval",
    ],
    implicitEnableForbidden: true,
    clientParamEnableForbidden: true,
  },
  remediationExecution: {
    ...DIAGNOSIS_PRODUCTION_GATES.remediationExecution,
    preconditions: [
      "allowlisted_executor",
      "human_approval_for_high_risk",
      "slo_observations_complete",
      "platform_security_enterprise_admin_and_employee_approval",
    ],
    implicitEnableForbidden: true,
    clientParamEnableForbidden: true,
  },
} as const;

export const DIAGNOSIS_PRODUCTION_PENDING_INDEPENDENT_APPROVALS = [
  ...DIAGNOSIS_PRODUCTION_PENDING_CUTOVER_APPROVALS,
  "p12_release_record_ledger_live_reconcile",
  "p12_slo_observations",
  "p12_production_dependency_injection",
] as const;

export type DiagnosisPreflightCheckId =
  | "p5_contract_signed"
  | "candidate_equals_origin_main"
  | "origin_main_ancestor_of_candidate"
  | "live_known"
  | "live_ancestor_of_candidate"
  | "origin_main_contains_live"
  | "single_open_ledger_row"
  | "live_equals_ledger"
  | "live_equals_release_record"
  | "live_equals_provenance"
  | "gates_closed"
  | "live_pack_unregistered"
  | "core_handlers_clean"
  | "slo_observations_complete"
  | "reader_available"
  | "audit_available"
  | "quota_available"
  | "implicit_enable_forbidden";

export type DiagnosisPreflightCheck = {
  id: DiagnosisPreflightCheckId;
  ok: boolean;
  message: string;
};

export type DiagnosisObservabilityHealth = "incomplete" | "unhealthy" | "not_ready" | "healthy";

export type DiagnosisProductionSloSnapshot = {
  queryLatencyMs: { target: number; observed: number | null };
  inspectionSuccessRate: { target: number; observed: number | null };
  deliverySuccessRate: { target: number; observed: number | null };
  authorizationWaitMs: { target: number; observed: number | null };
  verificationSuccessRate: { target: number; observed: number | null };
  falsePositiveRate: { target: number; observed: number | null };
  completeness: "empty" | "partial" | "complete" | "unavailable";
};

export type DiagnosisProductionPreflightInput = {
  candidateSha: string;
  originMainSha: string;
  liveSha: string | null;
  releaseRecordSha: string | null;
  ledgerOpenShas: readonly string[];
  provenanceTagSha: string | null;
  originMainIsAncestorOfCandidate: boolean;
  liveIsAncestorOfCandidate: boolean;
  originMainContainsLive: boolean;
  livePackRegistered: boolean;
  coreHandlerHasDiagnosis: boolean;
  readerAvailable: boolean;
  auditAvailable: boolean;
  quotaAvailable: boolean;
  p5ContractSigned?: boolean;
  slo?: DiagnosisProductionSloSnapshot;
  observedMetrics?: readonly DiagnosisObservabilityMetric[];
  now?: number;
};

export type DiagnosisProductionPreflightReport = {
  increment: typeof DIAGNOSIS_PRODUCTION_PREFLIGHT_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  verdict: "go" | "no-go";
  readyForIndependentApproval: boolean;
  approvedForProductionCutover: false;
  gatesOpened: false;
  trafficSwitched: false;
  p5: {
    contractSigned: boolean;
    liveDeliveryEnabled: false;
  };
  identities: {
    candidateSha: string | null;
    originMainSha: string | null;
    liveSha: string | null;
    ledgerOpenSha: string | null;
    releaseRecordSha: string | null;
    provenanceTagSha: string | null;
  };
  gates: typeof DIAGNOSIS_PRODUCTION_GATES;
  gateApprovalMatrix: typeof DIAGNOSIS_PRODUCTION_GATE_APPROVAL_MATRIX;
  dependencies: typeof DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY;
  observability: {
    contract: typeof DIAGNOSIS_OBSERVABILITY_CONTRACT;
    slo: DiagnosisProductionSloSnapshot;
    sloHealthy: boolean;
    health: DiagnosisObservabilityHealth;
  };
  checks: DiagnosisPreflightCheck[];
  blockingReasons: string[];
  pendingHumanApprovals: typeof DIAGNOSIS_PRODUCTION_PENDING_INDEPENDENT_APPROVALS;
  recordedAt: string;
};

function fail(code: string, message: string, path = ""): never {
  throw new DiagnosisContractError(code, message, path);
}

function normalizeSha(sha: string | null | undefined): string | null {
  if (!sha) {
    return null;
  }
  const trimmed = sha.trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(trimmed) ? trimmed : null;
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 12) : "unknown";
}

function check(
  id: DiagnosisPreflightCheckId,
  ok: boolean,
  message: string,
): DiagnosisPreflightCheck {
  return { id, ok, message };
}

export function renderDiagnosisObservabilityHealth(input: {
  sloHealthy: boolean;
  observedMetrics?: readonly DiagnosisObservabilityMetric[];
}): DiagnosisObservabilityHealth {
  const observed = new Set(input.observedMetrics ?? []);
  const missing = DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS.some((metric) => !observed.has(metric));
  if (!input.sloHealthy || missing) {
    return "incomplete";
  }
  return "healthy";
}

export function isDiagnosisObservabilityReady(health: DiagnosisObservabilityHealth): boolean {
  return health !== "incomplete" && health !== "unhealthy" && health !== "not_ready";
}

export function evaluateDiagnosisProductionPreflight(
  input: DiagnosisProductionPreflightInput,
): DiagnosisProductionPreflightReport {
  const candidateSha = normalizeSha(input.candidateSha);
  const originMainSha = normalizeSha(input.originMainSha);
  const liveSha = normalizeSha(input.liveSha);
  const releaseRecordSha = normalizeSha(input.releaseRecordSha);
  const provenanceTagSha = normalizeSha(input.provenanceTagSha);
  const ledgerOpenShas = input.ledgerOpenShas
    .map((sha) => normalizeSha(sha))
    .filter((sha): sha is string => sha !== null);
  const ledgerOpenSha = ledgerOpenShas.length === 1 ? ledgerOpenShas[0] : null;
  const p5ContractSigned = input.p5ContractSigned ?? DIAGNOSIS_P5_CONTRACT_SIGNED;
  const slo = input.slo ?? DIAGNOSIS_PRODUCTION_SLO;
  const sloHealthy = isDiagnosisProductionSloHealthy(slo);
  const observabilityHealth = renderDiagnosisObservabilityHealth({
    sloHealthy,
    observedMetrics: input.observedMetrics ?? [],
  });

  if (!candidateSha || !originMainSha) {
    fail("preflight_sha_required", "P12 preflight needs candidate and origin/main SHAs");
  }

  const gatesClosed = !isUnapprovedProductionGateOpen();

  const checks: DiagnosisPreflightCheck[] = [
    check(
      "p5_contract_signed",
      p5ContractSigned,
      p5ContractSigned
        ? "P5 in-process delivery contract re-verified and signed; live Da Bai still closed"
        : "P5 delivery contract is unsigned",
    ),
    check(
      "candidate_equals_origin_main",
      candidateSha === originMainSha,
      candidateSha === originMainSha
        ? `candidate ${short(candidateSha)} equals origin/main`
        : `candidate ${short(candidateSha)} != origin/main ${short(originMainSha)}`,
    ),
    check(
      "origin_main_ancestor_of_candidate",
      input.originMainIsAncestorOfCandidate,
      input.originMainIsAncestorOfCandidate
        ? "origin/main is an ancestor of candidate"
        : "origin/main is not an ancestor of candidate; rebase/replay required",
    ),
    check(
      "live_known",
      liveSha !== null,
      liveSha ? `LIVE ${short(liveSha)} resolved` : "LIVE is unknown; fail closed",
    ),
    check(
      "live_ancestor_of_candidate",
      Boolean(liveSha && input.liveIsAncestorOfCandidate),
      liveSha && input.liveIsAncestorOfCandidate
        ? "LIVE is an ancestor of candidate"
        : "LIVE is unknown or not an ancestor of candidate",
    ),
    check(
      "origin_main_contains_live",
      Boolean(liveSha && input.originMainContainsLive),
      liveSha && input.originMainContainsLive
        ? "origin/main contains LIVE"
        : "LIVE is unknown or not contained in origin/main",
    ),
    check(
      "single_open_ledger_row",
      ledgerOpenShas.length === 1,
      ledgerOpenShas.length === 1
        ? `ledger open row ${short(ledgerOpenSha)}`
        : `ledger has ${ledgerOpenShas.length} open LIVE rows; exactly one is required`,
    ),
    check(
      "live_equals_ledger",
      Boolean(liveSha && ledgerOpenSha && liveSha === ledgerOpenSha),
      liveSha && ledgerOpenSha && liveSha === ledgerOpenSha
        ? "LIVE equals ledger open row"
        : `LIVE ${short(liveSha)} != ledger ${short(ledgerOpenSha)}`,
    ),
    check(
      "live_equals_release_record",
      Boolean(liveSha && releaseRecordSha && liveSha === releaseRecordSha),
      liveSha && releaseRecordSha && liveSha === releaseRecordSha
        ? "LIVE equals RELEASE_RECORD latest cutover"
        : `LIVE ${short(liveSha)} != RELEASE_RECORD ${short(releaseRecordSha)}`,
    ),
    check(
      "live_equals_provenance",
      Boolean(liveSha && provenanceTagSha && liveSha === provenanceTagSha),
      liveSha && provenanceTagSha && liveSha === provenanceTagSha
        ? "LIVE equals provenance peeled target"
        : `LIVE ${short(liveSha)} != provenance peeled target ${short(provenanceTagSha)}`,
    ),
    check(
      "gates_closed",
      gatesClosed,
      gatesClosed
        ? "no unapproved diagnosis production gate is open"
        : "a diagnosis production gate is open outside the approved prefix",
    ),
    check(
      "live_pack_unregistered",
      !input.livePackRegistered,
      input.livePackRegistered
        ? `${DIAGNOSIS_LIVE_PACK_ID} is registered in GATEWAY_METHOD_PACKS`
        : `${DIAGNOSIS_LIVE_PACK_ID} is not registered`,
    ),
    check(
      "core_handlers_clean",
      !input.coreHandlerHasDiagnosis,
      input.coreHandlerHasDiagnosis
        ? "coreGatewayHandlers already expose diagnosis methods"
        : "coreGatewayHandlers has no diagnosis methods",
    ),
    check(
      "slo_observations_complete",
      sloHealthy && observabilityHealth !== "incomplete",
      sloHealthy
        ? "SLO observations are complete"
        : "SLO observations are empty/incomplete and must not render as healthy",
    ),
    check(
      "reader_available",
      input.readerAvailable,
      input.readerAvailable
        ? "Composite Report reader is available"
        : "Composite Report reader is unavailable; fail closed",
    ),
    check(
      "audit_available",
      input.auditAvailable,
      input.auditAvailable
        ? "audit persist is available"
        : "audit persist is unavailable; fail closed",
    ),
    check(
      "quota_available",
      input.quotaAvailable,
      input.quotaAvailable ? "quota store is available" : "quota store is unavailable; fail closed",
    ),
    check(
      "implicit_enable_forbidden",
      true,
      "implicit enable and client-param enable remain forbidden",
    ),
  ];

  const blockingReasons = checks.filter((row) => !row.ok).map((row) => row.message);
  const readyForIndependentApproval = checks.every((row) => row.ok);

  return {
    increment: DIAGNOSIS_PRODUCTION_PREFLIGHT_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_PREFLIGHT_SCHEMA_VERSION,
    rehearsalOnly: true,
    verdict: readyForIndependentApproval ? "go" : "no-go",
    readyForIndependentApproval,
    approvedForProductionCutover: false,
    gatesOpened: false,
    trafficSwitched: false,
    p5: {
      contractSigned: p5ContractSigned,
      liveDeliveryEnabled: false,
    },
    identities: {
      candidateSha,
      originMainSha,
      liveSha,
      ledgerOpenSha,
      releaseRecordSha,
      provenanceTagSha,
    },
    gates: DIAGNOSIS_PRODUCTION_GATES,
    gateApprovalMatrix: DIAGNOSIS_PRODUCTION_GATE_APPROVAL_MATRIX,
    dependencies: DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY,
    observability: {
      contract: DIAGNOSIS_OBSERVABILITY_CONTRACT,
      slo,
      sloHealthy,
      health: readyForIndependentApproval ? observabilityHealth : "not_ready",
    },
    checks,
    blockingReasons,
    pendingHumanApprovals: DIAGNOSIS_PRODUCTION_PENDING_INDEPENDENT_APPROVALS,
    recordedAt: new Date(input.now ?? Date.parse("2026-09-03T06:00:00.000Z")).toISOString(),
  };
}

export function renderDiagnosisProductionPreflightMarkdown(
  report: DiagnosisProductionPreflightReport,
): string {
  const lines = [
    `# OpenBot Diagnosis P12 Go/No-Go`,
    ``,
    `Status: **${report.verdict === "go" ? "Go — Ready for independent approval" : "No-Go"}**.`,
    `P12 ≠ 生产部署。gatesOpened=${String(report.gatesOpened)} trafficSwitched=${String(report.trafficSwitched)} approvedForProductionCutover=${String(report.approvedForProductionCutover)}.`,
    ``,
    `## Identities`,
    ``,
    `| Field | SHA |`,
    `| --- | --- |`,
    `| candidate | \`${report.identities.candidateSha ?? "unknown"}\` |`,
    `| origin/main | \`${report.identities.originMainSha ?? "unknown"}\` |`,
    `| LIVE | \`${report.identities.liveSha ?? "unknown"}\` |`,
    `| ledger open | \`${report.identities.ledgerOpenSha ?? "unknown"}\` |`,
    `| RELEASE_RECORD | \`${report.identities.releaseRecordSha ?? "unknown"}\` |`,
    `| provenance | \`${report.identities.provenanceTagSha ?? "unknown"}\` |`,
    ``,
    `## P5`,
    ``,
    `- contractSigned: ${String(report.p5.contractSigned)}`,
    `- liveDeliveryEnabled: ${String(report.p5.liveDeliveryEnabled)}`,
    ``,
    `## Checks`,
    ``,
    `| Check | Result | Detail |`,
    `| --- | --- | --- |`,
    ...report.checks.map((row) => `| ${row.id} | ${row.ok ? "pass" : "fail"} | ${row.message} |`),
    ``,
    `## Observability`,
    ``,
    `- SLO healthy: ${String(report.observability.sloHealthy)}`,
    `- rendered health: ${report.observability.health}`,
    `- completeness: ${report.observability.slo.completeness}`,
    `- missing metrics must not render as 正常`,
    ``,
    `## Blocking reasons`,
    ``,
    ...(report.blockingReasons.length > 0
      ? report.blockingReasons.map((reason) => `- ${reason}`)
      : ["- none"]),
    ``,
    `## Pending human approvals`,
    ``,
    ...report.pendingHumanApprovals.map((item) => `- ${item}`),
    ``,
    `Recorded at ${report.recordedAt}.`,
    ``,
  ];
  return lines.join("\n");
}

export function assertDiagnosisProductionPreflightClosed(
  report: DiagnosisProductionPreflightReport,
): void {
  if (
    report.approvedForProductionCutover ||
    report.gatesOpened ||
    report.trafficSwitched ||
    report.increment !== "P12"
  ) {
    fail(
      "preflight_not_closed",
      "P12 must not open production gates or switch traffic",
      "preflight",
    );
  }
}

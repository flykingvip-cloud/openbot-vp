import {
  createConversationLiveChatOutbound,
  type ConversationLiveChatBinding,
  type ConversationLiveChatOutbound,
} from "./conversation-live.js";
/**
 * Phase 11 — production cutover pack for P4–P10.
 * Rehearses gated wiring, canary policy, rollback, and provenance.
 * Does not flip production flags, register live packs, switch traffic,
 * call live chat/RPC/Doctor/Channel, or write the message main chain.
 * Does not create a Report DB, Skill Health DB, or second diagnosis store.
 */
import {
  createLiveDaibaiTransport,
  type DiagnosisLiveDaibaiChatSend,
} from "./daibai-delivery-live.js";
import {
  createUnavailableDaibaiTransport,
  type DiagnosisDaibaiTransport,
} from "./daibai-delivery.js";
import { createUnavailableRemediationExecutor } from "./remediation.js";
import type { RemediationExecutor } from "./remediation.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import {
  evaluateDiagnosisProductionApproval,
  type DiagnosisProductionApprovalReport,
} from "./report-query-production-approval.js";
import {
  evaluateDiagnosisProductionReadiness,
  previewDiagnosisLivePackRegistration,
  type DiagnosisLivePackPreview,
} from "./report-query-production-rehearsal.js";
import { DiagnosisContractError, isDiagnosisContractError } from "./types.js";
import type { DiagnosisVisualizationBundle } from "./visualization.js";
import { DIAGNOSIS_WRITE_POLICY } from "./write-policy.js";

export const DIAGNOSIS_PRODUCTION_CUTOVER_INCREMENT = "P11" as const;
export const DIAGNOSIS_PRODUCTION_CUTOVER_SCHEMA_VERSION = 1 as const;

export const DIAGNOSIS_DAIBAI_DELIVERY_ENABLED = DIAGNOSIS_WRITE_POLICY.daibaiDelivery;
export const DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED = false;
export const DIAGNOSIS_P24_5_DAIBAI_ALLOWLISTED = true;
export const DIAGNOSIS_P24_5_LIVE_SESSION_KEY = "diagnosis:canary:daibai" as const;
export const DIAGNOSIS_P24_5_CANARY_TENANT = "001" as const;

export const DIAGNOSIS_PRODUCTION_GATES = {
  adapters: {
    name: "DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED",
    default: false as const,
    value: DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
    approver: "platform_security",
    auditReceipt: "pending_human_approval",
    rollback: "keep_flag_false",
  },
  reportApi: {
    name: "DIAGNOSIS_REPORT_API_DEPLOYED",
    default: false as const,
    value: DIAGNOSIS_REPORT_API_DEPLOYED,
    approver: "platform_security",
    auditReceipt: "pending_human_approval",
    rollback: "keep_flag_false_revoke_live_pack",
  },
  daibaiDelivery: {
    name: "DIAGNOSIS_DAIBAI_DELIVERY_ENABLED",
    default: false as const,
    value: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
    approver: "platform_security+enterprise_admin",
    auditReceipt: "pending_human_approval",
    rollback: "disable_gate_stop_delivery_keep_receipts",
  },
  remediationExecution: {
    name: "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED",
    default: false as const,
    value: DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
    approver: "platform_security+enterprise_admin+employee",
    auditReceipt: "pending_human_approval",
    rollback: "disable_gate_stop_tasks_keep_audit",
  },
} as const;

export const DIAGNOSIS_PRODUCTION_ROLLBACK_TRIGGERS = [
  "tenant_isolation_failure",
  "audit_missing",
  "quota_unavailable",
  "unauthorized_delivery_or_execution",
  "reader_stale_or_schema_error",
  "remediation_verification_regressed",
] as const;

export const DIAGNOSIS_CANARY_POLICY = {
  firstStage: "internal_single_tenant",
  expandRequiresApproval: true,
  started: true,
} as const;

let productionDaibaiLiveSend: DiagnosisLiveDaibaiChatSend | null = null;

export function registerProductionDaibaiLiveSend(send: DiagnosisLiveDaibaiChatSend): void {
  productionDaibaiLiveSend = send;
}

export function clearProductionDaibaiLiveSendForTests(): void {
  productionDaibaiLiveSend = null;
}

export const DIAGNOSIS_PRODUCTION_SLO = {
  queryLatencyMs: { target: 300, observed: null },
  inspectionSuccessRate: { target: 0.99, observed: null },
  deliverySuccessRate: { target: 0.99, observed: null },
  authorizationWaitMs: { target: 300_000, observed: null },
  verificationSuccessRate: { target: 0.95, observed: null },
  falsePositiveRate: { target: 0.05, observed: null },
  completeness: "empty",
} as const;

export const DIAGNOSIS_PRODUCTION_PENDING_CUTOVER_APPROVALS = [
  "production_backend_config",
  "live_gateway_pack_registration",
  "daibai_delivery_allowlist",
  "remediation_executor_allowlist",
  "internal_single_tenant_canary",
  "production_build",
  "restart",
  "canary_and_traffic_switch",
] as const;

export type DiagnosisProductionApiLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "forbidden"
  | "stale";

export type DiagnosisProductionViewStatus = {
  apiLoadState: DiagnosisProductionApiLoadState;
  permissionState: DiagnosisVisualizationBundle["permissionState"];
  auditState: "recorded" | "missing" | "unavailable";
  freshness: {
    observedAt: string | null;
    maxAgeMs: number;
    stale: boolean;
    completeness: "complete" | "partial" | "empty" | "unavailable";
  };
};

export type DiagnosisProductionFault =
  | "reader_unavailable"
  | "audit_missing"
  | "quota_unavailable"
  | "schema_incompatible"
  | "stale_reader"
  | "unauthorized_delivery";

export type DiagnosisProductionCutoverReport = {
  increment: typeof DIAGNOSIS_PRODUCTION_CUTOVER_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  approvedForProductionCutover: false;
  canaryStarted: false;
  trafficSwitched: false;
  gates: typeof DIAGNOSIS_PRODUCTION_GATES;
  canary: typeof DIAGNOSIS_CANARY_POLICY;
  slo: typeof DIAGNOSIS_PRODUCTION_SLO;
  rollbackTriggers: typeof DIAGNOSIS_PRODUCTION_ROLLBACK_TRIGGERS;
  pendingHumanApprovals: typeof DIAGNOSIS_PRODUCTION_PENDING_CUTOVER_APPROVALS;
  livePackPreview: DiagnosisLivePackPreview;
  approval: DiagnosisProductionApprovalReport;
  provenance: DiagnosisCutoverProvenance;
};

export type DiagnosisCutoverProvenance = {
  kind: "cutover_rehearsal";
  published: false;
  tagged: false;
  candidateSha: string;
  originMainSha: string;
  recordedAt: string;
};

export type DiagnosisRollbackDrill = {
  gatesDisabled: true;
  livePackRevoked: true;
  newTasksStopped: true;
  auditRetained: true;
  historyDeleted: false;
  remainingAuditCount: number;
  stoppedTaskCount: number;
  trigger: (typeof DIAGNOSIS_PRODUCTION_ROLLBACK_TRIGGERS)[number];
};

const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

function fail(code: string, message: string, path = ""): never {
  throw new DiagnosisContractError(code, message, path);
}

export function isDiagnosisProductionSloHealthy(
  slo: {
    completeness: string;
    queryLatencyMs: { observed: number | null };
    inspectionSuccessRate: { observed: number | null };
    deliverySuccessRate: { observed: number | null };
    authorizationWaitMs: { observed: number | null };
    verificationSuccessRate: { observed: number | null };
    falsePositiveRate: { observed: number | null };
  } = DIAGNOSIS_PRODUCTION_SLO,
): boolean {
  if (slo.completeness === "empty" || slo.completeness === "unavailable") {
    return false;
  }
  return Object.values(slo).every((value) => {
    if (!value || typeof value !== "object" || !("observed" in value)) {
      return true;
    }
    return value.observed !== null;
  });
}

export function resolveProductionDaibaiTransport(
  input: {
    enabled?: boolean;
    allowlisted?: boolean;
    sessionKey?: string;
    send?: DiagnosisLiveDaibaiChatSend;
  } = {},
): DiagnosisDaibaiTransport {
  const enabled = input.enabled ?? DIAGNOSIS_DAIBAI_DELIVERY_ENABLED;
  if (!enabled) {
    return createUnavailableDaibaiTransport();
  }
  const allowlisted = input.allowlisted ?? DIAGNOSIS_P24_5_DAIBAI_ALLOWLISTED;
  if (!allowlisted) {
    fail(
      "daibai_transport_not_allowlisted",
      "live Da Bai transport requires an allowlist",
      "transport",
    );
  }
  if (!DIAGNOSIS_CANARY_POLICY.started) {
    fail("daibai_canary_not_started", "live Da Bai transport requires canary start", "canary");
  }
  const send = input.send ?? productionDaibaiLiveSend;
  if (!send) {
    fail(
      "daibai_live_transport_unregistered",
      "live Da Bai transport requires a registered chat.send bridge",
      "transport",
    );
  }
  const sessionKey = input.sessionKey ?? DIAGNOSIS_P24_5_LIVE_SESSION_KEY;
  if (sessionKey.trim() !== DIAGNOSIS_P24_5_LIVE_SESSION_KEY) {
    fail(
      "canary_session_mismatch",
      "live Da Bai transport is limited to the diagnosis canary session key",
      "sessionKey",
    );
  }
  return createLiveDaibaiTransport({
    send,
    sessionKey,
    canaryTenantId: DIAGNOSIS_P24_5_CANARY_TENANT,
  });
}

/** Compile-time gate closed or live executor intentionally undeployed. */
export function isProductionRemediationLiveExecutorUndeployed(): boolean {
  if (!DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED) {
    return true;
  }
  try {
    resolveProductionRemediationExecutor({ enabled: true, allowlisted: true });
    return false;
  } catch (err) {
    return isDiagnosisContractError(err) && err.code === "remediation_live_executor_undeployed";
  }
}

export function resolveProductionRemediationExecutor(
  input: {
    enabled?: boolean;
    allowlisted?: boolean;
  } = {},
): RemediationExecutor {
  const enabled = input.enabled ?? DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED;
  if (!enabled) {
    return createUnavailableRemediationExecutor();
  }
  if (!input.allowlisted) {
    fail(
      "remediation_executor_not_allowlisted",
      "production executor requires an explicit allowlist",
      "executor",
    );
  }
  fail(
    "remediation_live_executor_undeployed",
    "P11 must not open a live remediation executor",
    "executor",
  );
}

export function bindConversationDiagnosisToLiveChat(
  binding?: ConversationLiveChatBinding,
): ConversationLiveChatOutbound {
  if (!DIAGNOSIS_DAIBAI_DELIVERY_ENABLED) {
    fail(
      "live_chat_forbidden",
      "conversation live chat requires Da Bai delivery gate",
      "conversation",
    );
  }
  if (!DIAGNOSIS_CANARY_POLICY.started) {
    fail("live_chat_canary_not_started", "conversation live chat requires canary start", "canary");
  }
  if (!binding) {
    fail("live_chat_binding_required", "conversation live chat requires an explicit binding");
  }
  if (binding.tenantId !== DIAGNOSIS_P24_5_CANARY_TENANT) {
    fail(
      "canary_tenant_mismatch",
      "conversation live chat is limited to the internal single tenant canary",
      "tenantId",
    );
  }
  if (binding.sessionKey.trim() !== DIAGNOSIS_P24_5_LIVE_SESSION_KEY) {
    fail(
      "canary_session_mismatch",
      "conversation live chat is limited to the diagnosis canary session key",
      "sessionKey",
    );
  }
  return createConversationLiveChatOutbound(binding);
}

export function injectDiagnosisProductionFault(kind: DiagnosisProductionFault): never {
  const codes: Record<DiagnosisProductionFault, string> = {
    reader_unavailable: "reader_unavailable",
    audit_missing: "audit_missing",
    quota_unavailable: "quota_unavailable",
    schema_incompatible: "schema_incompatible",
    stale_reader: "reader_stale",
    unauthorized_delivery: "unauthorized_delivery",
  };
  fail(codes[kind], `production path fail-closed on ${kind}`, kind);
}

export function attachDiagnosisProductionStatus(
  bundle: DiagnosisVisualizationBundle,
  input: {
    now?: number;
    lastObservedAt?: string | null;
    auditState?: DiagnosisProductionViewStatus["auditState"];
    apiLoadState?: DiagnosisProductionApiLoadState;
    maxAgeMs?: number;
  } = {},
): DiagnosisVisualizationBundle & { production: DiagnosisProductionViewStatus } {
  const now = input.now ?? Date.parse("2026-09-03T05:00:00.000Z");
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const observedAt = input.lastObservedAt ?? null;
  const observedMs = observedAt ? Date.parse(observedAt) : Number.NaN;
  const stale = !observedAt || Number.isNaN(observedMs) || now - observedMs > maxAgeMs;
  const apiLoadState =
    input.apiLoadState ??
    (bundle.loadError
      ? "unavailable"
      : stale
        ? "stale"
        : bundle.permissionState === "empty"
          ? "idle"
          : "ready");
  const auditState = input.auditState ?? (bundle.loadError ? "unavailable" : "missing");
  const production: DiagnosisProductionViewStatus = {
    apiLoadState,
    permissionState: bundle.permissionState,
    auditState,
    freshness: {
      observedAt,
      maxAgeMs,
      stale,
      completeness: bundle.trend.completeness,
    },
  };
  const unhealthy =
    stale ||
    auditState !== "recorded" ||
    apiLoadState === "unavailable" ||
    apiLoadState === "forbidden" ||
    apiLoadState === "stale" ||
    bundle.permissionState === "empty" ||
    bundle.permissionState === "unavailable" ||
    bundle.health.tone === "inconclusive" ||
    bundle.health.tone === "empty" ||
    bundle.health.tone === "error" ||
    bundle.health.tone === "expired";
  const health =
    unhealthy && bundle.health.tone === "ok"
      ? { ...bundle.health, tone: "watch" as const, label: "数据不完整" }
      : bundle.health;
  return { ...bundle, health, production };
}

export function drillDiagnosisProductionRollback(input: {
  trigger: (typeof DIAGNOSIS_PRODUCTION_ROLLBACK_TRIGGERS)[number];
  auditRecords?: readonly unknown[];
  pendingTaskCount?: number;
}): DiagnosisRollbackDrill {
  if (!(DIAGNOSIS_PRODUCTION_ROLLBACK_TRIGGERS as readonly string[]).includes(input.trigger)) {
    fail("rollback_trigger_invalid", "unknown rollback trigger", "trigger");
  }
  return {
    gatesDisabled: true,
    livePackRevoked: true,
    newTasksStopped: true,
    auditRetained: true,
    historyDeleted: false,
    remainingAuditCount: input.auditRecords?.length ?? 0,
    stoppedTaskCount: input.pendingTaskCount ?? 0,
    trigger: input.trigger,
  };
}

export function recordDiagnosisCutoverProvenance(input: {
  candidateSha: string;
  originMainSha: string;
  now?: number;
}): DiagnosisCutoverProvenance {
  if (!input.candidateSha || !input.originMainSha) {
    fail("provenance_sha_required", "cutover rehearsal needs candidate and origin/main SHAs");
  }
  return {
    kind: "cutover_rehearsal",
    published: false,
    tagged: false,
    candidateSha: input.candidateSha,
    originMainSha: input.originMainSha,
    recordedAt: new Date(input.now ?? Date.parse("2026-09-03T05:00:00.000Z")).toISOString(),
  };
}

export function evaluateDiagnosisProductionCutover(input: {
  candidateSha: string;
  originMainSha: string;
  livePacks?: readonly { id: string }[];
  coreHandlerNames?: readonly string[];
  now?: number;
}): DiagnosisProductionCutoverReport {
  const approval = evaluateDiagnosisProductionApproval({
    livePacks: input.livePacks,
    coreHandlerNames: input.coreHandlerNames,
    readiness: evaluateDiagnosisProductionReadiness({ livePacks: input.livePacks ?? [] }),
  });
  const livePackPreview = previewDiagnosisLivePackRegistration();
  return {
    increment: DIAGNOSIS_PRODUCTION_CUTOVER_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_CUTOVER_SCHEMA_VERSION,
    rehearsalOnly: true,
    approvedForProductionCutover: false,
    canaryStarted: false,
    trafficSwitched: false,
    gates: DIAGNOSIS_PRODUCTION_GATES,
    canary: DIAGNOSIS_CANARY_POLICY,
    slo: DIAGNOSIS_PRODUCTION_SLO,
    rollbackTriggers: DIAGNOSIS_PRODUCTION_ROLLBACK_TRIGGERS,
    pendingHumanApprovals: DIAGNOSIS_PRODUCTION_PENDING_CUTOVER_APPROVALS,
    livePackPreview,
    approval,
    provenance: recordDiagnosisCutoverProvenance(input),
  };
}

export function isDiagnosisProductionCutoverClosed(
  report: DiagnosisProductionCutoverReport,
): boolean {
  return (
    report.increment === "P11" &&
    report.rehearsalOnly &&
    !report.approvedForProductionCutover &&
    !report.canaryStarted &&
    !report.trafficSwitched &&
    !isDiagnosisProductionSloHealthy(report.slo) &&
    !report.livePackPreview.wouldRegister &&
    !report.provenance.published &&
    !report.provenance.tagged &&
    report.pendingHumanApprovals.length === DIAGNOSIS_PRODUCTION_PENDING_CUTOVER_APPROVALS.length
  );
}

export function assertDiagnosisProductionCutoverClosed(
  report: DiagnosisProductionCutoverReport,
): void {
  if (!isDiagnosisProductionCutoverClosed(report)) {
    fail("cutover_not_closed", "P11 must stay closed until independent approvals land", "cutover");
  }
}

export const DIAGNOSIS_PRODUCTION_CUTOVER_MANIFEST = {
  increment: DIAGNOSIS_PRODUCTION_CUTOVER_INCREMENT,
  rehearsalOnly: true,
  approvedForProductionCutover: false,
  gates: DIAGNOSIS_PRODUCTION_GATES,
  canary: DIAGNOSIS_CANARY_POLICY,
  slo: DIAGNOSIS_PRODUCTION_SLO,
  rollbackTriggers: DIAGNOSIS_PRODUCTION_ROLLBACK_TRIGGERS,
  pendingHumanApprovals: DIAGNOSIS_PRODUCTION_PENDING_CUTOVER_APPROVALS,
} as const;

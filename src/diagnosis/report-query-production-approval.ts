/**
 * Phase 3.10 — production access approval pack.
 * Machine-readable summary of P3.5–P3.9 plus pre-merge gates.
 * Approval preparation only. Does not deploy, register live packs, or inject backends.
 */
import {
  DIAGNOSIS_REPORT_API_METHODS,
  DIAGNOSIS_REPORT_API_SCHEMA_VERSION,
} from "./report-query-api.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import {
  DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
  PRODUCTION_ADAPTER_STORAGE,
  PRODUCTION_AUDIT_ALLOWED_KEYS,
  assertProductionAdaptersUndeployed,
} from "./report-query-production-adapters.js";
import {
  COMPOSITE_REPORT_AUTHORITY_SOURCES,
  DIAGNOSIS_PRODUCTION_AUTH_MATRIX,
  DIAGNOSIS_REPORT_RELEASE_CANDIDATE,
  FORBIDDEN_AUDIT_PAYLOAD_KEYS,
  NON_AUTHORITATIVE_TENANT_SOURCES,
  PRODUCTION_QUOTA_MAX_CONCURRENCY,
  PRODUCTION_QUOTA_WINDOW_MS,
} from "./report-query-production-integration.js";
import {
  DIAGNOSIS_LIVE_PACK_ID,
  DIAGNOSIS_PRODUCTION_API_STATUS_MAPPING,
  DIAGNOSIS_PRODUCTION_CANDIDATE_MANIFEST,
  evaluateDiagnosisProductionReadiness,
  isDiagnosisProductionRehearsalReady,
  liveDiagnosisPackIsRegistered,
  type DiagnosisProductionReadinessReport,
} from "./report-query-production-rehearsal.js";
import {
  PRODUCTION_QUERY_PRINCIPAL_QUOTA,
  PRODUCTION_QUERY_TENANT_QUOTA,
  PRODUCTION_REDACTION_PROFILES,
} from "./report-query-production.js";
import { FORBIDDEN_REPORT_PAYLOAD_KEYS } from "./report-validate.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_PRODUCTION_APPROVAL_INCREMENT = "P3.10" as const;
export const DIAGNOSIS_PRODUCTION_COVERED_INCREMENTS = [
  "P3.5",
  "P3.6",
  "P3.7",
  "P3.8",
  "P3.9",
] as const;

export const DIAGNOSIS_PRODUCTION_PENDING_HUMAN_APPROVALS = [
  "production_backend_config",
  "live_gateway_pack_registration",
  "production_build",
  "restart",
  "canary_and_traffic_switch",
] as const;

export const DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST = {
  increment: DIAGNOSIS_PRODUCTION_APPROVAL_INCREMENT,
  kind: "approval_pack",
  approvalOnly: true,
  approvedForProductionCutover: false,
  coveredIncrements: DIAGNOSIS_PRODUCTION_COVERED_INCREMENTS,
  dependenciesRequireExplicitInjectionAndApproval: true,
  api: {
    methods: DIAGNOSIS_REPORT_API_METHODS,
    schemaVersion: DIAGNOSIS_REPORT_API_SCHEMA_VERSION,
    statusMapping: DIAGNOSIS_PRODUCTION_API_STATUS_MAPPING,
    cursorPrefix: DIAGNOSIS_PRODUCTION_CANDIDATE_MANIFEST.cursorPrefix,
    operatorScope: DIAGNOSIS_PRODUCTION_CANDIDATE_MANIFEST.operatorScope,
  },
  auth: {
    trustedTenantSource: "server_membership_only",
    matrix: DIAGNOSIS_PRODUCTION_AUTH_MATRIX,
    nonAuthoritativeTenantSources: NON_AUTHORITATIVE_TENANT_SOURCES,
  },
  reader: {
    authoritySources: COMPOSITE_REPORT_AUTHORITY_SOURCES,
    storage: PRODUCTION_ADAPTER_STORAGE.reader,
    checks: ["schemaVersion", "tenantId", "maxAge", "payload"],
  },
  audit: {
    persist: "async_await_required",
    allowedKeys: PRODUCTION_AUDIT_ALLOWED_KEYS,
    forbiddenKeys: FORBIDDEN_AUDIT_PAYLOAD_KEYS,
    storage: PRODUCTION_ADAPTER_STORAGE.audit,
  },
  quota: {
    consume: "consumeWindow",
    release: "releaseWindow",
    unavailable: "fail_closed_503",
    windowMs: PRODUCTION_QUOTA_WINDOW_MS,
    tenantLimit: PRODUCTION_QUERY_TENANT_QUOTA,
    principalLimit: PRODUCTION_QUERY_PRINCIPAL_QUOTA,
    maxConcurrency: PRODUCTION_QUOTA_MAX_CONCURRENCY,
    storage: PRODUCTION_ADAPTER_STORAGE.quota,
  },
  redaction: {
    profiles: PRODUCTION_REDACTION_PROFILES,
    forbiddenPayloadKeys: FORBIDDEN_REPORT_PAYLOAD_KEYS,
  },
  gates: {
    deployFlagName: "DIAGNOSIS_REPORT_API_DEPLOYED",
    deployFlagValue: DIAGNOSIS_REPORT_API_DEPLOYED,
    adapterGateName: "DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED",
    adapterGateValue: DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
    livePackRegistration: false,
    livePackId: DIAGNOSIS_LIVE_PACK_ID,
    productionBuild: false,
    httpRpcUiEntry: false,
    writesMessageChain: false,
    writesSkillInvocation: false,
    doctorRepair: false,
    channelRestart: false,
  },
  pendingHumanApprovals: DIAGNOSIS_PRODUCTION_PENDING_HUMAN_APPROVALS,
  rollback: {
    keepDeployFlagFalse: true,
    doNotRegisterLivePack: true,
    doNotRestart: true,
    doNotSwitchTraffic: true,
    doNotAutoRepair: true,
    doNotPublish: true,
  },
} as const;

export type DiagnosisProductionApprovalReport = {
  increment: typeof DIAGNOSIS_PRODUCTION_APPROVAL_INCREMENT;
  approvalOnly: true;
  approvedForProductionCutover: false;
  manifest: typeof DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST;
  readiness: DiagnosisProductionReadinessReport;
  preMerge: {
    deployFlag: boolean;
    adaptersEnabled: boolean;
    livePackRegistered: boolean;
    diagnosisHandlersRegistered: boolean;
    rehearsalReady: boolean;
    releaseCandidateUndeployed: boolean;
  };
};

export function evaluateDiagnosisProductionApproval(
  input: {
    livePacks?: readonly { id: string }[];
    coreHandlerNames?: readonly string[];
    readiness?: DiagnosisProductionReadinessReport;
  } = {},
): DiagnosisProductionApprovalReport {
  const readiness =
    input.readiness ??
    evaluateDiagnosisProductionReadiness({
      livePacks: input.livePacks ?? [],
    });
  const handlerNames = input.coreHandlerNames ?? [];
  return {
    increment: DIAGNOSIS_PRODUCTION_APPROVAL_INCREMENT,
    approvalOnly: true,
    approvedForProductionCutover: false,
    manifest: DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST,
    readiness,
    preMerge: {
      deployFlag: DIAGNOSIS_REPORT_API_DEPLOYED,
      adaptersEnabled: DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
      livePackRegistered: liveDiagnosisPackIsRegistered(input.livePacks ?? []),
      diagnosisHandlersRegistered: handlerNames.some((name) =>
        (DIAGNOSIS_REPORT_API_METHODS as readonly string[]).includes(name),
      ),
      rehearsalReady: isDiagnosisProductionRehearsalReady(readiness),
      releaseCandidateUndeployed: !DIAGNOSIS_REPORT_RELEASE_CANDIDATE.livePackRegistration,
    },
  };
}

export function isDiagnosisProductionApprovalReady(
  report: DiagnosisProductionApprovalReport,
): boolean {
  return (
    report.increment === "P3.10" &&
    report.approvalOnly &&
    !report.approvedForProductionCutover &&
    !report.manifest.approvedForProductionCutover &&
    report.manifest.dependenciesRequireExplicitInjectionAndApproval &&
    !report.manifest.gates.livePackRegistration &&
    !report.manifest.gates.productionBuild &&
    !report.manifest.gates.httpRpcUiEntry &&
    report.preMerge.rehearsalReady &&
    report.preMerge.releaseCandidateUndeployed &&
    report.manifest.pendingHumanApprovals.length ===
      DIAGNOSIS_PRODUCTION_PENDING_HUMAN_APPROVALS.length
  );
}

export function assertDiagnosisProductionApprovalUndeployed(
  report: DiagnosisProductionApprovalReport = evaluateDiagnosisProductionApproval(),
): void {
  assertProductionAdaptersUndeployed();
  if (!isDiagnosisProductionApprovalReady(report)) {
    throw new DiagnosisContractError(
      "approval_not_ready",
      "P3.10 approval pack is not ready; keep flags false and do not cut over",
      "approval",
    );
  }
}

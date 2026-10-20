/**
 * Phase 3.9 — production wiring rehearsal.
 * Dry-run live-pack checks and readiness only. Never mutates GATEWAY_METHOD_PACKS.
 */
import {
  DIAGNOSIS_REPORT_API_METHODS,
  DIAGNOSIS_REPORT_API_SCHEMA_VERSION,
  type DiagnosisReportApiStatus,
} from "./report-query-api.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import {
  DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
  assertProductionAdaptersUndeployed,
} from "./report-query-production-adapters.js";
import {
  parseDiagnosisProductionAdapterConfig,
  type DiagnosisProductionAdapterConfig,
} from "./report-query-production-config.js";
import {
  DIAGNOSIS_PRODUCTION_AUTH_MATRIX,
  DIAGNOSIS_REPORT_RELEASE_CANDIDATE,
} from "./report-query-production-integration.js";
import {
  PRODUCTION_QUERY_CURSOR_PREFIX,
  PRODUCTION_REDACTION_PROFILES,
} from "./report-query-production.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_LIVE_PACK_ID = "diagnosis-reports" as const;
export const DIAGNOSIS_PRODUCTION_REHEARSAL_INCREMENT = "P3.9" as const;

export const DIAGNOSIS_PRODUCTION_API_STATUS_MAPPING = {
  authorized: 200,
  unknown_schema_version: 400,
  invalid_cursor: 400,
  cursor_expired: 400,
  unauthenticated: 401,
  forbidden: 403,
  method_not_found: 404,
  rate_limited: 429,
  unavailable: 503,
} as const satisfies Record<string, DiagnosisReportApiStatus>;

export const DIAGNOSIS_PRODUCTION_CANDIDATE_MANIFEST = {
  increment: DIAGNOSIS_PRODUCTION_REHEARSAL_INCREMENT,
  rehearsalOnly: true,
  packId: DIAGNOSIS_LIVE_PACK_ID,
  methods: DIAGNOSIS_REPORT_API_METHODS,
  schemaVersion: DIAGNOSIS_REPORT_API_SCHEMA_VERSION,
  cursorPrefix: PRODUCTION_QUERY_CURSOR_PREFIX,
  operatorScope: "operator.read",
  deployFlagName: "DIAGNOSIS_REPORT_API_DEPLOYED",
  adapterGateName: "DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED",
} as const;

export type DiagnosisLivePackPreviewInput = {
  deployFlag?: boolean;
  adaptersEnabled?: boolean;
  auth?: unknown;
  reader?: unknown;
  audit?: unknown;
  quota?: unknown;
};

export type DiagnosisLivePackCandidate = {
  packId: typeof DIAGNOSIS_LIVE_PACK_ID;
  methods: typeof DIAGNOSIS_REPORT_API_METHODS;
  operatorScope: "operator.read";
  schemaVersion: typeof DIAGNOSIS_REPORT_API_SCHEMA_VERSION;
  cursorPrefix: typeof PRODUCTION_QUERY_CURSOR_PREFIX;
};

export type DiagnosisLivePackPreview = {
  outcome: "hold" | "reject" | "candidate";
  reason:
    | "deploy_flag_false"
    | "adapters_disabled"
    | "auth_missing"
    | "reader_missing"
    | "audit_missing"
    | "quota_missing"
    | "rehearsal_candidate";
  wouldRegister: false;
  livePackUnchanged: true;
  checks: {
    deployFlag: boolean;
    adaptersEnabled: boolean;
    auth: boolean;
    reader: boolean;
    audit: boolean;
    quota: boolean;
  };
  candidate?: DiagnosisLivePackCandidate;
};

export type DiagnosisProductionReadinessReport = {
  increment: typeof DIAGNOSIS_PRODUCTION_REHEARSAL_INCREMENT;
  rehearsalOnly: true;
  readyForProductionCutover: false;
  schemaVersion: typeof DIAGNOSIS_REPORT_API_SCHEMA_VERSION;
  cursorPrefix: typeof PRODUCTION_QUERY_CURSOR_PREFIX;
  permissionMatrix: typeof DIAGNOSIS_PRODUCTION_AUTH_MATRIX;
  redactionProfiles: typeof PRODUCTION_REDACTION_PROFILES;
  apiStatusMapping: typeof DIAGNOSIS_PRODUCTION_API_STATUS_MAPPING;
  deployFlag: boolean;
  adaptersEnabled: boolean;
  livePackRegistered: boolean;
  config: DiagnosisProductionAdapterConfig;
  candidateManifest: typeof DIAGNOSIS_PRODUCTION_CANDIDATE_MANIFEST;
  rollback: {
    keepDeployFlagFalse: true;
    doNotRegisterLivePack: true;
    doNotRestart: true;
    doNotSwitchTraffic: true;
    doNotAutoRepair: true;
  };
};

export function previewDiagnosisLivePackRegistration(
  input: DiagnosisLivePackPreviewInput = {},
): DiagnosisLivePackPreview {
  const checks = {
    deployFlag: input.deployFlag ?? DIAGNOSIS_REPORT_API_DEPLOYED,
    adaptersEnabled: input.adaptersEnabled ?? DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
    auth: isPresent(input.auth),
    reader: isPresent(input.reader),
    audit: isPresent(input.audit),
    quota: isPresent(input.quota),
  };
  const base = {
    wouldRegister: false as const,
    livePackUnchanged: true as const,
    checks,
  };
  if (!checks.deployFlag) {
    return { ...base, outcome: "hold", reason: "deploy_flag_false" };
  }
  if (!checks.adaptersEnabled) {
    return { ...base, outcome: "hold", reason: "adapters_disabled" };
  }
  if (!checks.auth) {
    return { ...base, outcome: "reject", reason: "auth_missing" };
  }
  if (!checks.reader) {
    return { ...base, outcome: "reject", reason: "reader_missing" };
  }
  if (!checks.audit) {
    return { ...base, outcome: "reject", reason: "audit_missing" };
  }
  if (!checks.quota) {
    return { ...base, outcome: "reject", reason: "quota_missing" };
  }
  return {
    ...base,
    outcome: "candidate",
    reason: "rehearsal_candidate",
    candidate: {
      packId: DIAGNOSIS_LIVE_PACK_ID,
      methods: DIAGNOSIS_REPORT_API_METHODS,
      operatorScope: "operator.read",
      schemaVersion: DIAGNOSIS_REPORT_API_SCHEMA_VERSION,
      cursorPrefix: PRODUCTION_QUERY_CURSOR_PREFIX,
    },
  };
}

export function liveDiagnosisPackIsRegistered(packs: readonly { id: string }[]): boolean {
  return packs.some((pack) => pack.id === DIAGNOSIS_LIVE_PACK_ID);
}

export function evaluateDiagnosisProductionReadiness(
  input: {
    config?: DiagnosisProductionAdapterConfig;
    livePacks?: readonly { id: string }[];
    deployFlag?: boolean;
    adaptersEnabled?: boolean;
  } = {},
): DiagnosisProductionReadinessReport {
  const config = input.config ?? parseDiagnosisProductionAdapterConfig();
  return {
    increment: DIAGNOSIS_PRODUCTION_REHEARSAL_INCREMENT,
    rehearsalOnly: true,
    readyForProductionCutover: false,
    schemaVersion: DIAGNOSIS_REPORT_API_SCHEMA_VERSION,
    cursorPrefix: PRODUCTION_QUERY_CURSOR_PREFIX,
    permissionMatrix: DIAGNOSIS_PRODUCTION_AUTH_MATRIX,
    redactionProfiles: PRODUCTION_REDACTION_PROFILES,
    apiStatusMapping: DIAGNOSIS_PRODUCTION_API_STATUS_MAPPING,
    deployFlag: input.deployFlag ?? DIAGNOSIS_REPORT_API_DEPLOYED,
    adaptersEnabled: input.adaptersEnabled ?? DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
    livePackRegistered: liveDiagnosisPackIsRegistered(input.livePacks ?? []),
    config,
    candidateManifest: DIAGNOSIS_PRODUCTION_CANDIDATE_MANIFEST,
    rollback: {
      keepDeployFlagFalse: true,
      doNotRegisterLivePack: true,
      doNotRestart: true,
      doNotSwitchTraffic: true,
      doNotAutoRepair: true,
    },
  };
}

export function isDiagnosisProductionRehearsalReady(
  report: DiagnosisProductionReadinessReport,
): boolean {
  return (
    report.increment === "P3.9" &&
    report.rehearsalOnly &&
    !report.readyForProductionCutover &&
    !report.config.enabled &&
    report.schemaVersion === 1 &&
    report.cursorPrefix === "pq1." &&
    report.redactionProfiles.includes("administrator") &&
    report.redactionProfiles.includes("user") &&
    report.redactionProfiles.includes("system_local") &&
    report.redactionProfiles.length === PRODUCTION_REDACTION_PROFILES.length &&
    report.rollback.keepDeployFlagFalse &&
    report.rollback.doNotRegisterLivePack &&
    report.rollback.doNotRestart &&
    report.rollback.doNotSwitchTraffic &&
    report.rollback.doNotAutoRepair &&
    report.apiStatusMapping.unauthenticated === 401 &&
    report.apiStatusMapping.forbidden === 403 &&
    report.apiStatusMapping.invalid_cursor === 400 &&
    report.apiStatusMapping.rate_limited === 429 &&
    report.apiStatusMapping.unavailable === 503 &&
    report.permissionMatrix.length === DIAGNOSIS_PRODUCTION_AUTH_MATRIX.length &&
    !DIAGNOSIS_REPORT_RELEASE_CANDIDATE.livePackRegistration
  );
}

export function assertDiagnosisProductionRehearsalUndeployed(
  report: DiagnosisProductionReadinessReport = evaluateDiagnosisProductionReadiness(),
): void {
  assertProductionAdaptersUndeployed();
  if (!isDiagnosisProductionRehearsalReady(report)) {
    throw new DiagnosisContractError(
      "rehearsal_not_ready",
      "P3.9 rehearsal readiness predicate failed; keep flags false and do not register live packs",
      "readiness",
    );
  }
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

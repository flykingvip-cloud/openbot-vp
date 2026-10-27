/**
 * CQ-O0 memory health report types (rev.4.1).
 * Ops and summary schemas are type-separated to prevent path leakage.
 */

export type MemoryStatusFieldProvenance = Record<
  string,
  "existing" | "derived" | "persisted" | "unknown"
>;

export type MemoryUserStatus = {
  agentId: string;
  storage: "ready" | "missing" | "unknown" | "denied";
  authority: "registered" | "unknown";
  rootTopology: "single" | "multiple" | "mismatch" | "unobserved";
  topologyEvidence: "sidecar-fingerprints" | "runtime-binding" | "inventory-only" | "unknown";
  destructiveOps: "allowed" | "denied" | "maintenance-grant-required";
  search: "ready" | "stale" | "empty" | "disabled" | "error" | "unknown";
  documentState: "populated" | "empty" | "unknown";
  searchableDocumentCount: number | null;
  reasonCode: string;
  reason: string;
  backend: string;
  /** Configured backend from resolveMemoryBackendConfig (may differ from observed). */
  configuredBackend?: string;
  /** Backend confirmed by read-only store evidence; unknown when not verified. */
  observedBackend?: string;
  /** Whether the probe function itself completed. */
  probeExecution?: "ok" | "error";
  /** Backend storage/scope/readiness judgment — not the same as probeExecution. */
  backendHealth?: "healthy" | "degraded" | "unhealthy" | "unknown";
  /** Retrieval capability; stays unknown without an actual retrieval evidence probe. */
  retrievalStatus?: "ready" | "empty" | "error" | "unknown";
  fields?: MemoryStatusFieldProvenance;
};

export type MemoryOpsStatus = MemoryUserStatus & {
  workspaceRoot: string;
  workspaceFingerprint: string;
  indexPath: string;
  sqliteInstanceId: string;
  sidecarFingerprintCount: number;
  guardIndexStatus: "ok" | "unknown" | "degraded";
  guardReason?: string;
  lastSyncAt: string | null;
  lastRebuildAt: string | null;
};

export type GroupUserStatus = {
  groupId: string;
  memoryMdCount: number;
  mirrorDivergence: "none" | "path_mismatch" | "acl_mismatch" | "unknown";
};

export type GroupOpsStatus = GroupUserStatus & {
  transcriptPath: string;
  memoryDir: string;
  mirrorPath?: string;
};

export type ProbeArtifactDiff = {
  preSnapshotHash: string;
  postSnapshotHash: string;
  mutationsDetected: boolean;
  changedPaths?: string[];
};

export type HealthReportMeta = {
  schema: "memory-health-report/v2";
  instanceSha: string;
  probeModuleSha: string;
  probeModuleVersion: string;
  probeUtc: string;
};

export type HealthReportOpsOk = HealthReportMeta & {
  reportKind: "ops";
  status: "ok";
  reasonCode: "probe.ok";
  callerScope: "platform" | "steward" | "tenant";
  authorizedAgentIds: string[];
  runtime: { stateDir: string; tenantsRoot?: string | null };
  agents: MemoryOpsStatus[];
  groups: GroupOpsStatus[];
  probeIntegrity: ProbeArtifactDiff & { mutationsDetected: false };
};

export type HealthReportSummaryOk = HealthReportMeta & {
  reportKind: "summary";
  status: "ok";
  reasonCode: "probe.ok";
  callerScope: "steward" | "tenant";
  authorizedAgentIds?: string[];
  agents: MemoryUserStatus[];
  groups?: GroupUserStatus[];
};

export type HealthReportProbeInvalid = HealthReportMeta & {
  reportKind: "ops";
  status: "invalid";
  reasonCode: "probe.invalid";
  reason: string;
  callerScope: "platform" | "steward" | "tenant";
  agents?: never;
  groups?: never;
  runtime?: never;
  authorizedAgentIds?: never;
  probeIntegrity?: ProbeArtifactDiff;
};

export type HealthReportScopeDenied = {
  schema: "memory-health-report/v2";
  status: "denied";
  reasonCode: "scope.denied";
  reason: string;
  probeUtc: string;
};

export type HealthReport =
  | HealthReportOpsOk
  | HealthReportSummaryOk
  | HealthReportProbeInvalid
  | HealthReportScopeDenied;

export function toSummaryAgentStatus(agent: MemoryOpsStatus): MemoryUserStatus {
  const {
    workspaceRoot: _w,
    workspaceFingerprint: _f,
    indexPath: _i,
    sqliteInstanceId: _s,
    sidecarFingerprintCount: _c,
    guardIndexStatus: _g,
    guardReason: _gr,
    lastSyncAt: _ls,
    lastRebuildAt: _lr,
    ...user
  } = agent;
  return user;
}

export function createScopeDeniedReport(reason: string, probeUtc: string): HealthReportScopeDenied {
  return {
    schema: "memory-health-report/v2",
    status: "denied",
    reasonCode: "scope.denied",
    reason,
    probeUtc,
  };
}

export function createProbeInvalidReport(params: {
  meta: HealthReportMeta;
  callerScope: HealthReportProbeInvalid["callerScope"];
  reason: string;
  probeIntegrity: ProbeArtifactDiff;
}): HealthReportProbeInvalid {
  return {
    ...params.meta,
    reportKind: "ops",
    status: "invalid",
    reasonCode: "probe.invalid",
    reason: params.reason,
    callerScope: params.callerScope,
    probeIntegrity: params.probeIntegrity,
  };
}

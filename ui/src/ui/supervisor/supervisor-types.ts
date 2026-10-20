/** UI-facing types for Development Supervisor gateway API (M4). */

export type SupervisedTaskState =
  | "planned"
  | "dispatched"
  | "executing"
  | "validating"
  | "fixing"
  | "accepted"
  | "escalated"
  | "budget_exhausted"
  | "max_iterations"
  | "timed_out"
  | "aborted"
  | "failed";

export type SupervisorTaskEventType = "task_started" | "milestone" | "progress" | "final_report";

export interface SupervisedTaskSnapshot {
  taskId: string;
  goal: string;
  repoRoot: string;
  state: SupervisedTaskState;
  tenantId?: string;
  userId?: string;
  seatId?: string;
  agentId?: string;
  worker: { backendId: string; model?: string };
  iterations: Array<{
    index: number;
    runId?: string;
    exitCode?: number;
    workerSummary?: string;
    startedAt?: string;
    endedAt?: string;
    validation?: { passed?: boolean; steps?: Array<{ id: string; ok: boolean }> };
  }>;
  budget: {
    spentCostUsd: number;
    maxIterations: number;
    maxCostUsd: number;
    maxDurationMinutes?: number;
  };
  acceptance?: {
    source?: string;
    steps: Array<{ id: string; argv?: string[]; required: boolean }>;
  };
  activeRun?: { runId: string; workerId: string };
  escalationRef?: string;
  /** DeliveryLane projection pointer (Tip A) — 「交付看板」, ≠对话焦点看板. */
  laneId?: string;
  laneProjection?: {
    laneId: string;
    stage: string;
    tipSha?: string;
    headSha?: string;
    prNumber?: number;
    missingKeys: string[];
    focusSummary?: string;
    acceptSealStrength?: "weak" | "strong";
    acceptSealWeak?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SupervisorTaskEventPayload {
  taskId: string;
  type: SupervisorTaskEventType;
  at: string;
  state?: string;
  goal?: string;
  summary?: string;
  runId?: string;
  progress?: { kind?: string; phase?: string; data?: string; runId?: string };
}

export interface SupervisorAuditResponse {
  taskId: string;
  fabricRecords: unknown[];
  fabricStats: unknown;
  usageAttribution: unknown[];
  reportEvents: Array<Record<string, unknown>>;
}

const TERMINAL: ReadonlySet<SupervisedTaskState> = new Set([
  "accepted",
  "escalated",
  "budget_exhausted",
  "max_iterations",
  "timed_out",
  "aborted",
  "failed",
]);

export function isTerminalSupervisorState(state: string): boolean {
  return TERMINAL.has(state as SupervisedTaskState);
}

export const SUPERVISOR_STATE_LABELS: Record<SupervisedTaskState, string> = {
  planned: "已规划",
  dispatched: "已派发",
  executing: "执行中",
  validating: "验证中",
  fixing: "修复中",
  accepted: "已通过",
  escalated: "已升级",
  budget_exhausted: "预算耗尽",
  max_iterations: "达最大迭代",
  timed_out: "已超时",
  aborted: "已中止",
  failed: "失败",
};

export function formatSupervisorState(state: string): string {
  return SUPERVISOR_STATE_LABELS[state as SupervisedTaskState] ?? state;
}

export const SUPERVISOR_TASK_EVENT = "openbot:supervisor-task-event";

export interface SupervisorAcceptanceStep {
  id: string;
  argv: string[];
  required: boolean;
}

export interface SupervisorTaskTemplate {
  id: string;
  label: string;
  description: string;
  acceptance: {
    source: string;
    steps: SupervisorAcceptanceStep[];
  };
}

export interface SupervisorRunnerStatusSnapshot {
  enabled: boolean;
  ownerId: string;
  maxConcurrency: number;
  activeTicks: number;
  activeLeases: number;
  queuedCandidates: number;
  lastSweepAtMs: number | null;
  lastSweepDriven: number;
  leases?: Array<{ taskId: string; ownerId: string; expiresAtMs: number }>;
}

export interface SupervisorWorkerDescriptor {
  backendId: string;
  source: string;
  taskCapabilities: string[];
  control: string[];
  models: string[];
}

export type SupervisorCredentialStatus =
  | "missing"
  | "configured"
  | "validated"
  | "expired"
  | "invalid";

export interface SupervisorWorkerHealthRow {
  backendId: string;
  recommendedPolicy: string;
  recommendedPlacement: string;
  identity: {
    policy: string;
    status: SupervisorCredentialStatus;
    credentialId?: string;
  };
  placement: {
    available: boolean;
    executor: "gateway" | "node_agent" | null;
    reason?: string;
  };
  auth: {
    installed: boolean;
    authenticated: boolean;
    status: SupervisorCredentialStatus;
    source: "probe" | "declared";
    reason?: string;
  };
}

const HEALTH_STATUS_LABELS: Record<SupervisorCredentialStatus, string> = {
  missing: "缺少凭证",
  configured: "已声明",
  validated: "凭证有效",
  expired: "凭证过期",
  invalid: "凭证无效",
};

/** Gateway probe/placement reasons are English in backend; normalize for zh-CN UI. */
const HEALTH_REASON_LABELS: Record<string, string> = {
  "no binding": "尚未绑定本机 Node",
  "Credential missing or invalid": "缺少或无效的凭证",
  "CLI not found on gateway host": "Gateway 宿主机未找到 CLI",
  "CLI command not configured": "未配置 CLI 命令",
  "Gateway CLI probe skipped for non-gateway placement": "非 Gateway 落点，已跳过 CLI 探测",
  "Node Agent placement not available": "Node Agent 落点不可用",
  "Local IDE login requires Node Agent on the employee workstation":
    "本地 IDE 登录需在本机启用 Node Agent",
  "Node Agent worker probe failed": "Node Agent Worker 探测失败",
};

const WORKER_LABELS: Record<string, string> = {
  "cursor-cli": "Cursor CLI",
  "devin-cli": "Devin CLI",
  "windsurf-cli": "Windsurf CLI",
  "codex-cli": "Codex CLI",
  "trae-cli": "TraeCode CLI",
  "claude-cli": "Claude CLI",
  "kiro-cli": "Kiro CLI",
  "grok-cli": "Grok CLI",
};

export function localizeSupervisorHealthReason(reason: string | undefined): string | undefined {
  const trimmed = reason?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (HEALTH_REASON_LABELS[trimmed]) {
    return HEALTH_REASON_LABELS[trimmed];
  }
  const offlineMatch = /^Node Agent "(.+)" is offline$/.exec(trimmed);
  if (offlineMatch) {
    return `Node Agent「${offlineMatch[1]}」离线`;
  }
  const undeclaredMatch = /^Node Agent "(.+)" does not declare (.+)$/.exec(trimmed);
  if (undeclaredMatch) {
    return `Node Agent「${undeclaredMatch[1]}」未声明 ${undeclaredMatch[2]}`;
  }
  const unavailableForWorkerMatch =
    /^Node Agent placement is not available for worker "(.+)"$/.exec(trimmed);
  if (unavailableForWorkerMatch) {
    return `${formatSupervisorWorkerLabel(unavailableForWorkerMatch[1] ?? "")} 暂不可在本机 Node 执行`;
  }
  return trimmed;
}

export function formatSupervisorWorkerLabel(backendId: string): string {
  const normalized = backendId.trim().toLowerCase();
  return WORKER_LABELS[normalized] ?? backendId;
}

export function formatWorkerHealthSummary(row: SupervisorWorkerHealthRow): string {
  const statusLabel = HEALTH_STATUS_LABELS[row.auth.status] ?? row.auth.status;
  if (row.auth.authenticated && !row.placement.available) {
    if (row.auth.reason?.trim()) {
      return row.auth.reason.trim();
    }
    const placementNote = localizeSupervisorHealthReason(row.placement.reason);
    return placementNote
      ? `本机已登录；${placementNote}，监督任务暂不可执行`
      : "本机已登录；执行落点不可用，监督任务暂不可执行";
  }
  if (!row.placement.available) {
    return localizeSupervisorHealthReason(row.placement.reason) ?? "执行落点不可用";
  }
  if (row.auth.authenticated) {
    return statusLabel;
  }
  return localizeSupervisorHealthReason(row.auth.reason) ?? statusLabel;
}

/** Connected node summary from `supervisor.node.list` (M5). */
export interface SupervisorNodeSessionSummary {
  nodeId: string;
  online: true;
  displayName?: string;
  platform?: string;
  version?: string;
  connectedAtMs: number;
  supervisorWorkerCommands: string[];
  supportsSupervisorWorker: boolean;
}

/** Tenant seat → node binding from `supervisor.node.bindings.list` (M5). */
export interface SupervisorNodeSeatBinding {
  tenantId: string;
  seatId: string;
  nodeId: string;
  updatedAt: string;
}

export type SupervisorNodeBindingRequestStatus = "pending" | "approved" | "rejected";

export interface SupervisorNodeBindingRequest {
  requestId: string;
  tenantId: string;
  seatId: string;
  userId?: string;
  nodeId: string;
  nodeDisplayName?: string;
  status: SupervisorNodeBindingRequestStatus;
  requestedAt: string;
  updatedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
}

/** Workers that run on the employee's Mac via Node Agent. */
export const LOCAL_IDE_SUPERVISOR_WORKER_IDS = [
  "cursor-cli",
  "devin-cli",
  "windsurf-cli",
  "grok-cli",
  "kiro-cli",
  "trae-cli",
] as const;

export function isLocalIdeSupervisorWorker(backendId: string): boolean {
  return LOCAL_IDE_SUPERVISOR_WORKER_IDS.includes(
    backendId.trim().toLowerCase() as (typeof LOCAL_IDE_SUPERVISOR_WORKER_IDS)[number],
  );
}

/** Mirrors gateway `defaultWorkerExecutionProfile` for UI display. */
export function defaultSupervisorWorkerProfile(workerId: string): {
  credentialPolicy: string;
  executionPlacement: string;
} {
  if (isLocalIdeSupervisorWorker(workerId)) {
    return { credentialPolicy: "local_ide_login", executionPlacement: "node_agent" };
  }
  return { credentialPolicy: "enterprise_shared", executionPlacement: "gateway" };
}

export type SupervisorWorkerExecutionPolicy = {
  tenantId: string;
  workerId: string;
  credentialPolicy: string;
  executionPlacement: string;
  updatedAt: string;
};

export const SUPERVISOR_CREDENTIAL_POLICY_OPTIONS = [
  { value: "enterprise_shared", label: "企业共享 API Key（Gateway）" },
  { value: "local_ide_login", label: "本机 IDE 登录（Node Agent）" },
] as const;

export const SUPERVISOR_PLACEMENT_OPTIONS = [
  { value: "gateway", label: "Gateway 宿主机" },
  { value: "node_agent", label: "Node Agent（员工 Mac）" },
] as const;

/** P0-2: in-progress →「第 i/max 轮」; terminal →「已用 N 轮 · 上限 max」. */
export function formatSupervisorIterationProgress(input: {
  state: string;
  usedRounds: number;
  maxIterations: number;
}): string {
  const max = Math.max(0, Math.floor(input.maxIterations) || 0);
  const used = Math.max(0, Math.floor(input.usedRounds) || 0);
  if (isTerminalSupervisorState(input.state)) {
    return `已用 ${used} 轮 · 上限 ${max}`;
  }
  const current = used === 0 ? 1 : used;
  return `第 ${current}/${max} 轮`;
}

/** P1-2: stage chips aligned with engine states. */
export type SupervisorStageChip = {
  id: string;
  label: string;
  tone: "active" | "warn" | "ok" | "danger" | "muted" | "neutral";
};

export function resolveSupervisorStageChip(state: string): SupervisorStageChip {
  switch (state) {
    case "executing":
    case "dispatched":
      return { id: "executing", label: "执行中", tone: "active" };
    case "validating":
      return { id: "validating", label: "验证中", tone: "active" };
    case "fixing":
      return { id: "fixing", label: "修复中", tone: "warn" };
    case "planned":
      return { id: "needs-you", label: "Needs You", tone: "warn" };
    case "accepted":
      return { id: "accepted", label: "已通过", tone: "ok" };
    case "escalated":
      return { id: "escalated", label: "已升级 · Needs You", tone: "danger" };
    case "budget_exhausted":
    case "max_iterations":
    case "timed_out":
    case "aborted":
    case "failed":
      return {
        id: state,
        label: SUPERVISOR_STATE_LABELS[state as SupervisedTaskState] ?? state,
        tone: "muted",
      };
    default:
      return { id: "unknown", label: formatSupervisorState(state), tone: "neutral" };
  }
}

/** Gateway write/admin scopes required for supervisor.task.create / abort. */
export function canCreateSupervisorTask(scopes: readonly string[] | undefined): boolean {
  if (!scopes?.length) {
    return false;
  }
  return scopes.includes("operator.write") || scopes.includes("operator.admin");
}

/** Enterprise port: only enterprise-admin may change supervisor policy / seat bindings. */
export function canEditEnterpriseSupervisorPolicy(
  membershipRole: string | null | undefined,
): boolean {
  return membershipRole === "enterprise-admin";
}

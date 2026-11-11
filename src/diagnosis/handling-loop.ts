import { randomUUID } from "node:crypto";
/**
 * First verifiable diagnosis handling loop: resume a paused tenant
 * diagnosis job through the existing controlled interface.
 *
 * Isolation-only execution. Default and production paths refuse execute.
 * Does not call Doctor --fix, Channel restart, config writes, Skill
 * install/disable, privilege expansion, or self-evolution.
 * DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED is never enabled here.
 */
import os from "node:os";
import path from "node:path";
import { PRODUCTION_EXECUTION_MODE_ENV } from "../agents/sandbox/production-execution-mode.js";
import { isDiagnosisJobPaused } from "./diagnosis-job-store.js";
import {
  describeDiagnosisJob,
  pauseDiagnosisJob,
  resumeDiagnosisJob,
  type DiagnosisJobCaller,
} from "./diagnosis-job.js";
import {
  createMemoryHandlingStore,
  createTenantFileHandlingStore,
  type HandlingStore,
} from "./handling-loop-store.js";

export const DIAGNOSIS_HANDLING_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_HANDLING_SCENARIO_ID = "diagnosis_job_paused" as const;
export const DIAGNOSIS_HANDLING_ISOLATION_ENV = "OPENBOT_DIAGNOSIS_HANDLING_ISOLATION" as const;
export const DIAGNOSIS_HANDLING_EXECUTION_INTERFACE = "diagnosis.job.resume" as const;
export const DIAGNOSIS_HANDLING_RECOVERY_INTERFACE = "diagnosis.job.pause" as const;
export const DIAGNOSIS_HANDLING_EVIDENCE_INTERFACE = "diagnosis.job.describe" as const;
export const DIAGNOSIS_HANDLING_RECHECK_STANDARD =
  "binding exists, approved target identity matches, and explicit runnability evidence is present (binding.paused === false and a new run is not refused with paused_blocks_new_run)" as const;

export const HANDLING_STATES = [
  "pending_approval",
  "pending_execution",
  "executing",
  "executed_pending_recheck",
  "resolved",
  "rejected",
  "cancelled",
  "execution_failed",
  "result_unverified",
] as const;
export type HandlingState = (typeof HANDLING_STATES)[number];

export const HANDLING_STATE_LABELS: Record<HandlingState, string> = {
  pending_approval: "待审批",
  pending_execution: "待执行",
  executing: "执行中",
  executed_pending_recheck: "已执行待复核",
  resolved: "已解决",
  rejected: "已拒绝",
  cancelled: "已取消",
  execution_failed: "执行失败",
  result_unverified: "结果待核实",
};

export type HandlingRegistrationPath = "production" | "isolation";
export type HandlingRunnability = "runnable" | "blocked" | "unknown";

const READ_SCOPES = new Set([
  "operator.read",
  "operator.write",
  "operator.admin",
  "operator.approvals",
]);
const WRITE_SCOPES = new Set(["operator.write", "operator.admin"]);
const APPROVAL_SCOPES = new Set(["operator.approvals", "operator.admin"]);
const TERMINAL_NO_EXECUTE = new Set<HandlingState>([
  "executed_pending_recheck",
  "resolved",
  "rejected",
  "cancelled",
  "execution_failed",
  "result_unverified",
  "executing",
]);

export type HandlingActor = {
  operatorId: string;
  tenantId: string;
  claimedTenantId?: string | null;
  platformOperator?: boolean;
  scopes: readonly string[];
};

export type HandlingJobEvidence = {
  interfaceId: typeof DIAGNOSIS_HANDLING_EVIDENCE_INTERFACE;
  paused: boolean;
  pausedAt: string | null;
  cadence: string;
  definitionId: string | null;
  bindingId: string | null;
  bindingUpdatedAt: string | null;
  bindingPresent: boolean;
  runnability: HandlingRunnability;
  runBlockedReason?: string;
  runnabilityReason?: string;
};

export type HandlingAdminView = {
  whatHappened: string;
  whoIsAffected: string;
  suggestedHandling: string;
  whoCanApprove: string;
  currentStep: string;
  howToConfirmRecovery: string;
};

export type HandlingDetails = {
  scenarioId: typeof DIAGNOSIS_HANDLING_SCENARIO_ID;
  handlingId?: string;
  issueId?: string;
  reportId?: string | null;
  tenantId: string;
  target?: HandlingRecord["target"];
  idempotencyKey?: string;
  status?: HandlingState;
  failureReason?: string;
  evidence?: HandlingJobEvidence;
  execution?: HandlingRecord["execution"];
  recheck?: HandlingRecord["recheck"];
};

export type HandlingRecord = {
  schemaVersion: 1;
  handlingId: string;
  scenarioId: typeof DIAGNOSIS_HANDLING_SCENARIO_ID;
  reportId: string | null;
  issueId: string;
  tenantId: string;
  target: {
    kind: "diagnosis_job";
    definitionId: string | null;
    bindingId: string | null;
    bindingPausedAt: string | null;
    bindingUpdatedAt: string | null;
  };
  operator: {
    submitterId: string;
    approverId?: string;
    executorId?: string;
    rejectedBy?: string;
    cancelledBy?: string;
  };
  idempotencyKey: string;
  status: HandlingState;
  preview: {
    expectedEffect: string;
    executionInterface: typeof DIAGNOSIS_HANDLING_EXECUTION_INTERFACE;
    recoveryInterface: typeof DIAGNOSIS_HANDLING_RECOVERY_INTERFACE;
    evidenceInterface: typeof DIAGNOSIS_HANDLING_EVIDENCE_INTERFACE;
    before: HandlingJobEvidence;
    expectedAfter: { paused: false; pausedAt: null };
  };
  execution?: {
    taskId: string;
    receipt: Record<string, unknown>;
    startedAt: string;
    finishedAt?: string;
    applied: boolean;
    effectUncertain?: boolean;
  };
  recheck?: {
    at: string;
    before: HandlingJobEvidence;
    after: HandlingJobEvidence;
    standard: string;
    met: boolean;
  };
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type HandlingCommandResult = {
  ok: boolean;
  reason?: string;
  record?: HandlingRecord;
  preview?: HandlingPreview;
  admin?: HandlingAdminView;
  details?: HandlingDetails;
};

export type HandlingPreview = {
  actionable: boolean;
  reason?: string;
  tenantId: string;
  issueId: string;
  suggestedIdempotencyKey: string;
  evidence: HandlingJobEvidence;
  admin: HandlingAdminView;
};

export type HandlingLoopOptions = {
  store?: HandlingStore;
  configDir: string;
  /** Test/isolation hook. Live pack must leave this false. */
  isolation?: boolean;
  /** Production registration path always refuses execute and the isolation switch. */
  registrationPath?: HandlingRegistrationPath;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  resume?: typeof resumeDiagnosisJob;
  describe?: typeof describeDiagnosisJob;
};

export type DiagnosisHandlingLoop = {
  preview(actor: HandlingActor): HandlingCommandResult;
  submit(input: {
    actor: HandlingActor;
    idempotencyKey?: string;
    reportId?: string | null;
  }): HandlingCommandResult;
  approve(input: { actor: HandlingActor; handlingId: string }): HandlingCommandResult;
  reject(input: { actor: HandlingActor; handlingId: string }): HandlingCommandResult;
  cancel(input: { actor: HandlingActor; handlingId: string }): HandlingCommandResult;
  execute(input: { actor: HandlingActor; handlingId: string }): HandlingCommandResult;
  recheck(input: { actor: HandlingActor; handlingId: string }): HandlingCommandResult;
  get(input: { actor: HandlingActor; handlingId: string }): HandlingCommandResult;
  list(input: { actor: HandlingActor }): HandlingCommandResult & { records: HandlingRecord[] };
  close(): void;
};

export function handlingStateLabel(status: HandlingState): string {
  return HANDLING_STATE_LABELS[status];
}

export function buildHandlingAdminView(input: {
  tenantId: string;
  status?: HandlingState | null;
  actionable?: boolean;
}): HandlingAdminView {
  const step = input.status
    ? handlingStateLabel(input.status)
    : input.actionable === false
      ? "无需处理"
      : "尚未立案";
  return {
    whatHappened:
      "该租户的诊断定时任务已暂停，新的巡检运行无法启动。管理员主动暂停并不必然是故障，恢复前须由管理员确认。",
    whoIsAffected: `租户 ${input.tenantId} 的诊断定时任务及其待执行的巡检。`,
    suggestedHandling:
      "请管理员确认需要恢复后，经授权调用已有受控接口 diagnosis.job.resume；如需回退，可调用 diagnosis.job.pause。",
    whoCanApprove: "持有 operator.approvals 或 operator.admin 的管理员。",
    currentStep: step,
    howToConfirmRecovery:
      "执行后重新采集同一对象的 diagnosis.job.describe 证据；仅当 binding 仍存在、目标身份一致，并取得明确的可运行性证据（binding.paused 为 false，且新运行不再因 paused_blocks_new_run 被拒绝）时，标记为已解决。证据缺失时保持结果待核实。",
  };
}

export function isDiagnosisHandlingIsolationBoundary(input: {
  configDir?: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const configDir = input.configDir?.trim();
  if (!configDir) {
    return false;
  }
  const resolved = path.resolve(configDir);
  const roots = [path.resolve(os.tmpdir())];
  const extra = input.env?.OPENBOT_DIAGNOSIS_HANDLING_ISOLATION_DIR;
  if (typeof extra === "string" && extra.trim()) {
    roots.push(path.resolve(extra));
  }
  return roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

export function resolveHandlingRegistrationPath(input: {
  registrationPath?: HandlingRegistrationPath;
  isolation?: boolean;
}): HandlingRegistrationPath {
  if (input.registrationPath) {
    return input.registrationPath;
  }
  return input.isolation === true ? "isolation" : "production";
}

export function isDiagnosisHandlingExecuteOpen(input: {
  isolation?: boolean;
  env?: NodeJS.ProcessEnv;
  registrationPath?: HandlingRegistrationPath;
  configDir?: string;
}): boolean {
  const env = input.env ?? process.env;
  const registrationPath = resolveHandlingRegistrationPath(input);
  // Production registration path must explicitly refuse the isolation switch.
  // The env var alone must never open execute, including when production mode is unset.
  if (registrationPath === "production") {
    return false;
  }
  if (env[PRODUCTION_EXECUTION_MODE_ENV] === "production") {
    return false;
  }
  if (input.isolation !== true) {
    return false;
  }
  return isDiagnosisHandlingIsolationBoundary({ configDir: input.configDir, env });
}

function hasAnyScope(actor: HandlingActor, allowed: Set<string>): boolean {
  return actor.scopes.some((scope) => allowed.has(scope));
}

function issueIdFor(tenantId: string): string {
  return `issue:${DIAGNOSIS_HANDLING_SCENARIO_ID}:${tenantId}`;
}

function jobCaller(actor: HandlingActor): DiagnosisJobCaller {
  return {
    membershipTenantId: actor.tenantId,
    claimedTenantId: actor.claimedTenantId ?? null,
    platformOperator: actor.platformOperator === true,
  };
}

function assessRunnability(input: {
  bindingPresent: boolean;
  paused: boolean;
  definitionId: string | null;
  bindingDefinitionId: string | null;
  runBlockedReason?: string;
}): { runnability: HandlingRunnability; runnabilityReason?: string } {
  if (!input.bindingPresent) {
    return { runnability: "unknown", runnabilityReason: "binding_missing" };
  }
  if (!input.definitionId || !input.bindingDefinitionId) {
    return { runnability: "unknown", runnabilityReason: "definition_missing" };
  }
  if (input.definitionId !== input.bindingDefinitionId) {
    return { runnability: "unknown", runnabilityReason: "definition_binding_mismatch" };
  }
  if (input.paused || input.runBlockedReason === "paused_blocks_new_run") {
    return { runnability: "blocked", runnabilityReason: "paused_blocks_new_run" };
  }
  return { runnability: "runnable" };
}

function evidenceFromDescribe(
  described: ReturnType<typeof describeDiagnosisJob>,
  runBlockedReason?: string,
): HandlingJobEvidence | { ok: false; reason: string } {
  if (!described.ok) {
    return { ok: false, reason: described.reason ?? "describe_failed" };
  }
  const binding = described.binding;
  const definition = described.definition;
  const bindingPresent = Boolean(binding);
  const paused = bindingPresent && binding?.paused === true;
  const definitionId = definition?.definitionId ?? binding?.definitionId ?? null;
  const assessed = assessRunnability({
    bindingPresent,
    paused,
    definitionId: definition?.definitionId ?? null,
    bindingDefinitionId: binding?.definitionId ?? null,
    runBlockedReason:
      paused || runBlockedReason === "paused_blocks_new_run"
        ? "paused_blocks_new_run"
        : runBlockedReason,
  });
  return {
    interfaceId: DIAGNOSIS_HANDLING_EVIDENCE_INTERFACE,
    paused,
    pausedAt: binding?.pausedAt ?? null,
    cadence: described.cadence,
    definitionId,
    bindingId: binding?.bindingId ?? null,
    bindingUpdatedAt: binding?.updatedAt ?? null,
    bindingPresent,
    runnability: assessed.runnability,
    ...(assessed.runnabilityReason ? { runnabilityReason: assessed.runnabilityReason } : {}),
    ...(paused || runBlockedReason
      ? { runBlockedReason: runBlockedReason ?? "paused_blocks_new_run" }
      : {}),
  };
}

function targetIdentityMatches(
  target: HandlingRecord["target"],
  evidence: HandlingJobEvidence,
): boolean {
  return (
    evidence.bindingPresent &&
    evidence.bindingId != null &&
    evidence.definitionId != null &&
    evidence.bindingId === target.bindingId &&
    evidence.definitionId === target.definitionId
  );
}

function targetVersionMatches(
  target: HandlingRecord["target"],
  evidence: HandlingJobEvidence,
): boolean {
  return (
    evidence.pausedAt === target.bindingPausedAt &&
    evidence.bindingUpdatedAt === target.bindingUpdatedAt
  );
}

function recheckEvidenceMissing(
  evidence: HandlingJobEvidence,
  target: HandlingRecord["target"],
): string | null {
  if (!evidence.bindingPresent) {
    return "recheck_binding_missing";
  }
  if (evidence.runnability === "unknown") {
    return evidence.runnabilityReason ?? "recheck_evidence_missing";
  }
  if (!targetIdentityMatches(target, evidence)) {
    return "recheck_target_mismatch";
  }
  return null;
}

function recheckStandardMet(
  target: HandlingRecord["target"],
  evidence: HandlingJobEvidence,
): boolean {
  return (
    recheckEvidenceMissing(evidence, target) == null &&
    evidence.runnability === "runnable" &&
    !evidence.paused &&
    evidence.runBlockedReason !== "paused_blocks_new_run"
  );
}

function detailsFrom(record: HandlingRecord, evidence?: HandlingJobEvidence): HandlingDetails {
  return {
    scenarioId: record.scenarioId,
    handlingId: record.handlingId,
    issueId: record.issueId,
    reportId: record.reportId,
    tenantId: record.tenantId,
    target: record.target,
    idempotencyKey: record.idempotencyKey,
    status: record.status,
    failureReason: record.failureReason,
    evidence,
    execution: record.execution,
    recheck: record.recheck,
  };
}

function okResult(
  record: HandlingRecord,
  extra?: Partial<HandlingCommandResult>,
): HandlingCommandResult {
  return {
    ok: true,
    record,
    admin: buildHandlingAdminView({ tenantId: record.tenantId, status: record.status }),
    details: detailsFrom(record),
    ...extra,
  };
}

function fail(
  reason: string,
  actor: HandlingActor,
  record?: HandlingRecord,
  extra?: Partial<HandlingCommandResult>,
): HandlingCommandResult {
  return {
    ok: false,
    reason,
    record,
    admin: buildHandlingAdminView({
      tenantId: actor.tenantId,
      status: record?.status,
      actionable: Boolean(record) || extra?.preview?.actionable,
    }),
    details: record
      ? detailsFrom(record)
      : {
          scenarioId: DIAGNOSIS_HANDLING_SCENARIO_ID,
          tenantId: actor.tenantId,
          failureReason: reason,
        },
    ...extra,
  };
}

function persistRecord(
  store: HandlingStore,
  row: HandlingRecord,
): { ok: true; record: HandlingRecord } | { ok: false; record: HandlingRecord; reason: string } {
  try {
    return { ok: true, record: store.put(row) };
  } catch (error) {
    return {
      ok: false,
      record: row,
      reason: error instanceof Error ? error.message : "persist_failed",
    };
  }
}

export function createDiagnosisHandlingLoop(options: HandlingLoopOptions): DiagnosisHandlingLoop {
  const store = options.store ?? createTenantFileHandlingStore(options.configDir);
  const now = options.now ?? (() => new Date().toISOString());
  const describe = options.describe ?? describeDiagnosisJob;
  const resume = options.resume ?? resumeDiagnosisJob;
  const configDir = options.configDir;
  const registrationPath = resolveHandlingRegistrationPath(options);
  const env = options.env;

  const collectEvidence = (
    actor: HandlingActor,
  ): { ok: true; evidence: HandlingJobEvidence } | { ok: false; reason: string } => {
    const described = describe({ caller: jobCaller(actor), configDir });
    if (!described.ok) {
      return { ok: false, reason: described.reason ?? "describe_failed" };
    }
    const pausedOnDisk = isDiagnosisJobPaused(actor.tenantId, configDir);
    const runBlockedReason =
      described.binding?.paused || pausedOnDisk ? "paused_blocks_new_run" : undefined;
    const collected = evidenceFromDescribe(described, runBlockedReason);
    if ("ok" in collected) {
      return collected;
    }
    return { ok: true, evidence: collected };
  };

  const preview = (actor: HandlingActor): HandlingCommandResult => {
    if (!hasAnyScope(actor, READ_SCOPES)) {
      return fail("unauthorized", actor);
    }
    const evidence = collectEvidence(actor);
    if (!evidence.ok) {
      return fail(evidence.reason, actor);
    }
    const ev = evidence.evidence;
    const actionable =
      ev.paused && ev.bindingPresent && ev.bindingId != null && ev.definitionId != null;
    const suggestedIdempotencyKey = `${DIAGNOSIS_HANDLING_SCENARIO_ID}:${actor.tenantId}:${ev.pausedAt ?? "not-paused"}:${ev.bindingId ?? "no-binding"}`;
    const previewBody: HandlingPreview = {
      actionable,
      reason: actionable ? undefined : ev.bindingPresent ? "job_not_paused" : "job_binding_missing",
      tenantId: actor.tenantId,
      issueId: issueIdFor(actor.tenantId),
      suggestedIdempotencyKey,
      evidence: ev,
      admin: buildHandlingAdminView({
        tenantId: actor.tenantId,
        actionable,
      }),
    };
    if (!actionable) {
      previewBody.admin = {
        ...previewBody.admin,
        whatHappened: ev.bindingPresent
          ? "当前未发现已暂停的诊断定时任务。"
          : "当前未找到该租户的诊断定时任务 binding，无法把缺失当成已恢复。",
        suggestedHandling: "没有可执行的恢复接口；如需补证，请重新检查所选对象或转交负责人。",
        currentStep: "无需处理",
      };
    }
    return {
      ok: true,
      preview: previewBody,
      admin: previewBody.admin,
      details: {
        scenarioId: DIAGNOSIS_HANDLING_SCENARIO_ID,
        issueId: previewBody.issueId,
        tenantId: actor.tenantId,
        idempotencyKey: suggestedIdempotencyKey,
        evidence: ev,
      },
    };
  };

  const loadOwned = (actor: HandlingActor, handlingId: string): HandlingRecord | undefined => {
    const row =
      store.get(handlingId) ??
      store.list({ tenantId: actor.tenantId }).find((item) => item.handlingId === handlingId);
    if (!row || row.tenantId !== actor.tenantId) {
      return undefined;
    }
    return row;
  };

  const putOrFail = (
    actor: HandlingActor,
    next: HandlingRecord,
    previous?: HandlingRecord,
  ): HandlingCommandResult => {
    const persisted = persistRecord(store, next);
    if (!persisted.ok) {
      return fail("persist_failed", actor, previous ?? next);
    }
    return okResult(persisted.record);
  };

  return {
    preview,
    submit(input) {
      if (!hasAnyScope(input.actor, WRITE_SCOPES)) {
        return fail("unauthorized", input.actor);
      }
      const previewed = preview(input.actor);
      if (!previewed.ok || !previewed.preview) {
        return previewed;
      }
      if (!previewed.preview.actionable) {
        return fail("no_actionable_issue", input.actor, undefined, { preview: previewed.preview });
      }
      const key = input.idempotencyKey?.trim() || previewed.preview.suggestedIdempotencyKey;
      const existing = store.getByIdempotency(input.actor.tenantId, key);
      if (existing) {
        return okResult(existing, { preview: previewed.preview });
      }
      const ev = previewed.preview.evidence;
      const at = now();
      const record: HandlingRecord = {
        schemaVersion: 1,
        handlingId: `hdl-${randomUUID()}`,
        scenarioId: DIAGNOSIS_HANDLING_SCENARIO_ID,
        reportId: input.reportId ?? null,
        issueId: previewed.preview.issueId,
        tenantId: input.actor.tenantId,
        target: {
          kind: "diagnosis_job",
          definitionId: ev.definitionId,
          bindingId: ev.bindingId,
          bindingPausedAt: ev.pausedAt,
          bindingUpdatedAt: ev.bindingUpdatedAt,
        },
        operator: { submitterId: input.actor.operatorId },
        idempotencyKey: key,
        status: "pending_approval",
        preview: {
          expectedEffect: "恢复租户诊断定时任务，使新的巡检运行可以创建。",
          executionInterface: DIAGNOSIS_HANDLING_EXECUTION_INTERFACE,
          recoveryInterface: DIAGNOSIS_HANDLING_RECOVERY_INTERFACE,
          evidenceInterface: DIAGNOSIS_HANDLING_EVIDENCE_INTERFACE,
          before: ev,
          expectedAfter: { paused: false, pausedAt: null },
        },
        createdAt: at,
        updatedAt: at,
      };
      const submitted = persistRecord(store, record);
      if (!submitted.ok) {
        return fail("persist_failed", input.actor);
      }
      return okResult(submitted.record, { preview: previewed.preview });
    },
    approve(input) {
      if (!hasAnyScope(input.actor, APPROVAL_SCOPES)) {
        return fail("authorization_revoked", input.actor, loadOwned(input.actor, input.handlingId));
      }
      const record = loadOwned(input.actor, input.handlingId);
      if (!record) {
        return fail("not_found", input.actor);
      }
      if (record.status !== "pending_approval") {
        return fail("invalid_status", input.actor, record);
      }
      const next: HandlingRecord = {
        ...record,
        status: "pending_execution",
        operator: { ...record.operator, approverId: input.actor.operatorId },
        updatedAt: now(),
      };
      return putOrFail(input.actor, next, record);
    },
    reject(input) {
      if (!hasAnyScope(input.actor, APPROVAL_SCOPES)) {
        return fail("authorization_revoked", input.actor, loadOwned(input.actor, input.handlingId));
      }
      const record = loadOwned(input.actor, input.handlingId);
      if (!record) {
        return fail("not_found", input.actor);
      }
      if (record.status !== "pending_approval") {
        return fail("invalid_status", input.actor, record);
      }
      const next: HandlingRecord = {
        ...record,
        status: "rejected",
        operator: { ...record.operator, rejectedBy: input.actor.operatorId },
        updatedAt: now(),
      };
      return putOrFail(input.actor, next, record);
    },
    cancel(input) {
      if (!hasAnyScope(input.actor, WRITE_SCOPES)) {
        return fail("authorization_revoked", input.actor, loadOwned(input.actor, input.handlingId));
      }
      const record = loadOwned(input.actor, input.handlingId);
      if (!record) {
        return fail("not_found", input.actor);
      }
      if (record.status !== "pending_approval" && record.status !== "pending_execution") {
        return fail("invalid_status", input.actor, record);
      }
      const next: HandlingRecord = {
        ...record,
        status: "cancelled",
        operator: { ...record.operator, cancelledBy: input.actor.operatorId },
        updatedAt: now(),
      };
      return putOrFail(input.actor, next, record);
    },
    execute(input) {
      const record = loadOwned(input.actor, input.handlingId);
      if (!record) {
        return fail("not_found", input.actor);
      }
      if (!hasAnyScope(input.actor, WRITE_SCOPES)) {
        return fail("authorization_revoked", input.actor, record);
      }
      if (record.status === "executing" || TERMINAL_NO_EXECUTE.has(record.status)) {
        if (record.status === "pending_approval") {
          return fail("invalid_status", input.actor, record);
        }
        return okResult(record, { reason: "already_executed" });
      }
      if (record.status !== "pending_execution") {
        return fail("invalid_status", input.actor, record);
      }
      if (
        !isDiagnosisHandlingExecuteOpen({
          isolation: options.isolation,
          env,
          registrationPath,
          configDir,
        })
      ) {
        const isolationAttempt =
          registrationPath === "isolation" &&
          options.isolation === true &&
          env?.[PRODUCTION_EXECUTION_MODE_ENV] !== "production";
        return fail(
          isolationAttempt ? "isolation_boundary_unverified" : "production_repair_closed",
          input.actor,
          record,
        );
      }
      const current = collectEvidence(input.actor);
      if (
        !current.ok ||
        !targetIdentityMatches(record.target, current.evidence) ||
        !targetVersionMatches(record.target, current.evidence)
      ) {
        return fail("approved_target_conflict", input.actor, record, {
          details: detailsFrom(record, current.ok ? current.evidence : undefined),
        });
      }
      const startedAt = now();
      const executing: HandlingRecord = {
        ...record,
        status: "executing",
        operator: { ...record.operator, executorId: input.actor.operatorId },
        execution: {
          taskId: `task-${record.handlingId}`,
          receipt: { accepted: true },
          startedAt,
          applied: false,
        },
        updatedAt: startedAt,
      };
      const started = persistRecord(store, executing);
      if (!started.ok) {
        return fail("persist_failed", input.actor, record);
      }
      const markUnverified = (
        receipt: Record<string, unknown>,
        failureReason: string,
        applied: boolean,
      ): HandlingCommandResult => {
        const finishedAt = now();
        const unverified: HandlingRecord = {
          ...executing,
          status: "result_unverified",
          failureReason,
          execution: {
            taskId: executing.execution!.taskId,
            receipt: { ...receipt, mayHaveTakenEffect: true },
            startedAt,
            finishedAt,
            applied,
            effectUncertain: true,
          },
          updatedAt: finishedAt,
        };
        const persisted = persistRecord(store, unverified);
        return okResult(persisted.ok ? persisted.record : unverified);
      };
      try {
        const receipt = resume({ caller: jobCaller(input.actor), configDir });
        const finishedAt = now();
        if (!receipt.ok) {
          const failed: HandlingRecord = {
            ...executing,
            status: "execution_failed",
            failureReason: receipt.reason ?? "resume_failed",
            execution: {
              taskId: executing.execution!.taskId,
              receipt: { ...receipt },
              startedAt,
              finishedAt,
              applied: false,
            },
            updatedAt: finishedAt,
          };
          return putOrFail(input.actor, failed, executing);
        }
        const done: HandlingRecord = {
          ...executing,
          status: "executed_pending_recheck",
          failureReason: undefined,
          execution: {
            taskId: executing.execution!.taskId,
            receipt: {
              ok: true,
              interfaceId: DIAGNOSIS_HANDLING_EXECUTION_INTERFACE,
              paused: receipt.binding.paused,
              definitionId: receipt.definition.definitionId,
              bindingId: receipt.binding.bindingId,
              bindingUpdatedAt: receipt.binding.updatedAt,
            },
            startedAt,
            finishedAt,
            applied: !receipt.binding.paused,
          },
          updatedAt: finishedAt,
        };
        const persisted = persistRecord(store, done);
        if (!persisted.ok) {
          return markUnverified(
            {
              ok: true,
              interfaceId: DIAGNOSIS_HANDLING_EXECUTION_INTERFACE,
              paused: receipt.binding.paused,
              definitionId: receipt.definition.definitionId,
              bindingId: receipt.binding.bindingId,
              bindingUpdatedAt: receipt.binding.updatedAt,
              persistFailed: true,
            },
            "persist_failed_after_effect",
            !receipt.binding.paused,
          );
        }
        return okResult(persisted.record);
      } catch (error) {
        return markUnverified(
          { ok: false, error: "executor_threw" },
          error instanceof Error ? error.message : "resume_threw",
          false,
        );
      }
    },
    recheck(input) {
      if (!hasAnyScope(input.actor, READ_SCOPES) && !hasAnyScope(input.actor, WRITE_SCOPES)) {
        return fail("unauthorized", input.actor);
      }
      const record = loadOwned(input.actor, input.handlingId);
      if (!record) {
        return fail("not_found", input.actor);
      }
      if (
        record.status !== "executed_pending_recheck" &&
        record.status !== "result_unverified" &&
        record.status !== "execution_failed"
      ) {
        return fail("invalid_status", input.actor, record);
      }
      const evidence = collectEvidence(input.actor);
      if (!evidence.ok) {
        const next: HandlingRecord = {
          ...record,
          status: "result_unverified",
          failureReason: evidence.reason,
          updatedAt: now(),
        };
        return putOrFail(input.actor, next, record);
      }
      const after = evidence.evidence;
      const missing = recheckEvidenceMissing(after, record.target);
      const met = missing == null && recheckStandardMet(record.target, after);
      const at = now();
      const next: HandlingRecord = {
        ...record,
        status: met
          ? "resolved"
          : missing
            ? "result_unverified"
            : record.status === "execution_failed"
              ? "execution_failed"
              : "executed_pending_recheck",
        failureReason: met
          ? undefined
          : (missing ?? record.failureReason ?? "recheck_standard_not_met"),
        recheck: {
          at,
          before: record.preview.before,
          after,
          standard: DIAGNOSIS_HANDLING_RECHECK_STANDARD,
          met,
        },
        updatedAt: at,
      };
      if (!met && record.status === "result_unverified" && !missing) {
        next.status = "result_unverified";
      }
      return putOrFail(input.actor, next, record);
    },
    get(input) {
      if (!hasAnyScope(input.actor, READ_SCOPES)) {
        return fail("unauthorized", input.actor);
      }
      store.reload();
      const record = loadOwned(input.actor, input.handlingId);
      if (!record) {
        return fail("not_found", input.actor);
      }
      return okResult(record);
    },
    list(input) {
      if (!hasAnyScope(input.actor, READ_SCOPES)) {
        return { ...fail("unauthorized", input.actor), records: [] };
      }
      store.reload();
      const records = store
        .list({ tenantId: input.actor.tenantId })
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return {
        ok: true,
        records,
        admin: buildHandlingAdminView({
          tenantId: input.actor.tenantId,
          status: records[0]?.status,
        }),
      };
    },
    close() {
      store.close();
    },
  };
}

export function createMemoryDiagnosisHandlingLoop(
  options: Omit<HandlingLoopOptions, "store"> & { store?: HandlingStore },
): DiagnosisHandlingLoop {
  return createDiagnosisHandlingLoop({
    ...options,
    store: options.store ?? createMemoryHandlingStore(),
  });
}

/** Isolation helper: seed a paused job through the existing pause interface. */
export function seedPausedDiagnosisJob(input: {
  actor: HandlingActor;
  configDir: string;
}): ReturnType<typeof pauseDiagnosisJob> {
  return pauseDiagnosisJob({ caller: jobCaller(input.actor), configDir: input.configDir });
}

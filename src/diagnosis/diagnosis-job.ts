/**
 * M1 Diagnosis Job service.
 *
 * One default JobDefinition per tenant, many JobRuns (capped), and one
 * ScheduleBinding that points at the existing diagnosis-schedules record.
 * Pause blocks new runs. In-flight runs finish. Cancel and kill are refused.
 * Reports are read-only composites over M0 evaluation evidence. diagnose()
 * is not called, and Doctor repair is not invoked.
 */
import { randomUUID } from "node:crypto";
import { CONFIG_DIR } from "../utils.js";
import { listDueDiagnosisSchedules, readDiagnosisSchedule } from "./diagnose-schedule.js";
import type { DiagnosisScheduleRecord } from "./diagnose-schedule.js";
import { readTenantEvaluationEvidence } from "./diagnosis-job-evidence.js";
import {
  DIAGNOSIS_JOB_BINDING_KIND,
  DIAGNOSIS_JOB_DEFINITION_KIND,
  DIAGNOSIS_JOB_RULE_SET_ID,
  DIAGNOSIS_JOB_RULE_VERSION,
  DIAGNOSIS_JOB_RUN_CAP,
  DIAGNOSIS_JOB_SCHEMA_VERSION,
  confirmDiagnosisJobEvolutionPreview,
  diagnosisJobEvidenceAuthorized,
  emptyDiagnosisJobFilter,
  projectDiagnosisJobReport,
  resolveDiagnosisJobTenant,
  type DiagnosisJobCompositeReport,
  type DiagnosisJobDefinition,
  type DiagnosisJobEfficiencyFilter,
  type DiagnosisJobEvidenceRow,
  type DiagnosisJobFailureFilter,
  type DiagnosisJobFilter,
  type DiagnosisJobRefusal,
  type DiagnosisJobRun,
  type DiagnosisScheduleBinding,
} from "./diagnosis-job-model.js";
import {
  deleteDiagnosisJobRun,
  diagnosisJobTenantHash16,
  isDiagnosisJobPaused,
  listDiagnosisJobRuns,
  readDiagnosisJobDefinition,
  readDiagnosisJobReport,
  readDiagnosisJobRun,
  readDiagnosisScheduleBinding,
  unlinkDiagnosisJobReport,
  writeDiagnosisJobDefinition,
  writeDiagnosisJobReport,
  writeDiagnosisJobRun,
  writeDiagnosisScheduleBinding,
} from "./diagnosis-job-store.js";

export { confirmDiagnosisJobEvolutionPreview, DIAGNOSIS_JOB_RUN_CAP };

export type DiagnosisJobCaller = {
  membershipTenantId: string | null | undefined;
  claimedTenantId?: string | null;
  /** Gateway-derived. Request params must not set this. */
  platformOperator?: boolean;
};

export type DiagnosisJobFilterInput = {
  agentId?: string | null;
  agentIds?: readonly string[] | null;
  groupId?: string | null;
  failure?: { enabled?: boolean; minCount?: number | null } | null;
  efficiency?: { maxTotalMs?: number | null; maxTtftMs?: number | null } | null;
};

export function isDiagnosisPlatformOperator(input: {
  sessionDomain?: string;
  sessionKind?: string;
}): boolean {
  return (
    input.sessionDomain === "platform" ||
    input.sessionKind === "platform-admin" ||
    input.sessionKind === "platform-super-admin"
  );
}

type JobContext = {
  ok: true;
  tenantId: string;
  definition: DiagnosisJobDefinition;
  binding: DiagnosisScheduleBinding;
};

export function defaultDiagnosisJobDefinitionId(tenantId: string): string {
  return `djd-${diagnosisJobTenantHash16(tenantId)}`;
}

export function listSchedulesAdmittingNewJobRuns(input: {
  now?: number;
  configDir?: string;
}): DiagnosisScheduleRecord[] {
  const configDir = input.configDir ?? CONFIG_DIR;
  return listDueDiagnosisSchedules({ now: input.now, configDir }).filter(
    (row) => !isDiagnosisJobPaused(row.tenantId, configDir),
  );
}

export function pauseDiagnosisJob(input: {
  caller: DiagnosisJobCaller;
  configDir?: string;
  now?: number;
}):
  | { ok: true; definition: DiagnosisJobDefinition; binding: DiagnosisScheduleBinding }
  | DiagnosisJobRefusal {
  const opened = openContext(input);
  if (!opened.ok) {
    return opened;
  }
  const nowIso = iso(input.now);
  opened.binding.paused = true;
  opened.binding.pausedAt = nowIso;
  opened.binding.updatedAt = nowIso;
  writeDiagnosisScheduleBinding(opened.binding, configDirOf(input.configDir));
  return { ok: true, definition: opened.definition, binding: opened.binding };
}

export function resumeDiagnosisJob(input: {
  caller: DiagnosisJobCaller;
  configDir?: string;
  now?: number;
}):
  | { ok: true; definition: DiagnosisJobDefinition; binding: DiagnosisScheduleBinding }
  | DiagnosisJobRefusal {
  const opened = openContext(input);
  if (!opened.ok) {
    return opened;
  }
  const nowIso = iso(input.now);
  opened.binding.paused = false;
  opened.binding.pausedAt = null;
  opened.binding.updatedAt = nowIso;
  writeDiagnosisScheduleBinding(opened.binding, configDirOf(input.configDir));
  return { ok: true, definition: opened.definition, binding: opened.binding };
}

export function startDiagnosisJobRun(input: {
  caller: DiagnosisJobCaller;
  configDir?: string;
  now?: number;
  filters?: DiagnosisJobFilterInput | null;
  evidenceRows?: readonly DiagnosisJobEvidenceRow[];
  repair?: boolean;
  fix?: boolean;
  /** Leave the run in-flight so pause-during-run tests can finish it later. */
  deferCompletion?: boolean;
}):
  | {
      ok: true;
      definition: DiagnosisJobDefinition;
      binding: DiagnosisScheduleBinding;
      run: DiagnosisJobRun;
      report: DiagnosisJobCompositeReport | null;
    }
  | DiagnosisJobRefusal {
  if (input.repair === true || input.fix === true) {
    return repairRefusal();
  }
  const opened = openContext(input);
  if (!opened.ok) {
    return opened;
  }
  if (opened.binding.paused) {
    return {
      ok: false,
      reason: "paused_blocks_new_run",
      message: "已暂停：不会创建新的 JobRun。已启动的 Run 会继续跑完。",
    };
  }
  const filters = normalizeDiagnosisJobFilters(input.filters);
  if (!filters.ok) {
    return filters;
  }
  const configDir = configDirOf(input.configDir);
  const nowIso = iso(input.now);
  if (input.filters) {
    opened.definition.filters = filters.filter;
    opened.definition.updatedAt = nowIso;
    writeDiagnosisJobDefinition(opened.definition, configDir);
  }
  const slot = reserveRunSlot(opened.tenantId, configDir);
  if (!slot.ok) {
    return slot;
  }
  const run: DiagnosisJobRun = {
    schemaVersion: DIAGNOSIS_JOB_SCHEMA_VERSION,
    kind: "job_run",
    runId: `djr-${randomUUID()}`,
    definitionId: opened.definition.definitionId,
    tenantId: opened.tenantId,
    status: "running",
    filterSnapshot: opened.definition.filters,
    reportId: null,
    startedAt: nowIso,
    finishedAt: null,
  };
  writeDiagnosisJobRun(run, configDir);
  if (input.deferCompletion) {
    return {
      ok: true,
      definition: opened.definition,
      binding: opened.binding,
      run,
      report: null,
    };
  }
  return finishLoadedRun({
    tenantId: opened.tenantId,
    definition: opened.definition,
    binding: opened.binding,
    run,
    configDir,
    now: input.now,
    evidenceRows: input.evidenceRows,
  });
}

export function finishDiagnosisJobRun(input: {
  caller: DiagnosisJobCaller;
  runId: string;
  configDir?: string;
  now?: number;
  evidenceRows?: readonly DiagnosisJobEvidenceRow[];
}):
  | {
      ok: true;
      definition: DiagnosisJobDefinition;
      binding: DiagnosisScheduleBinding;
      run: DiagnosisJobRun;
      report: DiagnosisJobCompositeReport;
    }
  | DiagnosisJobRefusal {
  const access = resolveDiagnosisJobTenant(input.caller);
  if (!access.ok) {
    return access;
  }
  const configDir = configDirOf(input.configDir);
  const definition = readDiagnosisJobDefinition(access.tenantId, configDir);
  const binding = readDiagnosisScheduleBinding(access.tenantId, configDir);
  const run = readDiagnosisJobRun(access.tenantId, input.runId, configDir);
  if (!definition || !binding || binding === "corrupt" || !run) {
    return { ok: false, reason: "run_not_found" };
  }
  if (run.status !== "running") {
    return { ok: false, reason: "run_not_in_flight" };
  }
  const finished = finishLoadedRun({
    tenantId: access.tenantId,
    definition,
    binding,
    run,
    configDir,
    now: input.now,
    evidenceRows: input.evidenceRows,
  });
  if (!finished.ok || !finished.report) {
    return finished.ok ? { ok: false, reason: "run_failed" } : finished;
  }
  return { ...finished, report: finished.report };
}

export function cancelDiagnosisJobRun(input: {
  caller: DiagnosisJobCaller;
  runId?: string | null;
}): DiagnosisJobRefusal {
  const access = resolveDiagnosisJobTenant(input.caller);
  if (!access.ok) {
    return access;
  }
  return cancelRefusal();
}

export function killDiagnosisJobRun(input: {
  caller: DiagnosisJobCaller;
  runId?: string | null;
}): DiagnosisJobRefusal {
  return cancelDiagnosisJobRun(input);
}

export function getDiagnosisJobReport(input: {
  caller: DiagnosisJobCaller;
  reportId: string;
  configDir?: string;
}): { ok: true; report: DiagnosisJobCompositeReport } | DiagnosisJobRefusal {
  const access = resolveDiagnosisJobTenant(input.caller);
  if (!access.ok) {
    return access;
  }
  const report = readDiagnosisJobReport(
    access.tenantId,
    input.reportId,
    configDirOf(input.configDir),
  );
  if (!report) {
    return { ok: false, reason: "report_not_found" };
  }
  if (!diagnosisJobEvidenceAuthorized(report, access.tenantId)) {
    return {
      ok: false,
      reason: "unauthorized_evidence",
      message: "evidenceRefs 不可越权。哈希不等于匿名。",
    };
  }
  return { ok: true, report };
}

export type DiagnosisJobDescription = {
  ok: true;
  definition: DiagnosisJobDefinition | null;
  binding: DiagnosisScheduleBinding | null;
  cadence: "off" | "daily" | "tick";
  runs: DiagnosisJobRun[];
};

/** Read definition, binding, cadence, and runs. Does not create files. */
export function describeDiagnosisJob(input: {
  caller: DiagnosisJobCaller;
  configDir?: string;
}): DiagnosisJobDescription | DiagnosisJobRefusal {
  const access = resolveDiagnosisJobTenant(input.caller);
  if (!access.ok) {
    return access;
  }
  const configDir = configDirOf(input.configDir);
  const binding = readDiagnosisScheduleBinding(access.tenantId, configDir);
  if (binding === "corrupt") {
    return { ok: false, reason: "binding_corrupt" };
  }
  const schedule = readDiagnosisSchedule(access.tenantId, configDir);
  return {
    ok: true,
    definition: readDiagnosisJobDefinition(access.tenantId, configDir),
    binding,
    cadence: schedule?.cadence ?? "off",
    runs: listDiagnosisJobRuns(access.tenantId, configDir).toReversed(),
  };
}

/**
 * Persist selector scope onto the one definition for this tenant.
 * Does not start a run and does not change pause.
 */
export function applyDiagnosisMonitorTask(input: {
  caller: DiagnosisJobCaller;
  filters?: DiagnosisJobFilterInput | null;
  configDir?: string;
  now?: number;
}):
  | { ok: true; definition: DiagnosisJobDefinition; binding: DiagnosisScheduleBinding }
  | DiagnosisJobRefusal {
  const opened = openContext(input);
  if (!opened.ok) {
    return opened;
  }
  if (input.filters) {
    const filters = normalizeDiagnosisJobFilters(input.filters);
    if (!filters.ok) {
      return filters;
    }
    const nowIso = iso(input.now);
    opened.definition.filters = filters.filter;
    opened.definition.updatedAt = nowIso;
    writeDiagnosisJobDefinition(opened.definition, configDirOf(input.configDir));
  }
  return { ok: true, definition: opened.definition, binding: opened.binding };
}

export function diagnosisMonitorFiltersFromParams(
  params: Record<string, unknown>,
): DiagnosisJobFilterInput | null {
  const failure = recordOrNull(params.failure);
  const efficiency = recordOrNull(params.efficiency);
  const agentIds = Array.isArray(params.agentIds)
    ? params.agentIds.filter((value): value is string => typeof value === "string")
    : undefined;
  const hasAgent = typeof params.agentId === "string";
  const hasGroup = typeof params.groupId === "string";
  if (!hasAgent && !hasGroup && !failure && !efficiency && !agentIds?.length) {
    return null;
  }
  return {
    ...(hasAgent ? { agentId: params.agentId as string } : {}),
    ...(agentIds ? { agentIds } : {}),
    ...(hasGroup ? { groupId: params.groupId as string } : {}),
    ...(failure
      ? {
          failure: {
            enabled: failure.enabled === true,
            minCount: typeof failure.minCount === "number" ? failure.minCount : null,
          },
        }
      : {}),
    ...(efficiency
      ? {
          efficiency: {
            maxTotalMs: typeof efficiency.maxTotalMs === "number" ? efficiency.maxTotalMs : null,
            maxTtftMs: typeof efficiency.maxTtftMs === "number" ? efficiency.maxTtftMs : null,
          },
        }
      : {}),
  };
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function normalizeDiagnosisJobFilters(
  input: DiagnosisJobFilterInput | null | undefined,
): { ok: true; filter: DiagnosisJobFilter } | DiagnosisJobRefusal {
  if (!input) {
    return { ok: true, filter: emptyDiagnosisJobFilter() };
  }
  const failure = normalizeFailure(input.failure);
  if (!failure.ok) {
    return failure;
  }
  const efficiency = normalizeEfficiency(input.efficiency);
  if (!efficiency.ok) {
    return efficiency;
  }
  const agentIds = normalizeAgentIds(input.agentIds);
  return {
    ok: true,
    filter: {
      agentId: cleanOptionalId(input.agentId),
      ...(agentIds.length > 0 ? { agentIds } : {}),
      groupId: cleanOptionalId(input.groupId),
      failure: failure.filter,
      efficiency: efficiency.filter,
    },
  };
}

function finishLoadedRun(input: {
  tenantId: string;
  definition: DiagnosisJobDefinition;
  binding: DiagnosisScheduleBinding;
  run: DiagnosisJobRun;
  configDir: string;
  now?: number;
  evidenceRows?: readonly DiagnosisJobEvidenceRow[];
}):
  | {
      ok: true;
      definition: DiagnosisJobDefinition;
      binding: DiagnosisScheduleBinding;
      run: DiagnosisJobRun;
      report: DiagnosisJobCompositeReport | null;
    }
  | DiagnosisJobRefusal {
  const rows =
    input.evidenceRows ??
    readTenantEvaluationEvidence({ configDir: input.configDir, tenantId: input.tenantId });
  const generatedAt = iso(input.now);
  const report = projectDiagnosisJobReport({
    tenantId: input.tenantId,
    definitionId: input.definition.definitionId,
    runId: input.run.runId,
    reportId: `djc-${randomUUID()}`,
    generatedAt,
    filter: input.run.filterSnapshot,
    rows,
  });
  // Re-check authorization before persisting so a tampered row cannot land.
  if (!diagnosisJobEvidenceAuthorized(report, input.tenantId)) {
    input.run.status = "failed";
    input.run.finishedAt = generatedAt;
    writeDiagnosisJobRun(input.run, input.configDir);
    return { ok: false, reason: "unauthorized_evidence" };
  }
  writeDiagnosisJobReport(report, input.configDir);
  input.run.status = "completed";
  input.run.reportId = report.reportId;
  input.run.finishedAt = generatedAt;
  writeDiagnosisJobRun(input.run, input.configDir);
  return {
    ok: true,
    definition: input.definition,
    binding: input.binding,
    run: input.run,
    report,
  };
}

function openContext(input: {
  caller: DiagnosisJobCaller;
  configDir?: string;
  now?: number;
}): JobContext | DiagnosisJobRefusal {
  const access = resolveDiagnosisJobTenant(input.caller);
  if (!access.ok) {
    return access;
  }
  const configDir = configDirOf(input.configDir);
  const nowIso = iso(input.now);
  const definition = ensureDefinition(access.tenantId, configDir, nowIso);
  if (!definition.ok) {
    return definition;
  }
  const binding = ensureBinding(access.tenantId, definition.definition, configDir, nowIso);
  if (!binding.ok) {
    return binding;
  }
  return {
    ok: true,
    tenantId: access.tenantId,
    definition: definition.definition,
    binding: binding.binding,
  };
}

function ensureDefinition(
  tenantId: string,
  configDir: string,
  nowIso: string,
): { ok: true; definition: DiagnosisJobDefinition } | DiagnosisJobRefusal {
  const definitionId = defaultDiagnosisJobDefinitionId(tenantId);
  const existing = readDiagnosisJobDefinition(tenantId, configDir);
  if (existing) {
    if (existing.definitionId !== definitionId || existing.tenantId !== tenantId) {
      return { ok: false, reason: "definition_conflict" };
    }
    return { ok: true, definition: existing };
  }
  const definition: DiagnosisJobDefinition = {
    schemaVersion: DIAGNOSIS_JOB_SCHEMA_VERSION,
    kind: DIAGNOSIS_JOB_DEFINITION_KIND,
    definitionId,
    tenantId,
    ruleSetId: DIAGNOSIS_JOB_RULE_SET_ID,
    ruleVersion: DIAGNOSIS_JOB_RULE_VERSION,
    filters: emptyDiagnosisJobFilter(),
    outputContract: {
      compositeReport: true,
      evidenceRefs: true,
      evolutionPreview: "read_only",
      confirmable: false,
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  writeDiagnosisJobDefinition(definition, configDir);
  return { ok: true, definition };
}

function ensureBinding(
  tenantId: string,
  definition: DiagnosisJobDefinition,
  configDir: string,
  nowIso: string,
): { ok: true; binding: DiagnosisScheduleBinding } | DiagnosisJobRefusal {
  const existing = readDiagnosisScheduleBinding(tenantId, configDir);
  if (existing === "corrupt") {
    return { ok: false, reason: "binding_corrupt" };
  }
  const schedule = readDiagnosisSchedule(tenantId, configDir);
  const scheduleRef: DiagnosisScheduleBinding["scheduleRef"] = {
    tenantHash16: diagnosisJobTenantHash16(tenantId),
    cadence: schedule?.cadence ?? "off",
    present: schedule != null,
  };
  if (existing) {
    existing.definitionId = definition.definitionId;
    existing.scheduleRef = scheduleRef;
    existing.updatedAt = nowIso;
    writeDiagnosisScheduleBinding(existing, configDir);
    return { ok: true, binding: existing };
  }
  const binding: DiagnosisScheduleBinding = {
    schemaVersion: DIAGNOSIS_JOB_SCHEMA_VERSION,
    kind: DIAGNOSIS_JOB_BINDING_KIND,
    bindingId: `djb-${diagnosisJobTenantHash16(tenantId)}`,
    tenantId,
    definitionId: definition.definitionId,
    scheduleRef,
    paused: false,
    pausedAt: null,
    updatedAt: nowIso,
  };
  writeDiagnosisScheduleBinding(binding, configDir);
  return { ok: true, binding };
}

function reserveRunSlot(tenantId: string, configDir: string): { ok: true } | DiagnosisJobRefusal {
  const runs = listDiagnosisJobRuns(tenantId, configDir);
  if (runs.length < DIAGNOSIS_JOB_RUN_CAP) {
    return { ok: true };
  }
  const oldestTerminal = runs.find((run) => run.status !== "running");
  if (!oldestTerminal) {
    return {
      ok: false,
      reason: "run_cap_exceeded",
      message: `每个租户最多保留 ${DIAGNOSIS_JOB_RUN_CAP} 条 JobRun。`,
    };
  }
  if (oldestTerminal.reportId) {
    unlinkDiagnosisJobReport(tenantId, oldestTerminal.reportId, configDir);
  }
  deleteDiagnosisJobRun(tenantId, oldestTerminal.runId, configDir);
  return { ok: true };
}

function normalizeFailure(
  input: DiagnosisJobFilterInput["failure"],
): { ok: true; filter: DiagnosisJobFailureFilter | null } | DiagnosisJobRefusal {
  if (!input || input.enabled !== true) {
    return { ok: true, filter: null };
  }
  if (input.minCount == null) {
    return { ok: true, filter: { enabled: true, minCount: null } };
  }
  if (!Number.isInteger(input.minCount) || input.minCount < 1) {
    return { ok: false, reason: "invalid_filter" };
  }
  return { ok: true, filter: { enabled: true, minCount: input.minCount } };
}

function normalizeEfficiency(
  input: DiagnosisJobFilterInput["efficiency"],
): { ok: true; filter: DiagnosisJobEfficiencyFilter | null } | DiagnosisJobRefusal {
  if (!input) {
    return { ok: true, filter: null };
  }
  const maxTotalMs = normalizeThreshold(input.maxTotalMs);
  const maxTtftMs = normalizeThreshold(input.maxTtftMs);
  if (!maxTotalMs.ok || !maxTtftMs.ok) {
    return { ok: false, reason: "invalid_filter" };
  }
  if (maxTotalMs.value == null && maxTtftMs.value == null) {
    return { ok: true, filter: null };
  }
  return {
    ok: true,
    filter: { maxTotalMs: maxTotalMs.value, maxTtftMs: maxTtftMs.value },
  };
}

function normalizeThreshold(
  value: number | null | undefined,
): { ok: true; value: number | null } | { ok: false } {
  if (value == null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return { ok: false };
  }
  return { ok: true, value };
}

function normalizeAgentIds(value: readonly string[] | null | undefined): string[] {
  if (!value) {
    return [];
  }
  const ids: string[] = [];
  for (const raw of value) {
    const id = cleanOptionalId(raw);
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

function cleanOptionalId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function repairRefusal(): DiagnosisJobRefusal {
  return {
    ok: false,
    reason: "repair_not_in_scope",
    message: "M1 零 repair。不调用 Doctor 修复路径。",
  };
}

function cancelRefusal(): DiagnosisJobRefusal {
  return {
    ok: false,
    reason: "cancel_not_in_scope",
    message: "取消/强杀不在 M1 范围。暂停只阻止新的 JobRun，已启动的 Run 会跑完。",
  };
}

function configDirOf(configDir: string | undefined): string {
  return configDir ?? CONFIG_DIR;
}

function iso(now: number | undefined): string {
  return new Date(now ?? Date.now()).toISOString();
}

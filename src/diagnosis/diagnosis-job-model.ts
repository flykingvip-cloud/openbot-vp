/**
 * M1 Diagnosis Job model.
 *
 * JobDefinition, JobRun, and ScheduleBinding are separate objects.
 * M1 keeps one default definition per tenant. Runs are many, but capped.
 * Pause blocks new runs only. Cancel/kill is refused. Evolution output is a
 * read-only preview: confirm stays closed and this model does not score
 * conversation correctness through diagnose().
 */
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "./diagnose-professional-protocol.js";

export const DIAGNOSIS_JOB_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_JOB_RULE_SET_ID = "diagnosis-job-m1" as const;
/** Versioned filter + report rules. See applyDiagnosisJobFilters. */
export const DIAGNOSIS_JOB_RULE_VERSION = "m1.v1" as const;
export const DIAGNOSIS_JOB_RUN_CAP = 32 as const;
export const DIAGNOSIS_JOBS_DIR = "diagnosis-jobs" as const;

export const DIAGNOSIS_JOB_DEFINITION_KIND = "job_definition" as const;
export const DIAGNOSIS_JOB_RUN_KIND = "job_run" as const;
export const DIAGNOSIS_JOB_BINDING_KIND = "schedule_binding" as const;
export const DIAGNOSIS_JOB_REPORT_KIND = "diagnosis_job_composite_report" as const;

export const DIAGNOSIS_JOB_FORBIDDEN_WRITE_DIRS = [
  "conversation-evaluations",
  "diagnosis-schedules",
  "diagnosis-projections",
  "diagnosis-evolution-prescriptions",
] as const;

const FAILURE_EXECUTIONS = new Set(["aborted", "timed_out", "errored"]);
const FAILURE_ATTRIBUTIONS = new Set([
  "model",
  "tool",
  "sandbox",
  "orchestration",
  "permission",
  "config",
  "external",
]);

export type DiagnosisJobRunStatus = "running" | "completed" | "failed";

export type DiagnosisJobFailureFilter = {
  enabled: true;
  /** Matched failure rows must reach this count for thresholdMet. Null means 1. */
  minCount: number | null;
};

export type DiagnosisJobEfficiencyFilter = {
  maxTotalMs: number | null;
  maxTtftMs: number | null;
};

export type DiagnosisJobFilter = {
  agentId: string | null;
  /**
   * Extra agent allow-list. Combined with agentId. Empty or absent means
   * that side does not narrow. IDs come from selectors, never free text.
   */
  agentIds?: string[];
  groupId: string | null;
  failure: DiagnosisJobFailureFilter | null;
  efficiency: DiagnosisJobEfficiencyFilter | null;
};

export type DiagnosisJobEvidenceRow = {
  tenantId: string;
  runId: string;
  eventId: string;
  agentId: string | null;
  groupId: string | null;
  execution: string;
  correctness: string;
  failureAttribution: string;
  totalMs: number | null;
  ttftMs: number | "n/a" | null;
  evidenceRefs: string[];
};

export type DiagnosisJobMatch = {
  sourceRunId: string;
  eventId: string;
  agentId: string | null;
  groupId: string | null;
  failure: boolean;
  efficiencyBreach: boolean;
};

export type DiagnosisJobEvidenceRef = {
  evidenceId: string;
  tenantId: string;
  sourceEventId: string;
  sourceRunId: string;
  authority: "conversation-evaluation";
};

export type DiagnosisJobEvolutionPreview = {
  readOnly: true;
  confirmable: false;
  confirmLatchEnabled: false;
  previewKind: "evolution_projection_preview";
  ruleSetId: typeof DIAGNOSIS_JOB_RULE_SET_ID;
  ruleVersion: typeof DIAGNOSIS_JOB_RULE_VERSION;
  summary: string;
};

export type DiagnosisJobDefinition = {
  schemaVersion: typeof DIAGNOSIS_JOB_SCHEMA_VERSION;
  kind: typeof DIAGNOSIS_JOB_DEFINITION_KIND;
  definitionId: string;
  tenantId: string;
  ruleSetId: typeof DIAGNOSIS_JOB_RULE_SET_ID;
  ruleVersion: typeof DIAGNOSIS_JOB_RULE_VERSION;
  filters: DiagnosisJobFilter;
  outputContract: {
    compositeReport: true;
    evidenceRefs: true;
    evolutionPreview: "read_only";
    confirmable: false;
  };
  createdAt: string;
  updatedAt: string;
};

export type DiagnosisScheduleBinding = {
  schemaVersion: typeof DIAGNOSIS_JOB_SCHEMA_VERSION;
  kind: typeof DIAGNOSIS_JOB_BINDING_KIND;
  bindingId: string;
  tenantId: string;
  definitionId: string;
  /** Points at the existing one-schedule-per-tenant record. Does not copy it. */
  scheduleRef: {
    tenantHash16: string;
    cadence: "off" | "tick" | "daily";
    present: boolean;
  };
  paused: boolean;
  pausedAt: string | null;
  updatedAt: string;
};

export type DiagnosisJobRun = {
  schemaVersion: typeof DIAGNOSIS_JOB_SCHEMA_VERSION;
  kind: typeof DIAGNOSIS_JOB_RUN_KIND;
  runId: string;
  definitionId: string;
  tenantId: string;
  status: DiagnosisJobRunStatus;
  filterSnapshot: DiagnosisJobFilter;
  reportId: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type DiagnosisJobCompositeReport = {
  schemaVersion: typeof DIAGNOSIS_JOB_SCHEMA_VERSION;
  kind: typeof DIAGNOSIS_JOB_REPORT_KIND;
  ruleSetId: typeof DIAGNOSIS_JOB_RULE_SET_ID;
  ruleVersion: typeof DIAGNOSIS_JOB_RULE_VERSION;
  reportId: string;
  generatedAt: string;
  tenantId: string;
  definitionId: string;
  runId: string;
  filter: DiagnosisJobFilter;
  matched: DiagnosisJobMatch[];
  evidenceRefs: DiagnosisJobEvidenceRef[];
  rejectedCrossTenant: number;
  thresholdMet: boolean;
  evolutionPreview: DiagnosisJobEvolutionPreview;
  diagnosesConversationCorrectness: false;
  repairApplied: false;
};

export type DiagnosisJobRefusal = {
  ok: false;
  reason: string;
  message?: string;
};

export type DiagnosisJobTenantAccess = { ok: true; tenantId: string } | DiagnosisJobRefusal;

export function emptyDiagnosisJobFilter(): DiagnosisJobFilter {
  return { agentId: null, groupId: null, failure: null, efficiency: null };
}

export function resolveDiagnosisJobTenant(input: {
  membershipTenantId: string | null | undefined;
  claimedTenantId?: string | null;
  /**
   * Set only by the gateway from the authenticated session domain.
   * Never copy this from request params.
   */
  platformOperator?: boolean;
}): DiagnosisJobTenantAccess {
  if (input.platformOperator === true) {
    const selected = input.claimedTenantId?.trim() ?? "";
    if (!selected) {
      return { ok: false, reason: "tenant_required", message: "先选择租户。" };
    }
    return { ok: true, tenantId: selected };
  }
  const membership = input.membershipTenantId?.trim() ?? "";
  if (!membership) {
    return { ok: false, reason: "membership_required" };
  }
  const claimed = input.claimedTenantId?.trim() ?? "";
  if (claimed && claimed !== membership) {
    return {
      ok: false,
      reason: "forged_tenant_rejected",
      message: "tenantId 只接受服务端 membership，拒绝客户端自报。",
    };
  }
  return { ok: true, tenantId: membership };
}

export function isDiagnosisJobFailure(
  row: Pick<DiagnosisJobEvidenceRow, "execution" | "correctness" | "failureAttribution">,
): boolean {
  if (FAILURE_EXECUTIONS.has(row.execution)) {
    return true;
  }
  if (row.correctness === "fail") {
    return true;
  }
  return FAILURE_ATTRIBUTIONS.has(row.failureAttribution);
}

export function breachesDiagnosisJobEfficiency(
  row: Pick<DiagnosisJobEvidenceRow, "totalMs" | "ttftMs">,
  efficiency: DiagnosisJobEfficiencyFilter | null,
): boolean {
  if (!efficiency) {
    return false;
  }
  const totalBreach =
    efficiency.maxTotalMs != null &&
    typeof row.totalMs === "number" &&
    row.totalMs > efficiency.maxTotalMs;
  const ttftBreach =
    efficiency.maxTtftMs != null &&
    typeof row.ttftMs === "number" &&
    row.ttftMs > efficiency.maxTtftMs;
  return totalBreach || ttftBreach;
}

export type DiagnosisJobFilterProjection = {
  matched: DiagnosisJobMatch[];
  evidenceRefs: DiagnosisJobEvidenceRef[];
  rejectedCrossTenant: number;
  thresholdMet: boolean;
};

/**
 * m1.v1 filter rules:
 * - tenant is the membership tenant; other tenants are counted and dropped
 * - agentId / agentIds are one allow-list; groupId is conjunctive when set
 * - failure and efficiency are conjunctive when both are set
 * - within efficiency, totalMs and ttftMs are disjunctive (either breach matches)
 * - failure class reads M0 evaluation fields; it does not call diagnose()
 */
export function applyDiagnosisJobFilters(
  rows: readonly DiagnosisJobEvidenceRow[],
  filter: DiagnosisJobFilter,
  membershipTenantId: string,
): DiagnosisJobFilterProjection {
  const matched: DiagnosisJobMatch[] = [];
  const evidenceRefs: DiagnosisJobEvidenceRef[] = [];
  let rejectedCrossTenant = 0;
  const failureOn = filter.failure?.enabled === true;
  const efficiencyOn = isEfficiencyFilterActive(filter.efficiency);

  for (const row of rows) {
    if (row.tenantId.trim() !== membershipTenantId) {
      rejectedCrossTenant += 1;
      continue;
    }
    const agentAllow = diagnosisJobAgentAllowList(filter);
    if (agentAllow && (!row.agentId || !agentAllow.has(row.agentId))) {
      continue;
    }
    if (filter.groupId && row.groupId !== filter.groupId) {
      continue;
    }
    const failure = isDiagnosisJobFailure(row);
    const efficiencyBreach = breachesDiagnosisJobEfficiency(row, filter.efficiency);
    if (failureOn && efficiencyOn) {
      if (!failure || !efficiencyBreach) {
        continue;
      }
    } else if (failureOn && !failure) {
      continue;
    } else if (efficiencyOn && !efficiencyBreach) {
      continue;
    }
    matched.push({
      sourceRunId: row.runId,
      eventId: row.eventId,
      agentId: row.agentId,
      groupId: row.groupId,
      failure,
      efficiencyBreach,
    });
    const sourceIds = row.evidenceRefs.length > 0 ? row.evidenceRefs : [`eval:${row.eventId}`];
    for (const evidenceId of sourceIds) {
      evidenceRefs.push({
        evidenceId,
        tenantId: membershipTenantId,
        sourceEventId: row.eventId,
        sourceRunId: row.runId,
        authority: "conversation-evaluation",
      });
    }
  }

  return {
    matched,
    evidenceRefs,
    rejectedCrossTenant,
    thresholdMet: thresholdMetFor(filter, matched),
  };
}

export function buildDiagnosisJobEvolutionPreview(): DiagnosisJobEvolutionPreview {
  return {
    readOnly: true,
    confirmable: false,
    confirmLatchEnabled: false,
    previewKind: "evolution_projection_preview",
    ruleSetId: DIAGNOSIS_JOB_RULE_SET_ID,
    ruleVersion: DIAGNOSIS_JOB_RULE_VERSION,
    summary: "进化投影只读预览。M1 不可确认，确认门闩保持关闭，预览不生效。",
  };
}

export function projectDiagnosisJobReport(input: {
  tenantId: string;
  definitionId: string;
  runId: string;
  reportId: string;
  generatedAt: string;
  filter: DiagnosisJobFilter;
  rows: readonly DiagnosisJobEvidenceRow[];
}): DiagnosisJobCompositeReport {
  const projected = applyDiagnosisJobFilters(input.rows, input.filter, input.tenantId);
  return {
    schemaVersion: DIAGNOSIS_JOB_SCHEMA_VERSION,
    kind: DIAGNOSIS_JOB_REPORT_KIND,
    ruleSetId: DIAGNOSIS_JOB_RULE_SET_ID,
    ruleVersion: DIAGNOSIS_JOB_RULE_VERSION,
    reportId: input.reportId,
    generatedAt: input.generatedAt,
    tenantId: input.tenantId,
    definitionId: input.definitionId,
    runId: input.runId,
    filter: input.filter,
    matched: projected.matched,
    evidenceRefs: projected.evidenceRefs,
    rejectedCrossTenant: projected.rejectedCrossTenant,
    thresholdMet: projected.thresholdMet,
    evolutionPreview: buildDiagnosisJobEvolutionPreview(),
    diagnosesConversationCorrectness: false,
    repairApplied: false,
  };
}

export function diagnosisJobEvidenceAuthorized(
  report: DiagnosisJobCompositeReport,
  membershipTenantId: string,
): boolean {
  if (report.tenantId !== membershipTenantId) {
    return false;
  }
  return report.evidenceRefs.every((ref) => ref.tenantId === membershipTenantId);
}

export function confirmDiagnosisJobEvolutionPreview(): DiagnosisJobRefusal {
  const latchEnabled: boolean = DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED;
  if (!latchEnabled) {
    return {
      ok: false,
      reason: "confirm_not_enabled",
      message: "DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED 保持关闭。M1 进化投影只读。",
    };
  }
  return {
    ok: false,
    reason: "preview_not_confirmable",
    message: "M1 进化投影 confirmable=false。确认绑定属于 M2。",
  };
}

export function diagnosisJobAgentAllowList(filter: DiagnosisJobFilter): Set<string> | null {
  const ids = new Set<string>();
  const single = filter.agentId?.trim();
  if (single) {
    ids.add(single);
  }
  for (const raw of filter.agentIds ?? []) {
    const id = raw.trim();
    if (id) {
      ids.add(id);
    }
  }
  return ids.size > 0 ? ids : null;
}

function isEfficiencyFilterActive(
  efficiency: DiagnosisJobEfficiencyFilter | null,
): efficiency is DiagnosisJobEfficiencyFilter {
  return efficiency != null && (efficiency.maxTotalMs != null || efficiency.maxTtftMs != null);
}

function thresholdMetFor(
  filter: DiagnosisJobFilter,
  matched: readonly DiagnosisJobMatch[],
): boolean {
  const failureOn = filter.failure?.enabled === true;
  const efficiencyOn = isEfficiencyFilterActive(filter.efficiency);
  if (!failureOn && !efficiencyOn) {
    return true;
  }
  if (failureOn) {
    const minCount = filter.failure?.minCount ?? 1;
    const failures = matched.filter((row) => row.failure).length;
    if (failures < minCount) {
      return false;
    }
  }
  if (efficiencyOn && matched.length === 0) {
    return false;
  }
  return true;
}

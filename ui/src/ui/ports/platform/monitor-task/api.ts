/**
 * Platform monitor-task gateway client.
 * Methods: diagnosis.schedule.apply, diagnosis.job.describe/pause/resume/run/report.get.
 */
import { GatewayRequestError, type GatewayBrowserClient } from "../../../gateway.ts";
import type { MonitorCadence, MonitorJobReportSource, MonitorTrigger } from "./monitor-report.ts";

export const MONITOR_SCHEDULE_APPLY_METHOD = "diagnosis.schedule.apply";
export const MONITOR_JOB_DESCRIBE_METHOD = "diagnosis.job.describe";
export const MONITOR_JOB_PAUSE_METHOD = "diagnosis.job.pause";
export const MONITOR_JOB_RESUME_METHOD = "diagnosis.job.resume";
export const MONITOR_JOB_RUN_METHOD = "diagnosis.job.run";
export const MONITOR_JOB_REPORT_GET_METHOD = "diagnosis.job.report.get";

export type MonitorRunSnapshot = {
  runId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  reportId: string | null;
};

export type MonitorTaskSnapshot = {
  cadence: MonitorCadence;
  paused: boolean;
  hasDefinition: boolean;
  agentIds: string[];
  groupId: string | null;
  failureMinCount: number | null;
  efficiencyMaxTotalMs: number | null;
  runs: MonitorRunSnapshot[];
};

export type MonitorScheduleInput = {
  tenantId: string;
  cadence: MonitorCadence;
  agentIds: string[];
  groupId: string | null;
  roundId: string | null;
  failureMinCount: number | null;
  efficiencyMaxTotalMs: number | null;
};

type DescribePayload = {
  ok: true;
  definition: {
    filters?: {
      agentId?: string | null;
      agentIds?: string[] | null;
      groupId?: string | null;
      failure?: { enabled?: boolean; minCount?: number | null } | null;
      efficiency?: { maxTotalMs?: number | null } | null;
    };
  } | null;
  binding: { paused?: boolean } | null;
  cadence?: MonitorCadence;
  runs?: MonitorRunSnapshot[];
};

export function monitorScheduleApplyParams(input: MonitorScheduleInput): Record<string, unknown> {
  const targets = [
    ...input.agentIds.map((agentId) => ({ agentId })),
    ...(input.groupId
      ? [{ groupId: input.groupId, ...(input.roundId ? { roundId: input.roundId } : {}) }]
      : []),
  ];
  return {
    tenantId: input.tenantId,
    cadence: input.cadence,
    scope: targets.length === 0 ? "all" : "target",
    ...(targets.length > 0 ? { targets } : {}),
    ...(input.agentIds.length === 1 ? { agentId: input.agentIds[0] } : {}),
    ...(input.agentIds.length > 1 ? { agentIds: input.agentIds } : {}),
    ...(input.groupId ? { groupId: input.groupId } : { groupId: "" }),
    failure:
      input.failureMinCount == null
        ? { enabled: false, minCount: null }
        : { enabled: true, minCount: input.failureMinCount },
    efficiency: { maxTotalMs: input.efficiencyMaxTotalMs, maxTtftMs: null },
  };
}

export function monitorRunParams(input: MonitorScheduleInput): Record<string, unknown> {
  const params = monitorScheduleApplyParams(input);
  return {
    tenantId: input.tenantId,
    ...(typeof params.agentId === "string" ? { agentId: params.agentId } : {}),
    ...(Array.isArray(params.agentIds) ? { agentIds: params.agentIds } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    failure: params.failure,
    efficiency: params.efficiency,
  };
}

export function snapshotFromDescribe(payload: DescribePayload): MonitorTaskSnapshot {
  const filters = payload.definition?.filters;
  const agentIds = [
    ...(filters?.agentId ? [filters.agentId] : []),
    ...(filters?.agentIds ?? []),
  ].filter((id, index, all) => Boolean(id) && all.indexOf(id) === index);
  const failureMinCount =
    filters?.failure?.enabled === true && typeof filters.failure.minCount === "number"
      ? filters.failure.minCount
      : null;
  return {
    cadence: payload.cadence === "daily" || payload.cadence === "tick" ? payload.cadence : "off",
    paused: payload.binding?.paused === true,
    hasDefinition: payload.definition != null,
    agentIds,
    groupId: filters?.groupId?.trim() ? filters.groupId : null,
    failureMinCount,
    efficiencyMaxTotalMs:
      typeof filters?.efficiency?.maxTotalMs === "number" ? filters.efficiency.maxTotalMs : null,
    runs: (payload.runs ?? []).map((run) => ({
      runId: run.runId,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      reportId: run.reportId,
    })),
  };
}

export function emptyMonitorSnapshot(): MonitorTaskSnapshot {
  return {
    cadence: "off",
    paused: false,
    hasDefinition: false,
    agentIds: [],
    groupId: null,
    failureMinCount: null,
    efficiencyMaxTotalMs: null,
    runs: [],
  };
}

export function inferRunTrigger(
  cadence: MonitorCadence,
  manualRunIds: ReadonlySet<string>,
  runId: string,
): MonitorTrigger {
  if (manualRunIds.has(runId)) {
    return "manual";
  }
  return cadence === "off" ? "manual" : cadence;
}

export async function describeMonitorTask(
  client: GatewayBrowserClient,
  tenantId: string,
): Promise<MonitorTaskSnapshot> {
  const payload = await client.request<DescribePayload>(MONITOR_JOB_DESCRIBE_METHOD, { tenantId });
  return snapshotFromDescribe(payload);
}

export async function applyMonitorSchedule(
  client: GatewayBrowserClient,
  input: MonitorScheduleInput,
): Promise<void> {
  await client.request(MONITOR_SCHEDULE_APPLY_METHOD, monitorScheduleApplyParams(input));
}

export async function pauseMonitorTask(
  client: GatewayBrowserClient,
  tenantId: string,
): Promise<void> {
  await client.request(MONITOR_JOB_PAUSE_METHOD, { tenantId });
}

export async function resumeMonitorTask(
  client: GatewayBrowserClient,
  tenantId: string,
): Promise<void> {
  await client.request(MONITOR_JOB_RESUME_METHOD, { tenantId });
}

export async function runMonitorTask(
  client: GatewayBrowserClient,
  input: MonitorScheduleInput,
): Promise<{
  runId: string;
  reportId: string | null;
  status: MonitorRunSnapshot["status"];
} | null> {
  const payload = await client.request<{
    run?: { runId?: string; reportId?: string | null; status?: MonitorRunSnapshot["status"] };
  }>(MONITOR_JOB_RUN_METHOD, monitorRunParams(input));
  const runId = payload.run?.runId;
  if (!runId) {
    return null;
  }
  return {
    runId,
    reportId: payload.run?.reportId ?? null,
    status: payload.run?.status ?? "running",
  };
}

export async function getMonitorJobReport(
  client: GatewayBrowserClient,
  tenantId: string,
  reportId: string,
): Promise<MonitorJobReportSource> {
  const payload = await client.request<{ report?: MonitorJobReportSource }>(
    MONITOR_JOB_REPORT_GET_METHOD,
    { tenantId, reportId },
  );
  if (!payload.report?.runId || !payload.report.tenantId) {
    throw new GatewayRequestError({ code: "INVALID_REQUEST", message: "report_not_found" });
  }
  return payload.report;
}

export function monitorErrorMessage(err: unknown): string {
  if (err instanceof GatewayRequestError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "";
}

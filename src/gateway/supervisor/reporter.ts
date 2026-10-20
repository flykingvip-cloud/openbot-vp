/**
 * supervisor/reporter.ts — M3 reporting baseline (task timeline + final report).
 *
 * Current implementation persists structured reporting artifacts locally:
 * - events jsonl: ~/.openbot/supervisor/reports/<taskId>.events.jsonl
 * - final json:   ~/.openbot/supervisor/reports/<taskId>.final.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { WorkerLogEvent } from "../../fabric/worker/types.js";
import { writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { emitSupervisorTaskEvent, type SupervisorTaskEventType } from "./events.js";
import type { SupervisedTask } from "./types.js";

export interface ReporterPort {
  taskStarted(task: SupervisedTask): Promise<void>;
  milestone(task: SupervisedTask, summary: string): Promise<void>;
  progress?(task: SupervisedTask, event: WorkerLogEvent): Promise<void>;
  finalReport(task: SupervisedTask): Promise<void>;
}

type ReportEventType = SupervisorTaskEventType;
const MAX_PROGRESS_DATA = 240;

function resolveSupervisorReportsDir(baseDir?: string): string {
  return resolveUserPath(baseDir?.trim() || path.join(CONFIG_DIR, "supervisor", "reports"));
}

function eventFilePath(taskId: string, reportsDir?: string): string {
  return path.join(resolveSupervisorReportsDir(reportsDir), `${taskId}.events.jsonl`);
}

function finalFilePath(taskId: string, reportsDir?: string): string {
  return path.join(resolveSupervisorReportsDir(reportsDir), `${taskId}.final.json`);
}

function summarizeTask(task: SupervisedTask): Record<string, unknown> {
  const last = task.iterations.at(-1);
  return {
    taskId: task.taskId,
    state: task.state,
    goal: task.goal,
    worker: task.worker,
    tenantId: task.tenantId,
    userId: task.userId,
    agentId: task.agentId,
    iterations: task.iterations.length,
    spentCostUsd: task.budget.spentCostUsd,
    acceptance: {
      source: task.acceptance.source,
      steps: task.acceptance.steps.map((s) => ({ id: s.id, required: s.required })),
    },
    lastIteration: last
      ? {
          index: last.index,
          runId: last.runId,
          exitCode: last.exitCode,
          startedAt: last.startedAt,
          endedAt: last.endedAt,
          validationPassed: last.validation?.passed,
        }
      : null,
    activeRunId: task.activeRun?.runId,
    updatedAt: task.updatedAt,
  };
}

function resolveAuthoritativeRunId(task: SupervisedTask): string | undefined {
  return task.activeRun?.runId?.trim() || task.iterations.at(-1)?.runId?.trim() || undefined;
}

function buildLiveEventPayload(
  task: SupervisedTask,
  type: ReportEventType,
  details: Record<string, unknown> = {},
): {
  taskId: string;
  type: ReportEventType;
  at: string;
  state?: string;
  goal?: string;
  summary?: string;
  runId?: string;
  progress?: Record<string, unknown>;
} {
  const at = new Date().toISOString();
  const summary = typeof details.summary === "string" ? details.summary : undefined;
  const runId =
    (typeof details.runId === "string" && details.runId.trim()) || resolveAuthoritativeRunId(task);
  const progress =
    type === "progress"
      ? {
          kind: details.kind,
          phase: details.phase,
          data: details.data,
          ...(runId ? { runId } : {}),
        }
      : undefined;
  return {
    taskId: task.taskId,
    type,
    at,
    state: task.state,
    goal: task.goal,
    ...(summary ? { summary } : {}),
    ...(runId ? { runId } : {}),
    ...(progress ? { progress } : {}),
  };
}

async function appendEvent(
  task: SupervisedTask,
  type: ReportEventType,
  details: Record<string, unknown> = {},
  reportsDir?: string,
): Promise<void> {
  const filePath = eventFilePath(task.taskId, reportsDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const at = new Date().toISOString();
  const line = JSON.stringify({
    at,
    type,
    ...summarizeTask(task),
    ...details,
  });
  await fs.appendFile(filePath, `${line}\n`, "utf8");
  emitSupervisorTaskEvent(buildLiveEventPayload(task, type, details));
}

function sanitizeProgressEvent(event: WorkerLogEvent): Record<string, unknown> {
  const base: Record<string, unknown> = { kind: event.type };
  if (event.phase) {
    base.phase = event.phase;
  }
  if (event.data) {
    const data = event.data.trim();
    base.data = data.length > MAX_PROGRESS_DATA ? `${data.slice(0, MAX_PROGRESS_DATA)}…` : data;
  }
  return base;
}

/** Read persisted report timeline events (newest last, optionally tail-limited). */
export async function readSupervisorReportEvents(opts: {
  taskId: string;
  reportsDir?: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const filePath = eventFilePath(opts.taskId, opts.reportsDir);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const limit = opts.limit && opts.limit > 0 ? Math.floor(opts.limit) : undefined;
    const slice = limit && lines.length > limit ? lines.slice(-limit) : lines;
    const events: Array<Record<string, unknown>> = [];
    for (const line of slice) {
      try {
        events.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // skip malformed lines
      }
    }
    return events;
  } catch {
    return [];
  }
}

export function createJsonReporterPort(opts?: { reportsDir?: string }): ReporterPort {
  return {
    async taskStarted(task) {
      await appendEvent(task, "task_started", {}, opts?.reportsDir);
    },
    async milestone(task, summary) {
      await appendEvent(task, "milestone", { summary }, opts?.reportsDir);
    },
    async progress(task, event) {
      await appendEvent(task, "progress", sanitizeProgressEvent(event), opts?.reportsDir);
    },
    async finalReport(task) {
      await appendEvent(task, "final_report", {}, opts?.reportsDir);
      const finalPath = finalFilePath(task.taskId, opts?.reportsDir);
      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await writeJsonAtomic(finalPath, {
        generatedAt: new Date().toISOString(),
        summary: summarizeTask(task),
        iterations: task.iterations,
      });
    },
  };
}

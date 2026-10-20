/**
 * supervisor/retry.ts — Retry Controller + stop conditions (M2, Task 2.1).
 *
 * Pure helpers: `nextStop` (iteration/budget/duration/no-progress gates),
 * fixing-prompt builder (redacted failure evidence), retryable exit codes,
 * and acceptance-criteria monotonicity (Property 2).
 */

import type {
  AcceptanceCriteria,
  SupervisedTask,
  SupervisedTaskState,
  ValidationReport,
} from "./types.js";

const MAX_PROMPT_EVIDENCE_CHARS = 4000;

/** Required steps that failed in a validation report (stable sort). */
export function failedRequiredStepIds(
  report: ValidationReport,
  criteria: AcceptanceCriteria,
): string[] {
  const required = new Set(criteria.steps.filter((s) => s.required).map((s) => s.id));
  return report.steps
    .filter((s) => required.has(s.id) && !s.ok)
    .map((s) => s.id)
    .toSorted();
}

/** True when the last two completed iterations share the same failed-required set (R5.4). */
export function isNoProgress(task: SupervisedTask): boolean {
  const completed = task.iterations.filter((it) => it.validation);
  if (completed.length < 2) {
    return false;
  }
  const prev = completed.at(-2)?.validation;
  const last = completed.at(-1)?.validation;
  if (!prev || !last) {
    return false;
  }
  const a = failedRequiredStepIds(prev, task.acceptance);
  const b = failedRequiredStepIds(last, task.acceptance);
  return a.length > 0 && a.join("\0") === b.join("\0");
}

/**
 * Return a terminal stop state when a bound is reached, else null. Checked
 * before starting another iteration from `fixing` (R5.2–5.4, D-BUDGET).
 */
export function nextStop(
  task: SupervisedTask,
  nowMs: number = Date.now(),
): SupervisedTaskState | null {
  const { budget: b } = task;
  if (task.iterations.length >= b.maxIterations) {
    return "max_iterations";
  }
  if (b.spentCostUsd >= b.maxCostUsd) {
    return "budget_exhausted";
  }
  if (typeof b.startedAtMs === "number" && nowMs - b.startedAtMs >= b.maxDurationMinutes * 60_000) {
    return "timed_out";
  }
  if (isNoProgress(task)) {
    return "escalated";
  }
  return null;
}

/** Worker exit code retryability (cli-backend `worker.retryableExitCodes`). */
export function isWorkerExitRetryable(
  exitCode: number | undefined,
  retryableExitCodes: readonly number[],
): boolean {
  if (exitCode === undefined) {
    return true;
  }
  if (retryableExitCodes.length === 0) {
    return true;
  }
  return retryableExitCodes.includes(exitCode);
}

/**
 * Build the fixing-round worker prompt from redacted validation evidence (R5.1).
 * Never includes secrets; stderr is already summarized upstream.
 */
export function buildFixingPrompt(task: SupervisedTask, report: ValidationReport): string {
  const failures = report.steps.filter((s) => !s.ok);
  const lines = failures.map((s) => {
    const bits = [`step ${s.id}`, `exit=${s.exitCode ?? "null"}`];
    if (s.denied) {
      bits.push("denied_by_policy");
    }
    if (s.stderrSummary) {
      bits.push(s.stderrSummary);
    }
    return `- ${bits.join(" | ")}`;
  });
  let body = [
    "Fix the validation failures below, then ensure all required checks pass.",
    "",
    `Original goal: ${task.goal.trim()}`,
    "",
    "Failures:",
    ...lines,
  ].join("\n");
  if (body.length > MAX_PROMPT_EVIDENCE_CHARS) {
    body = `${body.slice(0, MAX_PROMPT_EVIDENCE_CHARS)}…`;
  }
  return body;
}

/**
 * Property 2: retry must not relax acceptance (required set + expect unchanged).
 * Returns true when `candidate` is equal or stricter than `baseline`.
 */
export function acceptanceNotRelaxed(
  baseline: AcceptanceCriteria,
  candidate: AcceptanceCriteria,
): boolean {
  const baseRequired = baseline.steps.filter((s) => s.required);
  for (const step of baseRequired) {
    const other = candidate.steps.find((s) => s.id === step.id);
    if (!other || !other.required) {
      return false;
    }
    const baseExit = step.expect?.exitCode ?? 0;
    const otherExit = other.expect?.exitCode ?? 0;
    if (otherExit !== baseExit) {
      return false;
    }
  }
  return true;
}

export function stopReasonLabel(state: SupervisedTaskState): string {
  switch (state) {
    case "max_iterations":
      return "Maximum supervision iterations reached";
    case "budget_exhausted":
      return "Supervision budget exhausted";
    case "timed_out":
      return "Supervision time limit reached";
    case "escalated":
      return "No progress detected between iterations";
    default:
      return `Supervision stopped: ${state}`;
  }
}

/**
 * W2: backfill attempt-time pattern/skill observations from a closed TaskOutcome tip.
 * Attempt keeps writing null/unknown (#94 honesty). Positive/negative capability samples
 * are confirmed only here when tip is closed and evaluation eligibility allows.
 * Do not delete attempt observation call sites by function name.
 */
import { confirmPatternOutcomeByRunId } from "../gateway/pattern-detection/index.js";
import {
  readSkillInvocationEvents,
  recordSkillInvocationCompleted,
} from "../gateway/skill-invocation/index.js";
import { computeEvaluationEligibility } from "./eligibility.js";
import type { TaskOutcomeRecord } from "./types.js";

export type AttemptBackfillResult = {
  patternPatched: number;
  skillConfirmed: number;
  reason: string;
};

/**
 * Map tip + eligibility → judged boolean for pattern/skill capability samples.
 * cancelled / ineligible → no capability judgement (leave attempt null as-is).
 */
export function resolveAttemptBackfillJudgement(
  record: TaskOutcomeRecord,
): { success: boolean; reason: string } | null {
  if (record.lifecycle !== "closed") {
    return null;
  }
  const eligibility = computeEvaluationEligibility(record);
  if (record.taskJudgement === "cancelled") {
    // Never treat user cancel as capability failure / success.
    return null;
  }
  if (record.taskJudgement === "success" && eligibility.countsSkillSuccessRate) {
    return { success: true, reason: "tip_success_eligible" };
  }
  if (record.taskJudgement === "failure" && eligibility.countsSkillSuccessRate) {
    return { success: false, reason: "tip_failure_skill_eligible" };
  }
  if (record.taskJudgement === "failure" && eligibility.countsGrowthNegative) {
    return { success: false, reason: "tip_failure_growth_eligible" };
  }
  return null;
}

export function backfillAttemptSamplesFromTaskOutcome(
  record: TaskOutcomeRecord,
  opts?: { agentId?: string; configDir?: string },
): AttemptBackfillResult {
  const judged = resolveAttemptBackfillJudgement(record);
  if (!judged) {
    return {
      patternPatched: 0,
      skillConfirmed: 0,
      reason:
        record.lifecycle !== "closed"
          ? "not_closed"
          : record.taskJudgement === "cancelled"
            ? "cancelled_excluded"
            : "not_eligible",
    };
  }

  const runId = record.decisiveRunId?.trim();
  if (!runId) {
    return { patternPatched: 0, skillConfirmed: 0, reason: "no_decisive_run" };
  }

  let patternPatched = 0;
  try {
    patternPatched = confirmPatternOutcomeByRunId(runId, judged.success, {
      taskId: record.taskId,
    }).length;
  } catch {
    patternPatched = 0;
  }

  let skillConfirmed = 0;
  const agentId = opts?.agentId?.trim();
  if (agentId) {
    try {
      skillConfirmed = confirmSkillRunOutcomeFromTip({
        agentId,
        runId,
        taskId: record.taskId,
        success: judged.success,
        configDir: opts?.configDir,
      });
    } catch {
      skillConfirmed = 0;
    }
  }

  return {
    patternPatched,
    skillConfirmed,
    reason: judged.reason,
  };
}

/**
 * Append audit confirmation events for skills observed on the run.
 * Does not invent skill usage — only confirms tip outcome for skills already attributed.
 */
function confirmSkillRunOutcomeFromTip(params: {
  agentId: string;
  runId: string;
  taskId: string;
  success: boolean;
  configDir?: string;
}): number {
  const events = readSkillInvocationEvents({
    configDir: params.configDir,
    agentId: params.agentId,
  });
  const skillIds = new Set<string>();
  for (const ev of events) {
    if (ev.runId !== params.runId) {
      continue;
    }
    skillIds.add(ev.skillId);
  }
  let written = 0;
  for (const skillId of skillIds) {
    const invocationId = `${params.runId}:${skillId}:task_outcome_confirmed`;
    const already = events.some(
      (ev) =>
        ev.type === "skill_invocation_completed" &&
        ev.invocationId === invocationId &&
        ev.businessOutcome === "task_outcome_confirmed",
    );
    if (already) {
      continue;
    }
    recordSkillInvocationCompleted(
      {
        invocationId,
        skillId,
        agentId: params.agentId,
        runId: params.runId,
        taskId: params.taskId,
        outcome: params.success ? "success" : "failure",
        businessOutcome: "task_outcome_confirmed",
        failureCategory: params.success ? null : "task_outcome_failure",
      },
      params.configDir ? { configDir: params.configDir } : undefined,
    );
    written += 1;
  }
  return written;
}

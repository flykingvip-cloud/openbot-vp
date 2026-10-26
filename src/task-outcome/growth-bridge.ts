import type { OpenBotConfig } from "../config/config.js";
import { appendEvolutionTaskOutcome } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { computeEvaluationEligibility } from "./eligibility.js";
import { scopeIdOf } from "./transitions.js";
import type { TaskOutcomeRecord } from "./types.js";

/**
 * Sole recommended bridge from unified TaskOutcome → legacy evolution jsonl.
 * Callers must not appendEvolutionTaskOutcome for task-level success on their own
 * when using the unified path.
 */
export function publishEvolutionFromTaskOutcome(
  cfg: OpenBotConfig,
  agentId: string,
  record: TaskOutcomeRecord,
): { written: boolean; reason: string } {
  if (record.lifecycle !== "closed") {
    return { written: false, reason: "incomplete_not_published" };
  }
  const eligibility = computeEvaluationEligibility(record);
  if (record.taskJudgement === "cancelled") {
    return { written: false, reason: "cancelled_excluded" };
  }
  if (!eligibility.countsSkillSuccessRate && record.taskJudgement === "failure") {
    if (!eligibility.countsGrowthNegative && !eligibility.countsModelStability) {
      return { written: false, reason: `excluded:${eligibility.attribution}` };
    }
  }
  if (record.taskJudgement === "success" && !eligibility.countsSkillSuccessRate) {
    return { written: false, reason: "success_not_eligible" };
  }

  const tenantId =
    record.scope.kind === "enterprise" ? record.scope.tenantId : scopeIdOf(record.scope);

  appendEvolutionTaskOutcome(cfg, {
    agentId,
    occurredAt: Date.parse(record.decidedAt),
    succeeded: record.taskJudgement === "success",
    runId: record.decisiveRunId,
    tenantId,
    taskId: record.taskId,
  });
  return { written: true, reason: "published" };
}

import fs from "node:fs";
import type { OpenBotConfig } from "../config/config.js";
import {
  appendEvolutionTaskOutcome,
  resolveEvolutionTaskOutcomesPath,
  type EvolutionTaskOutcomeRecord,
} from "../gateway/agent-growth/evolution-task-outcomes.js";
import { computeEvaluationEligibility } from "./eligibility.js";
import { scopeIdOf } from "./transitions.js";
import type { TaskOutcomeRecord } from "./types.js";

type EvolutionWithKey = EvolutionTaskOutcomeRecord & {
  outcomeVersion?: number;
  taskOutcomeKey?: string;
};

function alreadyPublished(
  cfg: OpenBotConfig,
  agentId: string,
  taskId: string,
  outcomeVersion: number,
): boolean {
  const filePath = resolveEvolutionTaskOutcomesPath(cfg, agentId);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const key = `${taskId}@${outcomeVersion}`;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const obj = JSON.parse(line) as EvolutionWithKey;
      if (obj.taskOutcomeKey === key) {
        return true;
      }
      if (obj.taskId === taskId && obj.outcomeVersion === outcomeVersion) {
        return true;
      }
    } catch {
      // ignore bad lines
    }
  }
  return false;
}

/**
 * Sole recommended bridge from unified TaskOutcome → legacy evolution jsonl.
 * Idempotent on taskId@outcomeVersion so handler replay cannot double-append.
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

  if (alreadyPublished(cfg, agentId, record.taskId, record.outcomeVersion)) {
    return { written: false, reason: "already_published" };
  }

  const tenantId =
    record.scope.kind === "enterprise" ? record.scope.tenantId : scopeIdOf(record.scope);

  const payload: EvolutionWithKey = {
    agentId,
    occurredAt: Date.parse(record.decidedAt),
    succeeded: record.taskJudgement === "success",
    runId: record.decisiveRunId,
    tenantId,
    taskId: record.taskId,
    outcomeVersion: record.outcomeVersion,
    taskOutcomeKey: `${record.taskId}@${record.outcomeVersion}`,
  };
  appendEvolutionTaskOutcome(cfg, payload);
  return { written: true, reason: "published" };
}

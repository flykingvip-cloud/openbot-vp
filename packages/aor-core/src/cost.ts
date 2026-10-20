import type { AorRunResult, StepTrace } from "./orchestrator.js";

/**
 * Cost observability (Stage 2).
 *
 * Turns per-step traces into aggregate summaries (by model, by task type) and a
 * markdown report. This is the data layer the Control Plane dashboard and the
 * OpenBot `gateway/billing` integration consume; it has no UI dependency.
 */

export interface CostByKey {
  costUsd: number;
  tokens: number;
  steps: number;
}

export interface CostSummary {
  totalCostUsd: number;
  totalTokens: number;
  steps: number;
  byModel: Record<string, CostByKey>;
  byTaskType: Record<string, CostByKey>;
}

function stepCostUsd(step: StepTrace): number {
  // Prefer real usage cost (from the gateway) when present; else the estimate.
  return step.usage.costUsd ?? step.estimatedCostUsd;
}

function bump(map: Record<string, CostByKey>, key: string, costUsd: number, tokens: number): void {
  const entry = (map[key] ??= { costUsd: 0, tokens: 0, steps: 0 });
  entry.costUsd += costUsd;
  entry.tokens += tokens;
  entry.steps += 1;
}

export function summarizeTrace(trace: StepTrace[]): CostSummary {
  const summary: CostSummary = {
    totalCostUsd: 0,
    totalTokens: 0,
    steps: 0,
    byModel: {},
    byTaskType: {},
  };
  for (const step of trace) {
    const cost = stepCostUsd(step);
    const tokens = step.usage.totalTokens;
    summary.totalCostUsd += cost;
    summary.totalTokens += tokens;
    summary.steps += 1;
    bump(summary.byModel, step.model, cost, tokens);
    bump(summary.byTaskType, step.taskType, cost, tokens);
  }
  return summary;
}

export function summarizeRuns(results: AorRunResult[]): CostSummary {
  return summarizeTrace(results.flatMap((r) => r.trace));
}

/** Render a per-step + by-model breakdown, OpenRouter-style observability. */
export function formatCostReportMarkdown(result: AorRunResult): string {
  const lines: string[] = [];
  lines.push(`Task: ${result.taskType}  |  total $${result.usage.costUsd?.toFixed(4) ?? "n/a"}`);
  lines.push("");
  lines.push("| step | task type | model | tokens | cost (usd) | eval |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: |");
  for (const step of result.trace) {
    const cost = stepCostUsd(step);
    const evalScore = step.evaluation ? step.evaluation.score.toFixed(2) : "-";
    lines.push(
      `| ${step.nodeId} | ${step.taskType} | ${step.model} | ${step.usage.totalTokens} | ${cost.toFixed(
        4,
      )} | ${evalScore} |`,
    );
  }
  const summary = summarizeTrace(result.trace);
  lines.push("");
  lines.push(
    `Total: ${summary.steps} step(s), ${summary.totalTokens} tokens, $${summary.totalCostUsd.toFixed(4)}`,
  );
  return lines.join("\n");
}

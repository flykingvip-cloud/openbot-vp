/** One policy row from the benchmark harness (or production aggregate). */
export interface OptimizationPolicyRow {
  policy: string;
  totalCostUsd: number;
  avgCompletion: number;
}

export interface OptimizationReportInput {
  /** Strong single-model baseline (e.g. always claude). */
  baseline: OptimizationPolicyRow;
  /** AOR routed policy. */
  optimized: OptimizationPolicyRow;
  /** Optional bandit-learned policy. */
  bandit?: OptimizationPolicyRow;
}

export interface OptimizationReport {
  costSavingsUsd: number;
  costSavingsPct: number;
  completionDelta: number;
  revenueShareUsd: number;
  revenueSharePct: number;
}

/** Default optimization revenue-share rate (Control Plane placeholder). */
export const DEFAULT_REVENUE_SHARE_RATE = 0.2;

/**
 * Compute savings vs baseline and a revenue-share estimate for billing ingest.
 */
export function computeOptimizationReport(
  input: OptimizationReportInput,
  revenueShareRate = DEFAULT_REVENUE_SHARE_RATE,
): OptimizationReport {
  const costSavingsUsd = Math.max(0, input.baseline.totalCostUsd - input.optimized.totalCostUsd);
  const costSavingsPct =
    input.baseline.totalCostUsd > 0 ? costSavingsUsd / input.baseline.totalCostUsd : 0;
  const completionDelta = input.optimized.avgCompletion - input.baseline.avgCompletion;
  const revenueShareUsd = costSavingsUsd * revenueShareRate;
  return {
    costSavingsUsd,
    costSavingsPct,
    completionDelta,
    revenueShareUsd,
    revenueSharePct: revenueShareRate,
  };
}

export function formatOptimizationReportMarkdown(
  input: OptimizationReportInput,
  report: OptimizationReport,
): string {
  const lines = [
    "## AOR Optimization Report",
    "",
    "| policy | completion | total cost (usd) |",
    "| --- | ---: | ---: |",
    `| baseline (${input.baseline.policy}) | ${(input.baseline.avgCompletion * 100).toFixed(0)}% | ${input.baseline.totalCostUsd.toFixed(4)} |`,
    `| optimized (${input.optimized.policy}) | ${(input.optimized.avgCompletion * 100).toFixed(0)}% | ${input.optimized.totalCostUsd.toFixed(4)} |`,
  ];
  if (input.bandit) {
    lines.push(
      `| bandit (${input.bandit.policy}) | ${(input.bandit.avgCompletion * 100).toFixed(0)}% | ${input.bandit.totalCostUsd.toFixed(4)} |`,
    );
  }
  lines.push(
    "",
    `Cost savings: $${report.costSavingsUsd.toFixed(4)} (${(report.costSavingsPct * 100).toFixed(1)}%)`,
    `Completion delta vs baseline: ${(report.completionDelta * 100).toFixed(1)} pts`,
    `Revenue share (${(report.revenueSharePct * 100).toFixed(0)}%): $${report.revenueShareUsd.toFixed(4)}`,
  );
  return lines.join("\n");
}

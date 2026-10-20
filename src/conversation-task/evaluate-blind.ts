/**
 * ConversationTask Runtime — blind-set offline evaluation runner (P1 round 2).
 *
 * Scores the frozen P1 detector/qualifier against the independently authored
 * BLIND_SAMPLES. Offline / shadow-only: no task, ledger, agent, or network.
 * Run: bun src/conversation-task/evaluate-blind.ts
 */

import { BLIND_SAMPLES } from "./blind-dataset.js";
import { formatEvaluationReport } from "./evaluate.js";
import { evaluateDataset, type EvaluationReport } from "./metrics.js";

export function runBlindEvaluation(): EvaluationReport {
  return evaluateDataset(BLIND_SAMPLES);
}

const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /conversation-task\/evaluate-blind\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  // eslint-disable-next-line no-console
  console.log(
    `BLIND SET (n=${BLIND_SAMPLES.length})\n${formatEvaluationReport(runBlindEvaluation())}`,
  );
}

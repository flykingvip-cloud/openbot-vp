/**
 * ConversationTask Runtime — offline evaluation runner (P1).
 *
 * Formats the shadow evaluation report (confusion matrix, Upgrade Precision,
 * Task Survival proxy, detection/per-class metrics). Runnable offline:
 *   bun src/conversation-task/evaluate.ts
 * It only reads the golden dataset and pure functions — no task, ledger, agent,
 * or network.
 */

import { evaluateDataset, type EvaluationReport } from "./metrics.js";
import { QUALIFICATION_KINDS, type QualificationKind } from "./types.js";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const SHORT_LABEL: Record<QualificationKind, string> = {
  chat: "chat",
  short_action: "short",
  reminder: "remind",
  scheduled_action: "sched",
  long_running_candidate: "L2",
  needs_clarification: "clarify",
};

export function formatEvaluationReport(report: EvaluationReport): string {
  const lines: string[] = [];
  lines.push("ConversationTask Runtime — P1 offline shadow evaluation");
  lines.push("=".repeat(60));
  lines.push(`Samples:                 ${report.total}`);
  lines.push(`Qualification accuracy:  ${pct(report.qualificationAccuracy)}`);
  lines.push(`Side-effect accuracy:    ${pct(report.sideEffectAccuracy)}`);
  lines.push("");
  lines.push("Upgrade (long_running_candidate):");
  lines.push(`  Upgrade Precision:     ${pct(report.upgradePrecision)}  (target >= 95%)`);
  lines.push(
    `  Upgrade Recall:        ${pct(report.upgradeRecall)}  (recall intentionally < 100%)`,
  );
  lines.push(
    `  Task Survival (proxy): ${pct(report.taskSurvivalProxy)}  (dataset proxy; runtime value needs P2+)`,
  );
  lines.push("");
  lines.push("Detection:");
  lines.push(`  Precision:             ${pct(report.detection.precision)}`);
  lines.push(`  Recall (all):          ${pct(report.detection.recall)}`);
  lines.push(`  Recall (excl. misses): ${pct(report.detection.recallExcludingIntentionalMisses)}`);
  lines.push(`  Intentional misses:    ${report.intentionalMisses}`);
  lines.push("");
  lines.push("Per-class (precision / recall / F1 / support):");
  for (const kind of QUALIFICATION_KINDS) {
    const s = report.perClass[kind];
    lines.push(
      `  ${kind.padEnd(24)} ${pct(s.precision).padStart(6)} / ${pct(s.recall).padStart(6)} / ${pct(s.f1).padStart(6)} / ${s.support}`,
    );
  }
  lines.push("");
  lines.push("Confusion matrix (rows = gold, cols = predicted):");
  const header = ["gold\\pred", ...QUALIFICATION_KINDS.map((k) => SHORT_LABEL[k])];
  lines.push(`  ${header.map((h) => h.padStart(8)).join("")}`);
  for (const gold of QUALIFICATION_KINDS) {
    const row = QUALIFICATION_KINDS.map((pred) =>
      String(report.confusion[gold][pred]).padStart(8),
    ).join("");
    lines.push(`  ${SHORT_LABEL[gold].padStart(8)}${row}`);
  }
  if (report.mismatches.length > 0) {
    lines.push("");
    lines.push("Mismatches (gold -> predicted):");
    for (const m of report.mismatches) {
      lines.push(`  ${m.id}: ${m.goldQualification} -> ${m.predicted}`);
    }
  }
  return lines.join("\n");
}

export function runEvaluation(): EvaluationReport {
  return evaluateDataset();
}

// Print when executed directly (tsx/bun). Guarded so importing stays silent.
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /conversation-task\/evaluate\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  // eslint-disable-next-line no-console
  console.log(formatEvaluationReport(runEvaluation()));
}

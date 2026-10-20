/**
 * ConversationTask Runtime — offline shadow metrics (P1).
 *
 * Scores the detector + qualifier against the golden dataset. All metrics are
 * shadow / offline; no task is created and no ledger is written. Key metrics:
 *  - Upgrade Precision: of turns predicted `long_running_candidate`, the fraction
 *    whose gold is truly L2. Precision-first design targets >= 95% (§13).
 *  - Task Survival (shadow proxy): of predicted L2 turns, the fraction whose gold
 *    would survive beyond the first run. A true runtime value needs P2+ execution
 *    data; here it is a dataset proxy and is labelled as such.
 *  - Detection precision/recall, per-class precision/recall/F1, confusion matrix.
 */

import { CONVERSATION_TASK_SAMPLES, type ConversationTaskSample } from "./dataset.js";
import { evaluateTurn } from "./replay.js";
import { QUALIFICATION_KINDS, type QualificationKind } from "./types.js";

export type ConfusionMatrix = Record<QualificationKind, Record<QualificationKind, number>>;

export type ClassScore = {
  support: number;
  predicted: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1: number;
};

export type DetectionScore = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  recallExcludingIntentionalMisses: number;
};

export type EvaluationReport = {
  total: number;
  qualificationAccuracy: number;
  confusion: ConfusionMatrix;
  perClass: Record<QualificationKind, ClassScore>;
  detection: DetectionScore;
  upgradePrecision: number;
  upgradeRecall: number;
  taskSurvivalProxy: number;
  sideEffectAccuracy: number;
  intentionalMisses: number;
  mismatches: Array<{
    id: string;
    goldQualification: QualificationKind;
    predicted: QualificationKind;
  }>;
};

function emptyConfusion(): ConfusionMatrix {
  const matrix = {} as ConfusionMatrix;
  for (const gold of QUALIFICATION_KINDS) {
    matrix[gold] = {} as Record<QualificationKind, number>;
    for (const pred of QUALIFICATION_KINDS) {
      matrix[gold][pred] = 0;
    }
  }
  return matrix;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function evaluateDataset(
  samples: readonly ConversationTaskSample[] = CONVERSATION_TASK_SAMPLES,
): EvaluationReport {
  const confusion = emptyConfusion();
  const mismatches: EvaluationReport["mismatches"] = [];

  let correct = 0;
  let sideEffectCorrect = 0;
  let detTP = 0;
  let detFP = 0;
  let detFN = 0;
  let detTN = 0;
  let detFNExcludingMisses = 0;
  let goldDetectedExcludingMisses = 0;
  let predictedL2 = 0;
  let predictedL2Correct = 0;
  let predictedL2Surviving = 0;
  let goldL2 = 0;
  let goldL2Predicted = 0;
  let intentionalMisses = 0;

  for (const sample of samples) {
    const decision = evaluateTurn(sample.input);
    const predicted = decision.qualification.kind;
    const gold = sample.goldQualification;
    confusion[gold][predicted] += 1;

    if (predicted === gold) {
      correct += 1;
    } else {
      mismatches.push({ id: sample.id, goldQualification: gold, predicted });
    }

    if (decision.sideEffect === sample.goldSideEffect) {
      sideEffectCorrect += 1;
    }

    // Detection scoring.
    const predDetected = decision.detection.detected;
    if (sample.goldDetected && predDetected) {
      detTP += 1;
    } else if (!sample.goldDetected && predDetected) {
      detFP += 1;
    } else if (sample.goldDetected && !predDetected) {
      detFN += 1;
    } else {
      detTN += 1;
    }

    if (sample.goldDetected && !sample.expectedDetectorMiss) {
      goldDetectedExcludingMisses += 1;
      if (!predDetected) {
        detFNExcludingMisses += 1;
      }
    }
    if (sample.expectedDetectorMiss) {
      intentionalMisses += 1;
    }

    // Upgrade + survival.
    if (predicted === "long_running_candidate") {
      predictedL2 += 1;
      if (gold === "long_running_candidate") {
        predictedL2Correct += 1;
      }
      if (sample.goldSurvivesFirstRound) {
        predictedL2Surviving += 1;
      }
    }
    if (gold === "long_running_candidate") {
      goldL2 += 1;
      if (predicted === "long_running_candidate") {
        goldL2Predicted += 1;
      }
    }
  }

  const perClass = {} as Record<QualificationKind, ClassScore>;
  for (const kind of QUALIFICATION_KINDS) {
    const support = samples.filter((s) => s.goldQualification === kind).length;
    let predicted = 0;
    let tp = 0;
    for (const gold of QUALIFICATION_KINDS) {
      predicted += confusion[gold][kind];
    }
    tp = confusion[kind][kind];
    const precision = ratio(tp, predicted);
    const recall = ratio(tp, support);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClass[kind] = { support, predicted, truePositives: tp, precision, recall, f1 };
  }

  return {
    total: samples.length,
    qualificationAccuracy: correct / samples.length,
    confusion,
    perClass,
    detection: {
      truePositives: detTP,
      falsePositives: detFP,
      falseNegatives: detFN,
      trueNegatives: detTN,
      precision: ratio(detTP, detTP + detFP),
      recall: ratio(detTP, detTP + detFN),
      recallExcludingIntentionalMisses: ratio(
        goldDetectedExcludingMisses - detFNExcludingMisses,
        goldDetectedExcludingMisses,
      ),
    },
    upgradePrecision: ratio(predictedL2Correct, predictedL2),
    upgradeRecall: ratio(goldL2Predicted, goldL2),
    taskSurvivalProxy: ratio(predictedL2Surviving, predictedL2),
    sideEffectAccuracy: sideEffectCorrect / samples.length,
    intentionalMisses,
    mismatches,
  };
}

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ThresholdContract = {
  contractVersion: string;
  evaluatorVersion: string;
  zeroDenominatorPolicy: "fail_closed";
  fixturePinStatus: "unset" | "pinned";
  fixtures: Record<
    string,
    {
      path: string;
      pinStatus: "unset" | "pinned";
      sha256: string | null;
    }
  >;
  minSampleSize: Record<string, number>;
  metrics: Record<
    string,
    {
      max: number;
      formula: string;
      denominator: string;
      numerator: string;
    }
  >;
};

export type EvaluatorRow = {
  label: string;
  applied?: boolean;
  detected?: boolean;
  promoted?: boolean;
  recalledRetired?: boolean;
  error?: string;
};

export type EvaluateThresholdsParams = {
  contract: ThresholdContract;
  repoRoot?: string;
  rows?: {
    mergeConflictNegative?: EvaluatorRow[];
    mergeEquivPositive?: EvaluatorRow[];
    conflictMustDetect?: EvaluatorRow[];
    promotionShadowNegative?: EvaluatorRow[];
    retiredRecallViolations?: EvaluatorRow[];
  };
};

export type EvaluateThresholdsResult =
  | { ok: true; metrics: Record<string, { value: number; passed: boolean }> }
  | { ok: false; error: string };

const SUPPORTED_EVALUATOR = "cognitive-evaluator-v1";

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function rate(numerator: number, denominator: number): number | "zero_denominator" {
  if (denominator === 0) {
    return "zero_denominator";
  }
  return numerator / denominator;
}

/**
 * Evaluation-threshold evaluator (B28). Refuses `fixturePinStatus: unset`.
 * `falseMergeRate` denominator is the must_not_merge / merge-conflict-negative set.
 */
export function evaluateCognitiveThresholds(
  params: EvaluateThresholdsParams,
): EvaluateThresholdsResult {
  const contract = params.contract;
  if (contract.evaluatorVersion !== SUPPORTED_EVALUATOR) {
    return { ok: false, error: "evaluator_version_mismatch" };
  }
  if (contract.zeroDenominatorPolicy !== "fail_closed") {
    return { ok: false, error: "zero_denominator_policy_unsupported" };
  }
  if (contract.fixturePinStatus === "unset") {
    return { ok: false, error: "fixture_pin_unset" };
  }
  if (contract.fixturePinStatus !== "pinned") {
    return { ok: false, error: "fixture_pin_invalid" };
  }
  const root = params.repoRoot ?? process.cwd();
  for (const fixture of Object.values(contract.fixtures)) {
    if (fixture.pinStatus !== "pinned" || !fixture.sha256) {
      return { ok: false, error: "fixture_pin_unset" };
    }
    const dest = path.resolve(root, fixture.path);
    if (!fs.existsSync(dest)) {
      return { ok: false, error: "fixture_missing" };
    }
    if (sha256File(dest) !== fixture.sha256) {
      return { ok: false, error: "fixture_hash_mismatch" };
    }
  }

  const allRows = [
    ...(params.rows?.mergeConflictNegative ?? []),
    ...(params.rows?.mergeEquivPositive ?? []),
    ...(params.rows?.conflictMustDetect ?? []),
    ...(params.rows?.promotionShadowNegative ?? []),
    ...(params.rows?.retiredRecallViolations ?? []),
  ];
  if (allRows.some((row) => row.error)) {
    return { ok: false, error: "evaluator_error" };
  }

  const positives = params.rows?.mergeEquivPositive ?? [];
  if (contract.fixtures.mergeEquivPositive) {
    const shouldMerge = positives.filter((row) => row.label === "should_merge");
    if (shouldMerge.length === 0) {
      return { ok: false, error: "positive_merge_not_executed" };
    }
    if (shouldMerge.filter((row) => row.applied === true).length === 0) {
      return { ok: false, error: "positive_merge_all_rejected" };
    }
  }

  const negatives = params.rows?.mergeConflictNegative ?? [];
  const mustNotMerge = negatives.filter((row) => row.label === "must_not_merge");
  const falseMerges = mustNotMerge.filter((row) => row.applied === true).length;
  const falseMergeRate = rate(falseMerges, mustNotMerge.length);

  const detect = params.rows?.conflictMustDetect ?? [];
  const mustDetect = detect.filter((row) => row.label === "must_detect");
  const missed = mustDetect.filter((row) => row.detected !== true).length;
  const missedConflictRate = rate(missed, mustDetect.length);

  const promo = params.rows?.promotionShadowNegative ?? [];
  const mustNotPromote = promo.filter((row) => row.label === "must_not_promote");
  const falsePromo = mustNotPromote.filter((row) => row.promoted === true).length;
  const falsePromotionRate = rate(falsePromo, mustNotPromote.length);

  const retired = params.rows?.retiredRecallViolations ?? [];
  const retiredRate = rate(
    retired.filter((row) => row.recalledRetired === true).length,
    retired.length,
  );

  const computed: Record<string, number | "zero_denominator"> = {
    falseMergeRate,
    missedConflictRate,
    falsePromotionRate,
    retiredInDefaultRecallMax: retiredRate,
  };
  const metrics: Record<string, { value: number; passed: boolean }> = {};
  for (const [name, spec] of Object.entries(contract.metrics)) {
    const value = computed[name];
    if (value === undefined || value === "zero_denominator") {
      return { ok: false, error: "zero_denominator" };
    }
    const min = contract.minSampleSize[name] ?? 0;
    const sample =
      name === "falseMergeRate"
        ? mustNotMerge.length
        : name === "missedConflictRate"
          ? mustDetect.length
          : name === "falsePromotionRate"
            ? mustNotPromote.length
            : retired.length;
    if (sample < min) {
      return { ok: false, error: `min_sample_size:${name}` };
    }
    metrics[name] = { value, passed: value <= spec.max };
  }
  const passed = Object.values(metrics).every((item) => item.passed);
  return passed ? { ok: true, metrics } : { ok: false, error: "threshold_exceeded" };
}

export function loadThresholdContract(filePath: string): ThresholdContract {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as ThresholdContract;
}

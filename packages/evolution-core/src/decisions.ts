import { canPromoteWithExternalEffect, type ExternalEffectOutcome } from "./external-effect.js";
import { assessTwoProportion } from "./statistics.js";
import type {
  ApplicationScope,
  ExperimentResult,
  EvolutionExperiment,
  EvolutionProposal,
  EvolutionVerification,
  GuardrailResult,
  MetricContract,
  StatisticalAssessment,
  VerificationOutcome,
} from "./types.js";

export type MetricSample = {
  contract: MetricContract;
  baseline: number;
  treatment: number;
};

export type RollbackDrill = "passed" | "failed" | "not_run";

export type EvaluateExperimentInput = {
  primary: MetricSample;
  guardrails: MetricSample[];
  sampleSize: number;
  minimumSampleSize: number;
  confidence: number | null;
  requiredConfidence: number;
  baselineContaminated: boolean;
  modelVersionChanged: boolean;
  rollbackDrill: RollbackDrill;
  assessmentMode?: "statistical" | "deterministic-fixture";
  windowOverlap?: boolean;
  configDrift?: boolean;
  cohortContaminated?: boolean;
  treatmentPremature?: boolean;
};

export type ExperimentDecision = {
  result: Exclude<ExperimentResult, "pending">;
  reasons: string[];
  guardrailResults: GuardrailResult[];
  primaryEffect: number | null;
  assessment: StatisticalAssessment;
};

export function signedEffect(sample: MetricSample): number {
  return sample.contract.improveWhen === "increase"
    ? sample.treatment - sample.baseline
    : sample.baseline - sample.treatment;
}

export function evaluateGuardrail(sample: MetricSample): GuardrailResult {
  const effect = signedEffect(sample);
  const maxRegression = sample.contract.maxRegression ?? 0;
  const degraded = effect < 0;
  const withinBudget = effect >= -maxRegression;
  return {
    metricId: sample.contract.metricId,
    baseline: sample.baseline,
    treatment: sample.treatment,
    degraded,
    critical: Boolean(sample.contract.critical),
    withinBudget,
  };
}

function assessmentFor(input: EvaluateExperimentInput): StatisticalAssessment {
  if (input.assessmentMode === "deterministic-fixture") {
    return {
      method: "deterministic-fixture",
      baselineTrials: input.sampleSize,
      treatmentTrials: input.sampleSize,
      confidence: input.confidence,
      notes: ["offline_deterministic_contract"],
    };
  }
  return assessTwoProportion({
    baselineRate: input.primary.baseline,
    baselineTrials: input.sampleSize,
    treatmentRate: input.primary.treatment,
    treatmentTrials: input.sampleSize,
    minimumTrials: input.minimumSampleSize,
  });
}

export function evaluateExperiment(input: EvaluateExperimentInput): ExperimentDecision {
  const reasons: string[] = [];
  const guardrailResults = input.guardrails.map(evaluateGuardrail);
  const primaryEffect = signedEffect(input.primary);
  const assessment = assessmentFor(input);

  if (input.baselineContaminated) {
    reasons.push("baseline_contaminated");
  }
  if (input.modelVersionChanged) {
    reasons.push("model_version_changed");
  }
  if (input.windowOverlap) {
    reasons.push("window_overlap");
  }
  if (input.configDrift) {
    reasons.push("config_drift");
  }
  if (input.cohortContaminated) {
    reasons.push("cohort_contaminated");
  }
  if (input.treatmentPremature) {
    reasons.push("treatment_premature");
  }
  if (input.sampleSize < input.minimumSampleSize) {
    reasons.push("sample_size_insufficient");
  }
  if (input.assessmentMode !== "deterministic-fixture") {
    const confidence = assessment.confidence;
    if (confidence === null || confidence < input.requiredConfidence) {
      reasons.push("confidence_insufficient");
    }
  }
  if (reasons.length > 0) {
    return {
      result: "inconclusive",
      reasons,
      guardrailResults,
      primaryEffect,
      assessment,
    };
  }

  if (input.rollbackDrill === "failed") {
    return {
      result: "regressed",
      reasons: ["rollback_drill_failed"],
      guardrailResults,
      primaryEffect,
      assessment,
    };
  }
  if (input.rollbackDrill === "not_run") {
    return {
      result: "inconclusive",
      reasons: ["rollback_drill_not_run"],
      guardrailResults,
      primaryEffect,
      assessment,
    };
  }

  const criticalRegression = guardrailResults.find((row) => row.critical && !row.withinBudget);
  if (criticalRegression) {
    return {
      result: "regressed",
      reasons: [`critical_guardrail:${criticalRegression.metricId}`],
      guardrailResults,
      primaryEffect,
      assessment,
    };
  }

  const budgetBreach = guardrailResults.find((row) => !row.critical && !row.withinBudget);
  if (budgetBreach) {
    return {
      result: "regressed",
      reasons: [`guardrail_budget:${budgetBreach.metricId}`],
      guardrailResults,
      primaryEffect,
      assessment,
    };
  }

  if (primaryEffect >= input.primary.contract.minimumEffect) {
    return {
      result: "improved",
      reasons: ["primary_met"],
      guardrailResults,
      primaryEffect,
      assessment,
    };
  }
  if (Math.abs(primaryEffect) < input.primary.contract.minimumEffect) {
    return {
      result: "neutral",
      reasons: ["primary_within_deadband"],
      guardrailResults,
      primaryEffect,
      assessment,
    };
  }
  return {
    result: "regressed",
    reasons: ["primary_regressed"],
    guardrailResults,
    primaryEffect,
    assessment,
  };
}

export type ApplicationApprovalWaiver = {
  granted: true;
  approverRef: string;
  reason: string;
};

export function canApproveApplication(
  experiment: Pick<EvolutionExperiment, "result" | "baselineCapture" | "candidateValidated">,
  waiver?: ApplicationApprovalWaiver,
  scope?: ApplicationScope,
): { ok: true } | { ok: false; code: string; reason: string } {
  if (scope === "shadow") {
    return { ok: true };
  }
  if (scope === "canary") {
    if (experiment.result === "regressed") {
      return {
        ok: false,
        code: "experiment_regressed",
        reason: "canary apply is blocked after a regressed experiment",
      };
    }
    const capture = experiment.baselineCapture;
    if (!capture || capture.status === "missing") {
      return {
        ok: false,
        code: "baseline_missing",
        reason:
          "canary requires a frozen baseline; pending experiments without baseline cannot apply",
      };
    }
    if (
      capture.status !== "frozen" ||
      !capture.primaryPresent ||
      capture.missingCriticalGuardrails.length > 0
    ) {
      return {
        ok: false,
        code: "baseline_incomplete",
        reason: "canary requires a frozen baseline with the primary and every critical guardrail",
      };
    }
    if (experiment.candidateValidated !== true) {
      return {
        ok: false,
        code: "candidate_not_validated",
        reason: "canary requires the governed candidate to pass domain validate",
      };
    }
    return { ok: true };
  }
  if (experiment.result === "improved") {
    return { ok: true };
  }
  if (waiver?.granted && experiment.result !== "regressed" && experiment.result !== "pending") {
    return { ok: true };
  }
  return {
    ok: false,
    code: "experiment_not_approved",
    reason: "APPROVED_FOR_APPLICATION requires an improved experiment or an authority waiver",
  };
}

export function canMarkVerified(
  verification: Pick<EvolutionVerification, "outcome" | "sampleSize"> & {
    minimumSampleSize: number;
  },
): { ok: true } | { ok: false; code: string; reason: string } {
  if (verification.outcome !== "improved") {
    return {
      ok: false,
      code: "verification_not_improved",
      reason: "VERIFIED requires a metric outcome of improved, not a linked receipt",
    };
  }
  if (verification.sampleSize < verification.minimumSampleSize) {
    return {
      ok: false,
      code: "sample_size_insufficient",
      reason: "VERIFIED requires the declared minimum sample size",
    };
  }
  return { ok: true };
}

export function verificationOutcomeFromDecision(
  result: Exclude<ExperimentResult, "pending">,
): VerificationOutcome {
  return result;
}

export function isLinkedReceiptOutcome(outcome: string): boolean {
  return outcome === "linked";
}

export function canHold(
  proposal: Pick<EvolutionProposal, "status" | "experimentId">,
): { ok: true } | { ok: false; code: string; reason: string } {
  if (proposal.status !== "EXPERIMENTING") {
    return {
      ok: false,
      code: "not_experimenting",
      reason: "hold requires an active EXPERIMENTING proposal",
    };
  }
  if (!proposal.experimentId?.trim()) {
    return {
      ok: false,
      code: "experiment_missing",
      reason: "hold requires a bound experiment",
    };
  }
  return { ok: true };
}

export function canPromote(
  proposal: Pick<EvolutionProposal, "status" | "verificationId" | "riskLevel">,
  extras?: {
    requireExternalEffect?: boolean;
    externalEffectOutcome?: ExternalEffectOutcome | null;
  },
): { ok: true } | { ok: false; code: string; reason: string } {
  return canPromoteWithExternalEffect({
    proposalStatus: proposal.status,
    verificationId: proposal.verificationId,
    riskLevel: proposal.riskLevel,
    requireExternalEffect: extras?.requireExternalEffect === true,
    externalEffectOutcome: extras?.externalEffectOutcome,
  });
}

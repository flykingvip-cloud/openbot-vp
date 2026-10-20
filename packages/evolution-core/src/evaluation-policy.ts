/**
 * Per-surface / per-producer evaluation policy.
 *
 * There is no global three-vote rule. Diagnosis Recheck is required only for
 * diagnosis-origin proposals. Missing findings must not block other producers.
 *
 * Negative facts (guardrail / experiment / external / recheck regression) are
 * evaluated before sample, confidence, or rollback-drill gaps. A missing drill
 * only blocks Promote.
 */
import type { DiagnosisRecheckOutcome } from "./diagnosis-recheck.js";
import type { ExternalEffectOutcome } from "./external-effect.js";
import { GUARDRAIL_METRIC_IDS } from "./metrics.js";
import type { ExperimentResult } from "./types.js";

export const EVALUATION_PRODUCER_KINDS = [
  "diagnosis-origin",
  "pattern-origin",
  "governance-origin",
  "operator-origin",
] as const;
export type EvaluationProducerKind = (typeof EVALUATION_PRODUCER_KINDS)[number];

export const DIAGNOSIS_RECHECK_POLICIES = ["required", "optional", "unsupported"] as const;
export type DiagnosisRecheckPolicy = (typeof DIAGNOSIS_RECHECK_POLICIES)[number];

export const EVALUATION_ACTIONS = ["promote", "hold", "rollback", "observe", "block"] as const;
export type EvaluationAction = (typeof EVALUATION_ACTIONS)[number];

export type EvaluationPolicy = {
  surfaceId: string;
  producerKind: EvaluationProducerKind;
  requiredSignals: readonly string[];
  requiredExternalVerifier: string | null;
  diagnosisRecheckPolicy: DiagnosisRecheckPolicy;
  minimumSampleSize: number;
  requiredConfidence: number;
  guardrailMetricIds: readonly string[];
  rollbackDrillRequired: boolean;
};

export type EvaluationDecision = {
  action: EvaluationAction;
  reasonCode: string;
};

export type EvaluationSignals = {
  experimentResult: Exclude<ExperimentResult, "pending">;
  guardrailDegraded: boolean;
  authorityOk: boolean;
  domainVerified: boolean;
  externalEffectOutcome: ExternalEffectOutcome | null;
  recheck: DiagnosisRecheckOutcome | null;
  sampleSize: number;
  confidence: number | null;
  rollbackDrillPassed: boolean;
};

const DEFAULT_SIGNALS = ["experiment", "guardrails", "authority", "domain_verification"] as const;

function basePolicy(
  surfaceId: string,
  producerKind: EvaluationProducerKind,
  extras: Pick<EvaluationPolicy, "requiredExternalVerifier" | "diagnosisRecheckPolicy"> & {
    requiredSignals?: readonly string[];
  },
): EvaluationPolicy {
  const diagnosisRequired = extras.diagnosisRecheckPolicy === "required";
  return {
    surfaceId,
    producerKind,
    requiredSignals: extras.requiredSignals ?? [
      ...DEFAULT_SIGNALS,
      ...(diagnosisRequired ? (["diagnosis_recheck"] as const) : []),
    ],
    requiredExternalVerifier: extras.requiredExternalVerifier,
    diagnosisRecheckPolicy: extras.diagnosisRecheckPolicy,
    minimumSampleSize: 20,
    requiredConfidence: 0.9,
    guardrailMetricIds: GUARDRAIL_METRIC_IDS,
    rollbackDrillRequired: true,
  };
}

const PHASE1_SURFACES = new Set(["agent.working-dna", "capability.skill-installation"]);

export function evaluationPolicyFor(input: {
  surfaceId: string;
  producerKind: EvaluationProducerKind;
}): EvaluationPolicy | { ok: false; code: "unknown_surface" | "unknown_producer" } {
  if (!(EVALUATION_PRODUCER_KINDS as readonly string[]).includes(input.producerKind)) {
    return { ok: false, code: "unknown_producer" };
  }
  const recheckPolicy: DiagnosisRecheckPolicy =
    input.producerKind === "diagnosis-origin" ? "required" : "unsupported";
  if (input.surfaceId === "agent.working-dna") {
    return basePolicy(input.surfaceId, input.producerKind, {
      requiredExternalVerifier: "working-dna-read-after-write",
      diagnosisRecheckPolicy: recheckPolicy,
    });
  }
  if (input.surfaceId === "capability.skill-installation") {
    return basePolicy(input.surfaceId, input.producerKind, {
      requiredExternalVerifier: "skill-installation-read-after-write",
      diagnosisRecheckPolicy: recheckPolicy,
    });
  }
  return { ok: false, code: "unknown_surface" };
}

export function isPhase1EvaluationSurface(surfaceId: string): boolean {
  return PHASE1_SURFACES.has(surfaceId);
}

export function evaluationProducerKindFromMechanism(mechanism: string): EvaluationProducerKind {
  const value = mechanism.trim();
  if (value.startsWith("diagnosis.")) {
    return "diagnosis-origin";
  }
  if (value.startsWith("pattern")) {
    return "pattern-origin";
  }
  if (value.startsWith("governance") || value.includes("runtime-binding")) {
    return "governance-origin";
  }
  return "operator-origin";
}

function negativeRollback(signals: EvaluationSignals): EvaluationDecision | null {
  if (signals.guardrailDegraded) {
    return { action: "rollback", reasonCode: "guardrail_degraded" };
  }
  if (signals.experimentResult === "regressed") {
    return { action: "rollback", reasonCode: "experiment_regressed" };
  }
  if (signals.externalEffectOutcome === "contradicted") {
    return { action: "rollback", reasonCode: "external_effect_contradicted" };
  }
  if (signals.recheck === "REGRESSED") {
    return { action: "rollback", reasonCode: "finding_regressed" };
  }
  return null;
}

export function decideEvaluationOutcome(
  policy: EvaluationPolicy,
  signals: EvaluationSignals,
): EvaluationDecision {
  if (!signals.authorityOk) {
    return { action: "block", reasonCode: "authorization_required" };
  }
  if (!signals.domainVerified) {
    return { action: "block", reasonCode: "domain_unverified" };
  }

  const rollback = negativeRollback(signals);
  if (rollback) {
    return rollback;
  }

  if (signals.sampleSize < policy.minimumSampleSize || signals.confidence === null) {
    return { action: "observe", reasonCode: "sample_insufficient" };
  }
  if (signals.confidence < policy.requiredConfidence) {
    return { action: "observe", reasonCode: "confidence_insufficient" };
  }
  if (signals.experimentResult === "inconclusive") {
    return { action: "observe", reasonCode: "experiment_inconclusive" };
  }

  if (policy.requiredExternalVerifier && signals.externalEffectOutcome !== "verified") {
    return { action: "observe", reasonCode: "external_effect_required" };
  }

  if (policy.diagnosisRecheckPolicy === "required") {
    if (signals.recheck == null) {
      return { action: "block", reasonCode: "recheck_required" };
    }
    if (signals.recheck === "STILL_OPEN") {
      return { action: "hold", reasonCode: "finding_still_open" };
    }
    if (signals.recheck === "INCONCLUSIVE") {
      return { action: "observe", reasonCode: "recheck_inconclusive" };
    }
    if (signals.recheck === "BLOCKED") {
      return { action: "block", reasonCode: "recheck_blocked" };
    }
    if (signals.recheck !== "RESOLVED") {
      return { action: "block", reasonCode: "recheck_required" };
    }
  }

  if (signals.experimentResult !== "improved") {
    return { action: "hold", reasonCode: "experiment_not_improved" };
  }
  if (policy.rollbackDrillRequired && !signals.rollbackDrillPassed) {
    return { action: "observe", reasonCode: "rollback_drill_not_run" };
  }
  return { action: "promote", reasonCode: "evaluation_passed" };
}

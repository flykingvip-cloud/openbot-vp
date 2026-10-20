import type {
  DiagnosisRecheckOutcome,
  EvolutionExperiment,
  EvolutionProposal,
  ExperimentResult,
} from "@openbot/evolution-core";

export type DiagnosisApplyFollowUp = "promote" | "hold" | "rollback" | "observe" | "fail-closed";

export function isDiagnosisSourced(proposal: { sourceMechanismRef?: string | null }): boolean {
  return (proposal.sourceMechanismRef ?? "").startsWith("diagnosis.");
}

/** improved diagnosis experiments wait here. This is not an Apply. */
export function diagnosisApplyApprovalFor(
  proposal: { sourceMechanismRef?: string | null },
  result: ExperimentResult,
): "pending_apply_approval" | undefined {
  if (isDiagnosisSourced(proposal) && result === "improved") {
    return "pending_apply_approval";
  }
  return undefined;
}

/**
 * Diagnosis-source canary/active/shadow Apply.
 * Runs before any experiment or application write. Non-diagnosis surfaces keep
 * the existing EvaluationPolicy, including canary before a result exists.
 *
 * Diagnosis canary is the observation write: treatment metrics cannot exist
 * until an application is applied. Active and shadow still require an improved
 * result that is waiting for the operator. Canary does not register approval.
 */
export function assertDiagnosisControlledApply(input: {
  proposal: EvolutionProposal;
  experiment: EvolutionExperiment;
  now: string;
  scope?: "shadow" | "canary" | "active";
}): void {
  if (!isDiagnosisSourced(input.proposal)) {
    return;
  }
  const expiresAt = Date.parse(input.proposal.expiresAt);
  const nowMs = Date.parse(input.now);
  if (Number.isFinite(expiresAt) && Number.isFinite(nowMs) && expiresAt <= nowMs) {
    throw new Error("diagnosis proposal is expired");
  }
  if (input.scope === "canary") {
    return;
  }
  if (
    input.experiment.result !== "improved" ||
    input.experiment.applyApproval !== "pending_apply_approval"
  ) {
    throw new Error("diagnosis apply requires an improved experiment awaiting operator approval");
  }
}

/**
 * Maps Diagnosis Recheck facts to a recommendation.
 * Does not call Promote, Hold, or Rollback, and does not replace EvaluationPolicy.
 */
export function recommendDiagnosisApplyFollowUp(input: {
  recheckOutcome: DiagnosisRecheckOutcome;
  guardrailRegressed?: boolean;
  sotReadable?: boolean;
}): DiagnosisApplyFollowUp {
  if (input.sotReadable === false || input.recheckOutcome === "BLOCKED") {
    return "fail-closed";
  }
  if (input.guardrailRegressed || input.recheckOutcome === "REGRESSED") {
    return "rollback";
  }
  if (input.recheckOutcome === "STILL_OPEN") {
    return "hold";
  }
  if (input.recheckOutcome === "INCONCLUSIVE") {
    return "observe";
  }
  if (input.recheckOutcome === "RESOLVED") {
    return "promote";
  }
  return "fail-closed";
}

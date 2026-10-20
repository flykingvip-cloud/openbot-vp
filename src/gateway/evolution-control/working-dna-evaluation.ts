/**
 * Working DNA evaluation slice. Reuses Experiment, Adapter, Ledger, and
 * the external-effect verifier. Does not create a second score system.
 *
 * Diagnosis-origin proposals must pass EvaluationPolicy + Diagnosis Recheck
 * before Promote. Other producers keep the existing canPromote path.
 */
import {
  assertDiagnosisRecheckBinding,
  decideEvaluationOutcome,
  evaluationPolicyFor,
  evaluationProducerKindFromMechanism,
  type DiagnosisRecheckPort,
  type EvaluationDecision,
  type EvaluationSignals,
  type EvolutionExperiment,
  type EvolutionProposal,
  type EvolutionVerification,
  type ExternalEffectOutcome,
  type RollbackDrillRecord,
} from "@openbot/evolution-core";

export type WorkingDnaEvaluationInput = {
  proposal: EvolutionProposal;
  experiment: EvolutionExperiment;
  verification?: EvolutionVerification;
  externalEffectOutcome: ExternalEffectOutcome | null;
  drills: readonly RollbackDrillRecord[];
  authorityOk: boolean;
  recheckPort?: DiagnosisRecheckPort;
};

export function workingDnaEvaluationApplies(proposal: EvolutionProposal): boolean {
  return diagnosisOriginSurfaceApplies(proposal, "agent.working-dna");
}

export function skillInstallationEvaluationApplies(proposal: EvolutionProposal): boolean {
  return diagnosisOriginSurfaceApplies(proposal, "capability.skill-installation");
}

export function diagnosisOriginEvaluationApplies(proposal: EvolutionProposal): boolean {
  return workingDnaEvaluationApplies(proposal) || skillInstallationEvaluationApplies(proposal);
}

function diagnosisOriginSurfaceApplies(proposal: EvolutionProposal, surfaceId: string): boolean {
  return (
    proposal.surfaceId === surfaceId &&
    evaluationProducerKindFromMechanism(proposal.sourceMechanismRef) === "diagnosis-origin"
  );
}

function explicitSkillIdPresent(proposal: EvolutionProposal): boolean {
  return proposal.target.domain === "capability" && Boolean(proposal.target.skillId.trim());
}

export async function evaluateWorkingDnaClosure(
  input: WorkingDnaEvaluationInput,
): Promise<EvaluationDecision> {
  return evaluatePhase1Closure(input);
}

export async function evaluateSkillInstallationClosure(
  input: WorkingDnaEvaluationInput,
): Promise<EvaluationDecision> {
  if (!explicitSkillIdPresent(input.proposal)) {
    return { action: "block", reasonCode: "unknown_target" };
  }
  return evaluatePhase1Closure(input);
}

async function evaluatePhase1Closure(
  input: WorkingDnaEvaluationInput,
): Promise<EvaluationDecision> {
  const producerKind = evaluationProducerKindFromMechanism(input.proposal.sourceMechanismRef);
  const policy = evaluationPolicyFor({
    surfaceId: input.proposal.surfaceId,
    producerKind,
  });
  if ("ok" in policy) {
    return { action: "block", reasonCode: policy.code };
  }
  if (input.experiment.baselineCapture?.status !== "frozen") {
    return { action: "observe", reasonCode: "baseline_not_frozen" };
  }
  const freeze = input.experiment.frozen;
  if (
    !freeze.candidateVersion.trim() ||
    !freeze.configSnapshotRef.trim() ||
    !freeze.modelRef.trim() ||
    !freeze.datasetOrCohortRef.trim()
  ) {
    return { action: "observe", reasonCode: "freeze_incomplete" };
  }
  const signals = await collectSignals(input, policy.diagnosisRecheckPolicy === "required");
  return decideEvaluationOutcome(policy, signals);
}

function experimentResultSignal(
  experiment: EvolutionExperiment,
  verification?: EvolutionVerification,
): EvaluationSignals["experimentResult"] {
  if (experiment.result !== "pending") {
    return experiment.result;
  }
  // verifyApplication records the outcome on Verification; it does not mutate
  // Experiment.result. Reuse that record instead of inventing a second score.
  return verification?.outcome ?? "inconclusive";
}

async function collectSignals(
  input: WorkingDnaEvaluationInput,
  recheckRequired: boolean,
): Promise<EvaluationSignals> {
  const experimentResult = experimentResultSignal(input.experiment, input.verification);
  const verification = input.verification;
  const guardrailDegraded = Boolean(verification?.guardrailResults.some((row) => row.degraded));
  const rollbackDrillPassed = input.drills.some((row) => row.result === "passed");
  let recheck: EvaluationSignals["recheck"] = null;
  if (recheckRequired) {
    recheck = await readRecheck(input);
  }
  return {
    experimentResult,
    guardrailDegraded,
    authorityOk: input.authorityOk,
    domainVerified: input.externalEffectOutcome === "verified",
    externalEffectOutcome: input.externalEffectOutcome,
    recheck,
    sampleSize: verification?.sampleSize ?? 0,
    confidence: verification?.confidence ?? null,
    rollbackDrillPassed,
  };
}

async function readRecheck(
  input: WorkingDnaEvaluationInput,
): Promise<EvaluationSignals["recheck"]> {
  if (!input.recheckPort || !input.verification || !input.proposal.experimentId) {
    return null;
  }
  const findingRefs = input.proposal.sourceEvidenceRefs.filter((ref) => ref.trim());
  if (findingRefs.length === 0) {
    return null;
  }
  const request = {
    verificationRef: {
      schemaVersion: 1 as const,
      proposalId: input.proposal.proposalId,
      experimentId: input.proposal.experimentId,
      applicationId: input.proposal.applicationId ?? "",
      verificationId: input.verification.verificationId,
    },
    target: input.proposal.target,
    findingRefs,
    surfaceId: input.proposal.surfaceId,
    tenantScope: input.proposal.tenantScope,
  };
  if (!request.verificationRef.applicationId) {
    return null;
  }
  const result = await input.recheckPort.recheck(request);
  const binding = assertDiagnosisRecheckBinding(request, result);
  if (!binding.ok) {
    return "BLOCKED";
  }
  return result.outcome;
}

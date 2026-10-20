import { evolutionTargetKey, type EvolutionExperiment, type EvolutionProposal } from "./types.js";

export function assertExperimentBoundToProposal(
  experiment: EvolutionExperiment,
  proposal: EvolutionProposal,
): void {
  if (experiment.proposalId !== proposal.proposalId) {
    throw new Error("experiment is not bound to this proposal");
  }
  if (experiment.candidateRef !== proposal.candidateRef) {
    throw new Error("experiment candidate does not match proposal candidate");
  }
  if (experiment.tenantScope !== proposal.tenantScope) {
    throw new Error("experiment tenant does not match proposal tenant");
  }
  if (experiment.surfaceId !== proposal.surfaceId) {
    throw new Error("experiment surface does not match proposal surface");
  }
  if (evolutionTargetKey(experiment.target) !== evolutionTargetKey(proposal.target)) {
    throw new Error("experiment target does not match proposal target");
  }
  if (proposal.experimentId && proposal.experimentId !== experiment.experimentId) {
    throw new Error("proposal is bound to a different experiment");
  }
}

export function assertCandidateMatchesExperiment(input: {
  proposal: EvolutionProposal;
  experiment: EvolutionExperiment;
  candidateRef: string;
  version: string;
  payloadHash: string;
  expectedHash: string;
}): void {
  if (input.candidateRef !== input.proposal.candidateRef) {
    throw new Error("stored candidate is not the proposal candidate");
  }
  if (input.version !== input.experiment.candidateRef) {
    throw new Error("stored candidate version does not match the experimented candidate");
  }
  if (input.payloadHash !== input.expectedHash) {
    throw new Error("candidate payload hash mismatch");
  }
}

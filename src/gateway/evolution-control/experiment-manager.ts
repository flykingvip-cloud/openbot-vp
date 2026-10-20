import {
  canApproveApplication,
  evaluateExperiment,
  evolutionTargetKey,
  type ApplicationApprovalWaiver,
  type ApplicationScope,
  type EvaluateExperimentInput,
  type EvolutionExperiment,
  type EvolutionProposal,
  type ExperimentDecision,
  type ExperimentFreeze,
} from "@openbot/evolution-core";

export type ExperimentStore = {
  get(experimentId: string): EvolutionExperiment | undefined;
  put(experiment: EvolutionExperiment): void;
  listByTarget(targetKey: string): EvolutionExperiment[];
  listByProposal(proposalId: string): EvolutionExperiment[];
};

export function createMemoryExperimentStore(): ExperimentStore {
  const rows = new Map<string, EvolutionExperiment>();
  return {
    get: (id) => rows.get(id),
    put: (row) => {
      rows.set(row.experimentId, row);
    },
    listByProposal: (proposalId) =>
      [...rows.values()].filter((row) => row.proposalId === proposalId),
    listByTarget: () => [...rows.values()],
  };
}

export type CreateExperimentInput = {
  experimentId: string;
  proposal: EvolutionProposal;
  freeze: ExperimentFreeze;
  assignment: EvolutionExperiment["assignment"];
  primaryMetric: EvolutionExperiment["primaryMetric"];
  guardrailMetrics: EvolutionExperiment["guardrailMetrics"];
  minimumSampleSize: number;
  requiredConfidence: number;
  startedAt?: string;
};

const ACTIVE_RESULTS = new Set(["pending"]);

export function createExperiment(
  store: ExperimentStore,
  input: CreateExperimentInput,
  targetIndex: Map<string, string>,
): EvolutionExperiment {
  const targetKey = evolutionTargetKey(input.proposal.target);
  const existing = targetIndex.get(targetKey);
  if (existing) {
    const live = store.get(existing);
    if (live && ACTIVE_RESULTS.has(live.result)) {
      throw new Error(`active experiment already exists for ${targetKey}`);
    }
  }
  if (input.freeze.candidateVersion !== input.proposal.candidateRef) {
    throw new Error("experiment candidate must match proposal.candidateRef");
  }
  if (input.freeze.tenantScope !== input.proposal.tenantScope) {
    throw new Error("experiment tenant must match proposal tenant");
  }
  const experiment: EvolutionExperiment = {
    schemaVersion: 1,
    experimentId: input.experimentId,
    proposalId: input.proposal.proposalId,
    surfaceId: input.proposal.surfaceId,
    target: input.proposal.target,
    tenantScope: input.proposal.tenantScope,
    baselineRef: input.freeze.baselineVersion,
    candidateRef: input.proposal.candidateRef,
    configRef: input.freeze.configSnapshotRef,
    assignment: input.assignment,
    primaryMetric: input.primaryMetric,
    guardrailMetrics: input.guardrailMetrics,
    minimumSampleSize: input.minimumSampleSize,
    requiredConfidence: input.requiredConfidence,
    expiresAt: input.freeze.expiresAt,
    result: "pending",
    frozen: input.freeze,
    baselineCapture: {
      status: "missing",
      primaryPresent: false,
      missingCriticalGuardrails: input.guardrailMetrics
        .filter((row) => row.critical)
        .map((row) => row.metricId),
    },
    candidateValidated: false,
    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
    ...(input.freeze.datasetOrCohortRef ? { datasetRef: input.freeze.datasetOrCohortRef } : {}),
    ...(input.freeze.modelRef ? { modelRef: input.freeze.modelRef } : {}),
  };
  store.put(experiment);
  targetIndex.set(targetKey, experiment.experimentId);
  return experiment;
}

export function evaluateStoredExperiment(
  store: ExperimentStore,
  experimentId: string,
  input: EvaluateExperimentInput,
): { experiment: EvolutionExperiment; decision: ExperimentDecision } {
  const current = store.get(experimentId);
  if (!current) {
    throw new Error(`experiment not found: ${experimentId}`);
  }
  if (
    input.modelVersionChanged ||
    current.frozen.modelRef !== (current.modelRef ?? current.frozen.modelRef)
  ) {
    input = { ...input, modelVersionChanged: true };
  }
  const decision = evaluateExperiment(input);
  const next: EvolutionExperiment = { ...current, result: decision.result };
  store.put(next);
  return { experiment: next, decision };
}

export function assertApplicationApproval(
  experiment: EvolutionExperiment,
  waiver?: ApplicationApprovalWaiver,
  scope?: ApplicationScope,
): void {
  const allowed = canApproveApplication(experiment, waiver, scope);
  if (!allowed.ok) {
    throw new Error(allowed.reason);
  }
}

export function assignmentOverlaps(
  left: EvolutionExperiment["assignment"],
  right: EvolutionExperiment["assignment"],
): boolean {
  const leftSet = new Set([...left.treatmentRefs, ...left.controlRefs]);
  return [...right.treatmentRefs, ...right.controlRefs].some((id) => leftSet.has(id));
}

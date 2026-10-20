import type { MetricObservation } from "./contracts.js";
import {
  evolutionTargetKey,
  type EvolutionExperiment,
  type ExperimentBaselineCapture,
  type ObservationWindow,
} from "./types.js";

export function classifyBaselineCapture(input: {
  experiment: Pick<EvolutionExperiment, "primaryMetric" | "guardrailMetrics" | "experimentId">;
  samples: readonly MetricObservation[];
  window?: ObservationWindow;
}): ExperimentBaselineCapture {
  const primaryPresent = input.samples.some(
    (row) => row.metricId === input.experiment.primaryMetric.metricId && row.sampleSize > 0,
  );
  const missingCriticalGuardrails = input.experiment.guardrailMetrics
    .filter((row) => row.critical)
    .filter(
      (row) =>
        !input.samples.some((sample) => sample.metricId === row.metricId && sample.sampleSize > 0),
    )
    .map((row) => row.metricId);
  if (input.samples.every((row) => row.sampleSize <= 0) && !primaryPresent) {
    return {
      status: "missing",
      primaryPresent: false,
      missingCriticalGuardrails,
      ...(input.window ? { window: input.window } : {}),
    };
  }
  if (!primaryPresent || missingCriticalGuardrails.length > 0) {
    return {
      status: "incomplete",
      primaryPresent,
      missingCriticalGuardrails,
      ...(input.window ? { window: input.window } : {}),
    };
  }
  return {
    status: "frozen",
    primaryPresent: true,
    missingCriticalGuardrails: [],
    ...(input.window ? { window: input.window } : {}),
  };
}

export function buildObservationWindow(input: {
  experiment: Pick<EvolutionExperiment, "experimentId" | "target" | "tenantScope" | "frozen">;
  phase: ObservationWindow["phase"];
  startedAt: string;
  endedAt: string;
}): ObservationWindow {
  return {
    windowId: `${input.experiment.experimentId}:${input.phase}:${input.startedAt}`,
    experimentId: input.experiment.experimentId,
    phase: input.phase,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    tenantScope: input.experiment.tenantScope,
    targetKey: evolutionTargetKey(input.experiment.target),
    modelRevision: input.experiment.frozen.modelRef,
    configRevision: input.experiment.frozen.configSnapshotRef,
    cohortRef: input.experiment.frozen.datasetOrCohortRef,
  };
}

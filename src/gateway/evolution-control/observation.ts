import path from "node:path";
import {
  buildObservationWindow,
  classifyBaselineCapture,
  type EvaluateExperimentInput,
  type EvolutionAdapter,
  type EvolutionApplication,
  type EvolutionExperiment,
  type EvolutionProposal,
  type MetricObservation,
  type ObservationWindow,
  type RollbackDrill,
} from "@openbot/evolution-core";
import { createDurableMap } from "./persistent-store.js";

export type ExperimentObservationRequest = {
  experiment: EvolutionExperiment;
  proposal: EvolutionProposal;
  application?: EvolutionApplication;
  rollbackDrill?: RollbackDrill;
};

export type ExperimentObservationProvider = {
  captureBaseline(input: ExperimentObservationRequest): Promise<ObservationBaseline | null>;
  collect(input: ExperimentObservationRequest): Promise<EvaluateExperimentInput>;
};

export type ObservationBaseline = {
  experimentId: string;
  samples: MetricObservation[];
  frozenAt: string;
  window: ObservationWindow;
};

function hasMeasuredSample(rows: readonly MetricObservation[], metricId: string): boolean {
  return rows.some((row) => row.metricId === metricId && row.sampleSize > 0);
}

function measuredValue(rows: readonly MetricObservation[], metricId: string): number | undefined {
  return rows.find((row) => row.metricId === metricId && row.sampleSize > 0)?.value;
}

function measuredSampleSize(rows: readonly MetricObservation[], metricId: string): number {
  return rows.find((row) => row.metricId === metricId && row.sampleSize > 0)?.sampleSize ?? 0;
}

function windowsOverlap(left: ObservationWindow, right: ObservationWindow): boolean {
  return left.startedAt < right.endedAt && right.startedAt < left.endedAt;
}

function treatmentPremature(
  application: EvolutionApplication | undefined,
  treatment: ObservationWindow,
): boolean {
  if (!application?.appliedAt) {
    return true;
  }
  return treatment.startedAt < application.appliedAt;
}

export function observationsToEvaluation(
  experiment: EvolutionExperiment,
  baseline: readonly MetricObservation[],
  current: readonly MetricObservation[],
  rollbackDrill: RollbackDrill,
  flags: {
    windowOverlap?: boolean;
    configDrift?: boolean;
    cohortContaminated?: boolean;
    treatmentPremature?: boolean;
    modelVersionChanged?: boolean;
  } = {},
): EvaluateExperimentInput {
  const primaryId = experiment.primaryMetric.metricId;
  const baselinePrimary = measuredValue(baseline, primaryId);
  const currentPrimary = measuredValue(current, primaryId);
  const sampleSize = Math.min(
    measuredSampleSize(baseline, primaryId),
    measuredSampleSize(current, primaryId),
  );
  const criticalMissing = experiment.guardrailMetrics
    .filter((row) => row.critical)
    .some(
      (row) =>
        !hasMeasuredSample(baseline, row.metricId) || !hasMeasuredSample(current, row.metricId),
    );
  const primaryMissing = baselinePrimary === undefined || currentPrimary === undefined;
  return {
    primary: {
      contract: experiment.primaryMetric,
      baseline: baselinePrimary ?? 0,
      treatment: currentPrimary ?? 0,
    },
    guardrails: experiment.guardrailMetrics.map((contract) => ({
      contract,
      baseline: measuredValue(baseline, contract.metricId) ?? 0,
      treatment: measuredValue(current, contract.metricId) ?? 0,
    })),
    sampleSize,
    minimumSampleSize: experiment.minimumSampleSize,
    confidence: null,
    requiredConfidence: experiment.requiredConfidence,
    baselineContaminated: primaryMissing || criticalMissing,
    modelVersionChanged: Boolean(flags.modelVersionChanged),
    rollbackDrill,
    windowOverlap: Boolean(flags.windowOverlap),
    configDrift: Boolean(flags.configDrift),
    cohortContaminated: Boolean(flags.cohortContaminated),
    treatmentPremature: Boolean(flags.treatmentPremature),
  };
}

export function createFailClosedObservationProvider(): ExperimentObservationProvider {
  return {
    async captureBaseline() {
      return null;
    },
    async collect() {
      throw new Error("trusted observation provider required");
    },
  };
}

export function createAdapterObservationProvider(deps: {
  resolveAdapter: (surfaceId: string) => EvolutionAdapter;
  persistDir?: string;
}): ExperimentObservationProvider {
  const baselines = createDurableMap<ObservationBaseline>(
    deps.persistDir ? path.join(deps.persistDir, "observation-baselines.json") : undefined,
  );
  const snapshotTarget = async (
    input: ExperimentObservationRequest,
    window: ObservationWindow,
  ): Promise<MetricObservation[]> => {
    const adapter = deps.resolveAdapter(input.proposal.surfaceId);
    if (adapter.observeTarget) {
      return adapter.observeTarget(input.proposal.target, window.windowId, window);
    }
    return [];
  };
  const snapshotTreatment = async (
    input: ExperimentObservationRequest,
    window: ObservationWindow,
  ): Promise<MetricObservation[]> => {
    if (input.application) {
      const adapter = deps.resolveAdapter(input.proposal.surfaceId);
      return adapter.observe({
        application: input.application,
        windowRef: window.windowId,
        window,
      });
    }
    return [];
  };
  const captureBaseline = async (
    input: ExperimentObservationRequest,
  ): Promise<ObservationBaseline | null> => {
    const existing = baselines.get(input.experiment.experimentId);
    if (existing) {
      return existing;
    }
    const endedAt = input.experiment.startedAt ?? new Date().toISOString();
    const endMs = Date.parse(endedAt);
    const startedAt = Number.isFinite(endMs)
      ? new Date(endMs - 90 * 24 * 60 * 60 * 1000).toISOString()
      : endedAt;
    const window = buildObservationWindow({
      experiment: input.experiment,
      phase: "baseline",
      startedAt,
      endedAt,
    });
    const samples = await snapshotTarget(input, window);
    const classified = classifyBaselineCapture({
      experiment: input.experiment,
      samples,
      window,
    });
    if (classified.status === "missing") {
      return null;
    }
    const captured: ObservationBaseline = {
      experimentId: input.experiment.experimentId,
      samples,
      frozenAt: endedAt,
      window,
    };
    baselines.set(input.experiment.experimentId, captured);
    return captured;
  };
  return {
    captureBaseline,
    async collect(input) {
      let baseline = baselines.get(input.experiment.experimentId);
      if (!baseline) {
        baseline = (await captureBaseline(input)) ?? undefined;
      }
      const endedAt = new Date().toISOString();
      const startedAt = input.application?.appliedAt ?? endedAt;
      const treatmentWindow = buildObservationWindow({
        experiment: input.experiment,
        phase: "treatment",
        startedAt,
        endedAt,
      });
      const current = input.application ? await snapshotTreatment(input, treatmentWindow) : [];
      const baselineWindow = baseline?.window;
      return observationsToEvaluation(
        input.experiment,
        baseline?.samples ?? [],
        current,
        input.rollbackDrill ?? "not_run",
        {
          windowOverlap: Boolean(baselineWindow && windowsOverlap(baselineWindow, treatmentWindow)),
          configDrift: Boolean(
            baselineWindow && baselineWindow.configRevision !== treatmentWindow.configRevision,
          ),
          cohortContaminated: Boolean(
            baselineWindow && baselineWindow.cohortRef !== treatmentWindow.cohortRef,
          ),
          treatmentPremature: treatmentPremature(input.application, treatmentWindow),
          modelVersionChanged: Boolean(
            baselineWindow && baselineWindow.modelRevision !== treatmentWindow.modelRevision,
          ),
        },
      );
    },
  };
}

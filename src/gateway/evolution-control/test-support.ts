import {
  buildObservationWindow,
  type EvaluateExperimentInput,
  type EvolutionExperiment,
  type MetricObservation,
} from "@openbot/evolution-core";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import { createCompositionRootVerifierHandle } from "./external-effect-registry.js";
import type { ExperimentObservationProvider, ObservationBaseline } from "./observation.js";
import { installCatalogBuiltins } from "./verifiers/catalog.js";

export const TEST_ALLOWED_ACTIONS = [
  "suggest",
  "experiment",
  "apply",
  "verify",
  "promote",
  "rollback",
  "hold",
  "reject",
] as const;

export const RUNTIME_PLATFORM_ALLOWED_ACTIONS = [...TEST_ALLOWED_ACTIONS, "platform"] as const;

export function bootstrapWorkingDnaVerifierRegistry(persistPath?: string) {
  const handle = createCompositionRootVerifierHandle(persistPath);
  installCatalogBuiltins(handle);
  return handle.registry;
}

export function withWorkingDnaExternal(cfg: import("../../config/config.js").OpenBotConfig) {
  return {
    styleConfig: cfg,
    verifierRegistry: bootstrapWorkingDnaVerifierRegistry(),
  };
}

export function testInspector(
  tenantScope: string,
  over: Partial<{
    status: string;
    tenantScope: string | null;
    expired?: boolean;
    revoked?: boolean;
    allowedActions?: readonly string[];
    confidentialityCeiling?: "personal" | "enterprise" | "platform";
  }> = {},
): EvolutionAuthorizationInspector {
  return {
    inspect: () => ({
      grantId: "grant-1",
      status: over.status ?? "APPROVED",
      tenantScope: over.tenantScope ?? tenantScope,
      allowedEvidence: ["ev-a"],
      allowedActions: [...(over.allowedActions ?? TEST_ALLOWED_ACTIONS)],
      confidentialityCeiling: over.confidentialityCeiling ?? "enterprise",
      ...(over.expired ? { expired: true } : {}),
      ...(over.revoked ? { revoked: true } : {}),
    }),
  };
}

export function runtimePlatformInspector(tenantScope: string) {
  return testInspector(tenantScope, {
    allowedActions: RUNTIME_PLATFORM_ALLOWED_ACTIONS,
    confidentialityCeiling: "platform",
  });
}

function fixtureSamples(experiment: EvolutionExperiment, windowRef: string): MetricObservation[] {
  return [
    {
      metricId: experiment.primaryMetric.metricId,
      value: experiment.primaryMetric.improveWhen === "increase" ? 0.7 : 0.3,
      sampleSize: Math.max(experiment.minimumSampleSize, 40),
      windowRef,
    },
    ...experiment.guardrailMetrics.map((row) => ({
      metricId: row.metricId,
      value: 0,
      sampleSize: Math.max(experiment.minimumSampleSize, 40),
      windowRef,
    })),
  ];
}

function fixtureTreatment(experiment: EvolutionExperiment, windowRef: string): MetricObservation[] {
  return [
    {
      metricId: experiment.primaryMetric.metricId,
      value: experiment.primaryMetric.improveWhen === "increase" ? 0.78 : 0.2,
      sampleSize: Math.max(experiment.minimumSampleSize, 40),
      windowRef,
    },
    ...experiment.guardrailMetrics.map((row) => ({
      metricId: row.metricId,
      value: 0,
      sampleSize: Math.max(experiment.minimumSampleSize, 40),
      windowRef,
    })),
  ];
}

/**
 * Offline deterministic contract for tests only. Production modules must not
 * import or re-export this provider.
 */
export function createPassingObservationProvider(): ExperimentObservationProvider {
  const baselines = new Map<string, ObservationBaseline>();
  return {
    async captureBaseline({ experiment }) {
      const existing = baselines.get(experiment.experimentId);
      if (existing) {
        return existing;
      }
      const endedAt = experiment.startedAt ?? "2026-09-06T11:00:00.000Z";
      const window = buildObservationWindow({
        experiment,
        phase: "baseline",
        startedAt: endedAt,
        endedAt,
      });
      const captured: ObservationBaseline = {
        experimentId: experiment.experimentId,
        samples: fixtureSamples(experiment, window.windowId),
        frozenAt: endedAt,
        window,
      };
      baselines.set(experiment.experimentId, captured);
      return captured;
    },
    async collect(input) {
      const { experiment, application } = input;
      const baseline =
        baselines.get(experiment.experimentId) ?? (await this.captureBaseline(input));
      if (!baseline) {
        throw new Error("deterministic fixture failed to freeze a baseline");
      }
      const startedAt = application?.appliedAt ?? "2026-09-06T11:05:00.000Z";
      const treatmentWindow = buildObservationWindow({
        experiment,
        phase: "treatment",
        startedAt,
        endedAt: "2026-09-06T11:10:00.000Z",
      });
      const evaluation: EvaluateExperimentInput = {
        primary: {
          contract: experiment.primaryMetric,
          baseline: fixtureSamples(experiment, baseline.window.windowId)[0].value,
          treatment: fixtureTreatment(experiment, treatmentWindow.windowId)[0].value,
        },
        guardrails: experiment.guardrailMetrics.map((contract) => ({
          contract,
          baseline: 0,
          treatment: 0,
        })),
        sampleSize: Math.max(experiment.minimumSampleSize, 40),
        minimumSampleSize: experiment.minimumSampleSize,
        confidence: null,
        requiredConfidence: experiment.requiredConfidence,
        baselineContaminated: false,
        modelVersionChanged: false,
        rollbackDrill: "passed",
        assessmentMode: "deterministic-fixture",
        treatmentPremature: false,
      };
      return evaluation;
    },
  };
}

export function testObservation() {
  return createPassingObservationProvider();
}

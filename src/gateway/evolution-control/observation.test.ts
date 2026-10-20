import { evaluateExperiment, workingDnaMetricSet } from "@openbot/evolution-core";
import type {
  EvolutionAdapter,
  EvolutionExperiment,
  EvolutionProposal,
  MetricObservation,
} from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import { createAdapterObservationProvider, observationsToEvaluation } from "./observation.js";

const metrics = workingDnaMetricSet();

function experiment(): EvolutionExperiment {
  return {
    schemaVersion: 1,
    experimentId: "exp-obs",
    proposalId: "evo:obs",
    surfaceId: "agent.working-dna",
    target: { domain: "agent", agentId: "dna-bot" },
    tenantScope: "tenant-a",
    baselineRef: "style-seed",
    candidateRef: "cand:obs",
    configRef: "cfg",
    assignment: { strategy: "ab", treatmentRefs: ["t1"], controlRefs: ["c1"] },
    primaryMetric: metrics.primary,
    guardrailMetrics: metrics.guardrails,
    minimumSampleSize: 20,
    requiredConfidence: 0.9,
    expiresAt: "2026-09-07T00:00:00.000Z",
    result: "pending",
    frozen: {
      baselineVersion: "style-seed",
      candidateVersion: "cand:obs",
      codeSha: "sha",
      modelRef: "model",
      providerVersion: "p",
      configSnapshotRef: "cfg",
      datasetOrCohortRef: "cohort",
      tenantScope: "tenant-a",
      confidentialityScope: "enterprise",
      expiresAt: "2026-09-07T00:00:00.000Z",
      maxResourceBudget: 1,
    },
  };
}

function proposal(): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:obs",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "case",
    target: { domain: "agent", agentId: "dna-bot" },
    candidateRef: "cand:obs",
    surfaceId: "agent.working-dna",
    expectedEffects: [metrics.primary],
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    tenantScope: "tenant-a",
    grantId: "grant-1",
    status: "EXPERIMENTING",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-06T12:00:00.000Z",
  };
}

function sample(metricId: string, value: number, sampleSize = 40): MetricObservation {
  return { metricId, value, sampleSize, windowRef: "exp-obs" };
}

function withGuardrails(primary: number): MetricObservation[] {
  return [
    sample("task_success_rate", primary),
    sample("security_violations", 0),
    sample("cross_tenant_contamination", 0),
    sample("human_takeover_rate", 0.01),
    sample("error_retry_rate", 0.01),
    sample("p95_latency", 100),
    sample("token_cost", 0.1),
    sample("delivery_failure_rate", 0),
  ];
}

function mockAdapter(rows: MetricObservation[]): EvolutionAdapter {
  return {
    adapterId: "working-dna",
    domain: "agent",
    async inspect() {
      throw new Error("unused");
    },
    async validate() {
      return { ok: true };
    },
    async apply() {
      throw new Error("unused");
    },
    async observe() {
      return rows;
    },
    async observeTarget() {
      return rows;
    },
    async rollback() {
      throw new Error("unused");
    },
  };
}

describe("adapter observation provider", () => {
  it("does not invent an improved result when domain samples are missing", async () => {
    const provider = createAdapterObservationProvider({
      resolveAdapter: () => mockAdapter([]),
    });
    const input = await provider.collect({ experiment: experiment(), proposal: proposal() });
    expect(input.baselineContaminated).toBe(true);
    expect(input.confidence).toBeNull();
    expect(input.rollbackDrill).toBe("not_run");
    expect(evaluateExperiment(input).result).toBe("inconclusive");
  });

  it("compares frozen domain samples and stays inconclusive without critical sensors", () => {
    const decision = evaluateExperiment(
      observationsToEvaluation(
        experiment(),
        [sample("task_success_rate", 0.7)],
        [sample("task_success_rate", 0.8)],
        "passed",
      ),
    );
    expect(decision.result).toBe("inconclusive");
    expect(decision.reasons).toContain("baseline_contaminated");
  });

  it("can mark improved only from measured primary and critical guardrails", async () => {
    let rows = withGuardrails(0.7);
    const provider = createAdapterObservationProvider({
      resolveAdapter: () => mockAdapter(rows),
    });
    const first = await provider.collect({
      experiment: experiment(),
      proposal: proposal(),
      rollbackDrill: "not_run",
    });
    expect(first.baselineContaminated).toBe(true);
    expect(first.confidence).toBeNull();
    expect(evaluateExperiment(first).result).toBe("inconclusive");
    rows = withGuardrails(0.8);
    const second = await provider.collect({
      experiment: experiment(),
      proposal: proposal(),
      rollbackDrill: "passed",
    });
    expect(second.primary.baseline).toBeCloseTo(0.7);
    expect(second.treatmentPremature).toBe(true);
    expect(second.confidence).toBeNull();
    expect(evaluateExperiment(second).result).toBe("inconclusive");
    expect(evaluateExperiment(second).reasons).toContain("treatment_premature");
  });

  it("uses application observe as treatment after a frozen baseline", async () => {
    const baselineRows = withGuardrails(0.7);
    const treatmentRows = withGuardrails(0.8);
    const provider = createAdapterObservationProvider({
      resolveAdapter: () => ({
        ...mockAdapter(baselineRows),
        async observe() {
          return treatmentRows;
        },
        async observeTarget() {
          return baselineRows;
        },
      }),
    });
    const captured = await provider.captureBaseline({
      experiment: experiment(),
      proposal: proposal(),
    });
    expect(captured?.samples[0]?.value).toBeCloseTo(0.7);
    const evaluated = await provider.collect({
      experiment: experiment(),
      proposal: proposal(),
      application: {
        schemaVersion: 1,
        applicationId: "app:1",
        proposalId: "evo:obs",
        experimentId: "exp-obs",
        adapterId: "working-dna",
        idempotencyKey: "cmd",
        targetVersionBefore: "a",
        targetVersionAfter: "b",
        rollbackRef: "rb",
        scope: "canary",
        status: "applied",
        appliedToRuntime: true,
        appliedAt: "2026-09-06T11:05:00.000Z",
      },
      rollbackDrill: "passed",
    });
    expect(evaluated.primary.baseline).toBeCloseTo(0.7);
    expect(evaluated.primary.treatment).toBeCloseTo(0.8);
    expect(evaluated.confidence).toBeNull();
  });
});

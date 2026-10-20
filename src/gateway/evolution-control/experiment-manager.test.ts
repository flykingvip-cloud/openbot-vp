import { workingDnaMetricSet, type EvolutionProposal } from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import {
  assignmentOverlaps,
  createExperiment,
  createMemoryExperimentStore,
} from "./experiment-manager.js";

const metrics = workingDnaMetricSet();

function proposal(id: string, agentId: string): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: id,
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "case-a",
    target: { domain: "agent", agentId },
    candidateRef: `cand:${id}`,
    surfaceId: "agent.working-dna",
    expectedEffects: [],
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    tenantScope: "tenant-a",
    grantId: "grant-1",
    status: "APPROVED_FOR_EXPERIMENT",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-06T12:00:00.000Z",
  };
}

function freezeFor(proposalId: string) {
  return {
    baselineVersion: "v0",
    candidateVersion: `cand:${proposalId}`,
    codeSha: "sha",
    modelRef: "model",
    providerVersion: "p1",
    configSnapshotRef: "cfg",
    datasetOrCohortRef: "cohort",
    tenantScope: "tenant-a" as const,
    confidentialityScope: "enterprise" as const,
    expiresAt: "2026-09-07T00:00:00.000Z",
    maxResourceBudget: 1,
  };
}

describe("experiment concurrency", () => {
  it("allows only one pending experiment per target", () => {
    const store = createMemoryExperimentStore();
    const index = new Map<string, string>();
    createExperiment(
      store,
      {
        experimentId: "exp-1",
        proposal: proposal("p1", "dna-bot"),
        freeze: freezeFor("p1"),
        assignment: { strategy: "ab", treatmentRefs: ["t1"], controlRefs: ["c1"] },
        primaryMetric: metrics.primary,
        guardrailMetrics: metrics.guardrails,
        minimumSampleSize: 20,
        requiredConfidence: 0.9,
      },
      index,
    );
    expect(() =>
      createExperiment(
        store,
        {
          experimentId: "exp-2",
          proposal: proposal("p2", "dna-bot"),
          freeze: freezeFor("p2"),
          assignment: { strategy: "ab", treatmentRefs: ["t2"], controlRefs: ["c2"] },
          primaryMetric: metrics.primary,
          guardrailMetrics: metrics.guardrails,
          minimumSampleSize: 20,
          requiredConfidence: 0.9,
        },
        index,
      ),
    ).toThrow(/active experiment already exists/);
  });

  it("detects overlapping control and treatment assignment", () => {
    expect(
      assignmentOverlaps(
        { strategy: "ab", treatmentRefs: ["u1"], controlRefs: ["u2"] },
        { strategy: "ab", treatmentRefs: ["u2"], controlRefs: ["u3"] },
      ),
    ).toBe(true);
    expect(
      assignmentOverlaps(
        { strategy: "ab", treatmentRefs: ["u1"], controlRefs: ["u2"] },
        { strategy: "ab", treatmentRefs: ["u3"], controlRefs: ["u4"] },
      ),
    ).toBe(false);
  });
});

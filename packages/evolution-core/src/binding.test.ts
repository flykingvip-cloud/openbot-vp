import { describe, expect, it } from "vitest";
import { assertCandidateMatchesExperiment, assertExperimentBoundToProposal } from "./binding.js";
import { workingDnaMetricSet } from "./metrics.js";
import type { EvolutionExperiment, EvolutionProposal } from "./types.js";

const metrics = workingDnaMetricSet();

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:a",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "case-a",
    target: { domain: "agent", agentId: "bot-a" },
    candidateRef: "cand:a",
    surfaceId: "agent.working-dna",
    expectedEffects: [metrics.primary],
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    tenantScope: "tenant-a",
    grantId: "grant-1",
    status: "EXPERIMENTING",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-06T12:00:00.000Z",
    experimentId: "exp:a",
    ...over,
  };
}

function experiment(over: Partial<EvolutionExperiment> = {}): EvolutionExperiment {
  return {
    schemaVersion: 1,
    experimentId: "exp:a",
    proposalId: "evo:a",
    baselineRef: "base-a",
    candidateRef: "cand:a",
    configRef: "cfg-a",
    assignment: { strategy: "ab", treatmentRefs: ["t1"], controlRefs: ["c1"] },
    primaryMetric: metrics.primary,
    guardrailMetrics: metrics.guardrails,
    minimumSampleSize: 20,
    requiredConfidence: 0.9,
    expiresAt: "2026-09-07T00:00:00.000Z",
    result: "improved",
    surfaceId: "agent.working-dna",
    target: { domain: "agent", agentId: "bot-a" },
    tenantScope: "tenant-a",
    frozen: {
      baselineVersion: "base-a",
      candidateVersion: "cand:a",
      codeSha: "sha",
      modelRef: "model",
      providerVersion: "p1",
      configSnapshotRef: "cfg-a",
      datasetOrCohortRef: "cohort",
      tenantScope: "tenant-a",
      confidentialityScope: "enterprise",
      expiresAt: "2026-09-07T00:00:00.000Z",
      maxResourceBudget: 1,
    },
    ...over,
  };
}

describe("evolution binding", () => {
  it("accepts a fully bound experiment and candidate", () => {
    expect(() => assertExperimentBoundToProposal(experiment(), proposal())).not.toThrow();
    expect(() =>
      assertCandidateMatchesExperiment({
        proposal: proposal(),
        experiment: experiment(),
        candidateRef: "cand:a",
        version: "cand:a",
        payloadHash: "abc",
        expectedHash: "abc",
      }),
    ).not.toThrow();
  });

  it("refuses a passed experiment from another proposal or target", () => {
    expect(() =>
      assertExperimentBoundToProposal(experiment({ proposalId: "evo:other" }), proposal()),
    ).toThrow(/not bound to this proposal/);
    expect(() =>
      assertExperimentBoundToProposal(experiment({ candidateRef: "cand:other" }), proposal()),
    ).toThrow(/candidate does not match/);
    expect(() =>
      assertExperimentBoundToProposal(experiment({ tenantScope: "tenant-b" }), proposal()),
    ).toThrow(/tenant does not match/);
    expect(() =>
      assertExperimentBoundToProposal(
        experiment({ surfaceId: "knowledge.experience-capsule" }),
        proposal(),
      ),
    ).toThrow(/surface does not match/);
    expect(() =>
      assertExperimentBoundToProposal(
        experiment({ target: { domain: "agent", agentId: "bot-other" } }),
        proposal(),
      ),
    ).toThrow(/target does not match/);
  });

  it("refuses a candidate whose hash or version drifted from the experiment", () => {
    expect(() =>
      assertCandidateMatchesExperiment({
        proposal: proposal(),
        experiment: experiment(),
        candidateRef: "cand:other",
        version: "cand:a",
        payloadHash: "abc",
        expectedHash: "abc",
      }),
    ).toThrow(/not the proposal candidate/);
    expect(() =>
      assertCandidateMatchesExperiment({
        proposal: proposal(),
        experiment: experiment(),
        candidateRef: "cand:a",
        version: "cand:forged",
        payloadHash: "abc",
        expectedHash: "abc",
      }),
    ).toThrow(/does not match the experimented candidate/);
    expect(() =>
      assertCandidateMatchesExperiment({
        proposal: proposal(),
        experiment: experiment(),
        candidateRef: "cand:a",
        version: "cand:a",
        payloadHash: "abc",
        expectedHash: "def",
      }),
    ).toThrow(/payload hash mismatch/);
  });
});

import { describe, expect, it } from "vitest";
import { produceDiagnoseEvolutionArtifacts } from "./diagnose-evolution-producer.js";
import { buildStructuralPreviewFact } from "./diagnose-structural-preview.js";
import type { StructuralPreviewTrustInput } from "./diagnose-structural-preview.js";

function trust(patch: Partial<StructuralPreviewTrustInput> = {}): StructuralPreviewTrustInput {
  return {
    observation: {
      kind: "task_result",
      observationRef: "obs:task-result:run-1",
      proposedChange: { field: "reportingCadence", value: "milestone" },
    },
    baseline: {
      baselineHash: "wdna-style-on_completion",
      reportingCadence: "on_completion",
    },
    reportRef: "cdr-persisted-1",
    findingRef: "finding-1",
    evidenceRefs: ["evidence:task-result-1"],
    snapshotRef: "a".repeat(64),
    targetHint: "bot-2",
    observedWindow: {
      startedAt: "2026-09-18T00:00:00.000Z",
      endedAt: "2026-09-19T00:00:00.000Z",
    },
    ...patch,
  };
}

describe("A1 structural preview construction", () => {
  it("builds a preview fact from trusted observation, baseline, and real report/finding/evidence", () => {
    const fact = buildStructuralPreviewFact(trust());
    expect(fact).not.toBeNull();
    expect(fact?.structuralIntent).toBe("adjust_reporting_cadence");
    expect(fact?.proposedChange).toEqual({ field: "reportingCadence", value: "milestone" });
    const producer = produceDiagnoseEvolutionArtifacts({
      professionalReportId: "pdr-display",
      subject: [{ displayName: "市场助手" }],
      runtimeAssessment: {
        completion: "INCONCLUSIVE",
        findingCount: 1,
        scanned: 1,
        skipped: 0,
      },
      growthAssessment: [],
      prescriptions: [],
      structuralFacts: fact ? [fact] : [],
    });
    expect(producer.structuralCandidates).toHaveLength(1);
    expect(producer.skillInstallationCandidates).toEqual([]);
    expect(JSON.stringify(producer.structuralCandidates[0])).not.toContain("proposalId");
    expect(JSON.stringify(producer.structuralCandidates[0])).not.toContain("tenantId");
  });

  it("stays empty without observation, baseline, or real report/finding/evidence", () => {
    expect(
      buildStructuralPreviewFact(
        trust({ observation: { ...trust().observation, observationRef: "" } }),
      ),
    ).toBeNull();
    expect(
      buildStructuralPreviewFact(
        trust({
          observation: { ...trust().observation, observationRef: "ev:diag:prose" },
        }),
      ),
    ).toBeNull();
    expect(
      buildStructuralPreviewFact(
        trust({ baseline: { baselineHash: "", reportingCadence: "on_completion" } }),
      ),
    ).toBeNull();
    expect(buildStructuralPreviewFact(trust({ reportRef: "pdr-display" }))).toBeNull();
    expect(buildStructuralPreviewFact(trust({ findingRef: "" }))).toBeNull();
    expect(buildStructuralPreviewFact(trust({ snapshotRef: "" }))).toBeNull();
    expect(buildStructuralPreviewFact(trust({ evidenceRefs: ["ev:diag:abc"] }))).toBeNull();
    expect(buildStructuralPreviewFact(trust({ targetHint: "not a hint!!" }))).toBeNull();
  });

  it("does not emit when proposedChange matches the current working-style baseline", () => {
    expect(
      buildStructuralPreviewFact(
        trust({
          observation: {
            kind: "task_result",
            observationRef: "obs:task-result:run-1",
            proposedChange: { field: "reportingCadence", value: "on_completion" },
          },
        }),
      ),
    ).toBeNull();
  });

  it("rejects identity/memory/unused-skill observation kinds", () => {
    expect(
      buildStructuralPreviewFact(
        trust({
          observation: {
            kind: "identity_gap" as StructuralPreviewTrustInput["observation"]["kind"],
            observationRef: "obs:identity:1",
            proposedChange: { field: "reportingCadence", value: "milestone" },
          },
        }),
      ),
    ).toBeNull();
  });

  it("rejects cron reportingCadence values", () => {
    expect(
      buildStructuralPreviewFact(
        trust({
          observation: {
            kind: "operational_metric",
            observationRef: "obs:metric:1",
            proposedChange: {
              field: "reportingCadence",
              value: "daily" as unknown as "milestone",
            },
          },
        }),
      ),
    ).toBeNull();
  });
});

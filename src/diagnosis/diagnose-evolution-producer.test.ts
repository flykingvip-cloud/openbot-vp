import { describe, expect, it } from "vitest";
import type { EvolutionPrescription } from "./diagnose-evolution-prescription.js";
import { produceDiagnoseEvolutionArtifacts } from "./diagnose-evolution-producer.js";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import type { StructuralPreviewFact } from "./structural-evolution-candidate.js";

function growth(patch: Partial<DiagnoseGrowthAssessment> = {}): DiagnoseGrowthAssessment {
  return {
    agentId: "bot-2",
    tenantId: "001",
    agentAssetId: "asset-1",
    targetOwnerId: "owner-1",
    groupId: null,
    objectLabel: "市场助手",
    displayName: "市场助手",
    identity: {
      readable: true,
      bootstrapPending: false,
      identityInitialized: false,
      userInitialized: false,
    },
    memory: { present: true, fresh: true },
    hadTaskActivity: true,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: [],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: ["name", "vibe"],
    userMissingFields: ["timezone"],
    installedSkillIds: [],
    memoryFileCount: 2,
    reportFileCount: 1,
    freshArtifactCount: 2,
    sessionRoster: { main: 1, cron: 4, other: 2, freshCron: 1, freshMain: 0 },
    activitySources: ["memory_file", "report_file", "cron_session"],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
    ...patch,
  };
}

function prescription(purpose: EvolutionPrescription["purpose"]): EvolutionPrescription {
  return {
    prescriptionId: `rx-${purpose}`,
    professionalReportId: "pdr-test",
    tenantId: "001",
    targetAgentAssetId: "asset-1",
    targetAgentId: "bot-2",
    targetOwnerId: "owner-1",
    purpose,
    purposeLabel: purpose,
    kind: "next_heartbeat_cron",
    normalizedSchedule: "0 8 * * *",
    scheduleExpr: "0 8 * * *",
    cadenceLabel: "每天 08:00，下次心跳触发",
    expectedEffect: "自我管理",
    wakeText: "向主人请求补充未确认字段。",
    payloadVersion: 1,
    schemaVersion: 1,
    state: "NOT_CONFIRMABLE",
    confirmable: false,
    authorizationRef: null,
    expiresAt: "2026-09-20T00:00:00.000Z",
    appliedJobId: null,
  };
}

const PREVIEW_FACT: StructuralPreviewFact = {
  structuralIntent: "adjust_reporting_cadence",
  proposedChange: { field: "reportingCadence", value: "on_completion" },
  surfaceId: "agent.working-dna",
  targetHint: "bot-2",
  baselineHash: "wdna-baseline-aaa",
  observationRef: "obs:pattern:reporting-cadence-1",
  evidenceRefs: ["evidence:task-result-1"],
  snapshotRef: "b".repeat(64),
  reportRef: "cdr-persisted-1",
  findingRef: "finding-1",
  observedWindow: {
    startedAt: "2026-09-18T00:00:00.000Z",
    endedAt: "2026-09-19T00:00:00.000Z",
  },
};

describe("diagnose evolution producer", () => {
  it("keeps four Path A purposes off structural, WDNA, and skill candidates", () => {
    const out = produceDiagnoseEvolutionArtifacts({
      professionalReportId: "pdr-test",
      subject: [{ displayName: "市场助手" }],
      runtimeAssessment: {
        completion: "INCONCLUSIVE",
        findingCount: 0,
        scanned: 1,
        skipped: 0,
      },
      growthAssessment: [growth()],
      prescriptions: [
        prescription("identity"),
        prescription("memory"),
        prescription("learn_capability"),
        prescription("review_tasks"),
      ],
    });
    expect(out.producer).toBe("diagnosis.evidence-candidate");
    expect(out.candidates).toEqual([]);
    expect(out.structuralCandidates).toEqual([]);
    expect(out.skillInstallationCandidates).toEqual([]);
    expect(out.evidence.some((row) => row.kind === "identity_gap")).toBe(true);
    expect(JSON.stringify(out)).not.toContain("WorkingDnaCandidate");
    expect(JSON.stringify(out)).not.toContain("EvolutionProposal");
  });

  it("does not derive WDNA or skill candidates from identity or unused-skill gaps", () => {
    const identityOnly = produceDiagnoseEvolutionArtifacts({
      professionalReportId: "pdr-id",
      subject: [{ displayName: "市场助手" }],
      runtimeAssessment: {
        completion: "INCONCLUSIVE",
        findingCount: 0,
        scanned: 1,
        skipped: 0,
      },
      growthAssessment: [growth({ unused: [], installedSkillIds: ["briefing"] })],
      prescriptions: [prescription("identity")],
    });
    expect(identityOnly.structuralCandidates).toEqual([]);
    expect(identityOnly.skillInstallationCandidates).toEqual([]);
    expect(identityOnly.candidates).toEqual([]);

    const unusedOnly = produceDiagnoseEvolutionArtifacts({
      professionalReportId: "pdr-skill",
      subject: [{ displayName: "市场助手" }],
      runtimeAssessment: {
        completion: "INCONCLUSIVE",
        findingCount: 0,
        scanned: 1,
        skipped: 0,
      },
      growthAssessment: [
        growth({
          identityMissingFields: [],
          userMissingFields: [],
          unused: ["briefing"],
          installedSkillIds: ["briefing"],
        }),
      ],
      prescriptions: [prescription("learn_capability")],
    });
    expect(unusedOnly.structuralCandidates).toEqual([]);
    expect(unusedOnly.skillInstallationCandidates).toEqual([]);
    expect(unusedOnly.candidates).toEqual([]);
  });

  it("emits a B preview only when observation, baseline, evidence, and target hint exist", () => {
    const missingObservation = produceDiagnoseEvolutionArtifacts({
      professionalReportId: "pdr-miss",
      subject: [{ displayName: "市场助手" }],
      runtimeAssessment: {
        completion: "INCONCLUSIVE",
        findingCount: 0,
        scanned: 1,
        skipped: 0,
      },
      growthAssessment: [growth()],
      prescriptions: [],
      structuralFacts: [{ ...PREVIEW_FACT, observationRef: "" }],
    });
    expect(missingObservation.structuralCandidates).toEqual([]);
    expect(missingObservation.skillInstallationCandidates).toEqual([]);

    const ready = produceDiagnoseEvolutionArtifacts({
      professionalReportId: "pdr-ready",
      subject: [{ displayName: "市场助手" }],
      runtimeAssessment: {
        completion: "INCONCLUSIVE",
        findingCount: 0,
        scanned: 1,
        skipped: 0,
      },
      growthAssessment: [growth()],
      prescriptions: [],
      structuralFacts: [PREVIEW_FACT],
    });
    expect(ready.structuralCandidates).toHaveLength(1);
    expect(ready.skillInstallationCandidates).toEqual([]);
    expect(ready.structuralCandidates[0]?.structuralIntent).toBe("adjust_reporting_cadence");
    expect(JSON.stringify(ready.structuralCandidates[0])).not.toContain("tenantId");
    expect(JSON.stringify(ready.structuralCandidates[0])).not.toContain("proposalId");
  });
});

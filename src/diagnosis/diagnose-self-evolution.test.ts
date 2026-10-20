import { describe, expect, it } from "vitest";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import {
  EVOLUTION_PRESCRIPTION_PAYLOAD_VERSION,
  EVOLUTION_PRESCRIPTION_SCHEMA_VERSION,
  evolutionPrescriptionId,
  normalizeEvolutionSchedule,
} from "./diagnose-professional-protocol.js";
import {
  buildDiagnoseEvolutionPrescriptions,
  diagnosisEvolutionJobName,
} from "./diagnose-self-evolution.js";

function gapAssessment(): DiagnoseGrowthAssessment {
  return {
    agentId: "bot-2",
    tenantId: "tenant-a",
    agentAssetId: "asset-bot-2",
    targetOwnerId: "employee-9",
    groupId: null,
    objectLabel: "bot-2",
    displayName: null,
    identity: {
      readable: true,
      bootstrapPending: true,
      identityInitialized: false,
      userInitialized: false,
    },
    memory: { present: false, fresh: false },
    hadTaskActivity: false,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: [],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: ["name"],
    userMissingFields: ["timezone"],
    installedSkillIds: [],
    memoryFileCount: 0,
    reportFileCount: 0,
    freshArtifactCount: 0,
    sessionRoster: { main: 0, cron: 0, other: 0, freshCron: 0, freshMain: 0 },
    activitySources: [],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
  };
}

describe("diagnose self-evolution dedup", () => {
  it("does not stack a second prescription when the cron name already exists", () => {
    const id = evolutionPrescriptionId({
      schemaVersion: EVOLUTION_PRESCRIPTION_SCHEMA_VERSION,
      tenantId: "tenant-a",
      agentAssetId: "asset-bot-2",
      purpose: "identity",
      normalizedSchedule: normalizeEvolutionSchedule("next_heartbeat_cron", "0 8 * * *"),
      payloadVersion: EVOLUTION_PRESCRIPTION_PAYLOAD_VERSION,
    });
    const rows = buildDiagnoseEvolutionPrescriptions({
      assessment: gapAssessment(),
      professionalReportId: "pdr-dedup",
      confirmable: true,
      authorizationRef: "grant-1",
      existingJobs: [{ id: "job-1", name: diagnosisEvolutionJobName(id), agentId: "bot-2" }],
    });
    const identity = rows.find((row) => row.purpose === "identity");
    expect(identity?.state).toBe("ALREADY_SCHEDULED");
    expect(identity?.confirmable).toBe(false);
    expect(rows.filter((row) => row.prescriptionId === id)).toHaveLength(1);
  });
});

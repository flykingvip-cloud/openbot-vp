import { describe, expect, it } from "vitest";
import { buildEvidenceSloArtifacts } from "./diagnose-evidence-slo.js";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";

function baseGrowth(over: Partial<DiagnoseGrowthAssessment> = {}): DiagnoseGrowthAssessment {
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
      bootstrapPending: false,
      identityInitialized: true,
      userInitialized: true,
    },
    memory: { present: true, fresh: true },
    hadTaskActivity: false,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: [],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: [],
    userMissingFields: [],
    installedSkillIds: [],
    memoryFileCount: 0,
    reportFileCount: 0,
    freshArtifactCount: 0,
    sessionRoster: { main: 1, cron: 0, other: 0, freshCron: 0, freshMain: 0 },
    activitySources: [],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
    ...over,
  };
}

describe("buildEvidenceSloArtifacts", () => {
  it("empty_sampling emits evidence_slo_sampling and unhealthy", () => {
    const result = buildEvidenceSloArtifacts({
      growths: [],
      scanned: 0,
      tenantId: "tenant-a",
    });
    expect(result.unhealthy).toBe(true);
    expect(result.findings.some((row) => row.code === "evidence_slo_sampling")).toBe(true);
    expect(
      result.cases.every((row) => row.caseKind === "evidence_gap" && row.status === "suggested"),
    ).toBe(true);
  });

  it("no_fresh_output emits evidence_slo_fresh_output", () => {
    const result = buildEvidenceSloArtifacts({
      growths: [
        baseGrowth({
          hadTaskActivity: true,
          freshArtifactCount: 0,
          activitySources: ["cron_session"],
        }),
      ],
      scanned: 1,
      tenantId: "tenant-a",
    });
    expect(result.findings.some((row) => row.code === "evidence_slo_fresh_output")).toBe(true);
    expect(result.unhealthy).toBe(true);
  });

  it("skill_events_gap emits evidence_slo_skill_events", () => {
    const result = buildEvidenceSloArtifacts({
      growths: [
        baseGrowth({
          installedSkillIds: ["briefing", "ops"],
          unused: ["briefing", "ops"],
          activitySources: [],
        }),
      ],
      scanned: 1,
      tenantId: "tenant-a",
    });
    expect(result.findings.some((row) => row.code === "evidence_slo_skill_events")).toBe(true);
    expect(result.cases[0]?.status).toBe("suggested");
  });
});

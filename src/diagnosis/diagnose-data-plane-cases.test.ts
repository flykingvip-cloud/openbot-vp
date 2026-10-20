import { describe, expect, it } from "vitest";
import {
  buildDataPlaneArtifactsFromGrowth,
  type GrowthReadLocatorView,
} from "./diagnose-data-plane-cases.js";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import { buildProfessionalDiagnosisReport } from "./diagnose-report-text.js";
import { buildDiagnoseEvolutionPrescriptions } from "./diagnose-self-evolution.js";

function growth(over: Partial<DiagnoseGrowthAssessment> = {}): DiagnoseGrowthAssessment {
  return {
    agentId: "main",
    tenantId: "tenant-a",
    agentAssetId: null,
    targetOwnerId: null,
    groupId: "grp-daniel-hhd-gmail-com-upbeyond",
    objectLabel: "协作小组 grp-daniel-hhd-gmail-com-upbeyond",
    displayName: "协作小组 grp-daniel-hhd-gmail-com-upbeyond",
    identity: {
      readable: false,
      bootstrapPending: false,
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
    identityMissingFields: [],
    userMissingFields: [],
    installedSkillIds: [],
    memoryFileCount: 0,
    reportFileCount: 0,
    freshArtifactCount: 0,
    sessionRoster: { main: 0, cron: 0, other: 0, freshCron: 0, freshMain: 0 },
    activitySources: [],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
    ...over,
  };
}

describe("data plane cases + report seal integration", () => {
  it("locator_failed_structured — findings + dataPlaneCases, not limitations alone", () => {
    const read: GrowthReadLocatorView = {
      agentId: "main",
      tenantId: "tenant-a",
      displayName: "协作小组 grp-daniel-hhd-gmail-com-upbeyond",
      locatorStatus: "locator_failed",
      locatorFailureCode: "catalog_miss",
    };
    const g = growth();
    const artifacts = buildDataPlaneArtifactsFromGrowth({
      growthReads: [read],
      growths: [g],
      tenantId: "tenant-a",
      reportRef: "cdr-sample",
      nowMs: Date.parse("2026-10-14T12:00:00.000Z"),
    });
    expect(artifacts.findings.some((row) => row.code === "locator_failed")).toBe(true);
    expect(artifacts.cases).toHaveLength(1);
    expect(artifacts.cases[0]).toMatchObject({
      caseKind: "locator_failed",
      status: "suggested",
      locatorFailureCode: "catalog_miss",
    });
    expect(artifacts.hasLocatorFailed).toBe(true);

    const report = buildProfessionalDiagnosisReport({
      completion: "BLOCKED",
      findingCount: artifacts.findings.length,
      findings: artifacts.findings,
      windowId: "24h",
      mode: "TARGETED",
      scope: "target",
      scanned: 1,
      skipped: 0,
      reportId: "cdr-sample",
      reportIds: ["cdr-sample"],
      tenantId: "tenant-a",
      growths: [g],
      prescriptions: [],
      dataPlaneCases: artifacts.cases,
      groupMemberExpand: [
        {
          groupId: "grp-daniel-hhd-gmail-com-upbeyond",
          members: [],
          emptyReason: "无成员绑定",
        },
      ],
    });
    expect(report.runtimeAssessment.findings.some((row) => row.code === "locator_failed")).toBe(
      true,
    );
    expect(report.dataPlaneCases?.[0]?.status).toBe("suggested");
    expect(report.dataPlaneCases?.[0]?.caseKind).toBe("locator_failed");
    // limitations may still exist but must not replace structured case
    expect((report.dataPlaneCases?.length ?? 0) >= 1).toBe(true);
  });

  it("group_readable_no_rx — located group with empty agentAssetId yields no A-class Rx", () => {
    const g = growth({
      agentAssetId: "",
      identity: {
        readable: true,
        bootstrapPending: true,
        identityInitialized: false,
        userInitialized: false,
      },
      identityMissingFields: ["name"],
    });
    const prescriptions = buildDiagnoseEvolutionPrescriptions({
      assessment: { ...g, agentAssetId: "" },
      professionalReportId: "pdr-group",
      confirmable: true,
    });
    expect(prescriptions).toEqual([]);
  });

  it("growth_gaps_as_findings — identity/user/memory become findings + cases", () => {
    const g = growth({
      groupId: null,
      agentId: "bot-2",
      agentAssetId: "asset-bot-2",
      targetOwnerId: "employee-9",
      identity: {
        readable: true,
        bootstrapPending: true,
        identityInitialized: false,
        userInitialized: false,
      },
      identityMissingFields: ["name"],
      userMissingFields: ["timezone"],
      memoryJudgedMissing: true,
      hadTaskActivity: true,
    });
    const artifacts = buildDataPlaneArtifactsFromGrowth({
      growthReads: [
        {
          agentId: "bot-2",
          tenantId: "tenant-a",
          locatorStatus: "located",
        },
      ],
      growths: [g],
      tenantId: "tenant-a",
    });
    const codes = artifacts.findings.map((row) => row.code).toSorted();
    expect(codes).toContain("growth_identity_gap");
    expect(codes).toContain("growth_user_gap");
    expect(codes).toContain("growth_memory_gap");
    expect(artifacts.cases.every((row) => row.status === "suggested")).toBe(true);
  });
});

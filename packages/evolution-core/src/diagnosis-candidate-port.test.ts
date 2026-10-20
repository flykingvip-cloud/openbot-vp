import { describe, expect, it } from "vitest";
import {
  REJECTED_STRUCTURAL_CANDIDATE_PREVIEW_SHAS,
  SKILL_INSTALLATION_CANDIDATE_A1_COMMIT_SHA,
  SKILL_INSTALLATION_CANDIDATE_CONSUMED_FROM_PR,
  SKILL_INSTALLATION_CANDIDATE_OWNERSHIP,
  STRUCTURAL_CANDIDATE_A0_COMMIT_SHA,
  STRUCTURAL_CANDIDATE_CONSUMED_FROM_ORIGIN_MAIN,
  STRUCTURAL_CANDIDATE_OWNERSHIP,
  skillInstallationCandidateDtoReady,
  structuralCandidateDtoReady,
} from "./diagnosis-candidate-port.js";

describe("diagnosis candidate port", () => {
  it("records the Track A ownership from origin/main instead of copying the DTO", () => {
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.track).toBe("A");
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.module).toBe(
      "src/diagnosis/structural-evolution-candidate.ts",
    );
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.a0CommitSha).toBe(STRUCTURAL_CANDIDATE_A0_COMMIT_SHA);
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.consumedFromOriginMain).toBe(
      STRUCTURAL_CANDIDATE_CONSUMED_FROM_ORIGIN_MAIN,
    );
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.waitingFor).toBeNull();
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.rejectedPreviewShas).toEqual(
      REJECTED_STRUCTURAL_CANDIDATE_PREVIEW_SHAS,
    );
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.rejectedPreviewShas).toContain("c7d7aa54f2");
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.rejectedPreviewShas).toContain("bb97b44ce6");
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.schemaVersion).toBe(1);
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.dtoExportPath).toBe(
      "src/diagnosis/structural-evolution-candidate.ts",
    );
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.growthAssessmentSnapshot.reader).toBe(
      "src/diagnosis/diagnose-growth-snapshot.ts#readGrowthAssessmentSnapshot",
    );
    expect(STRUCTURAL_CANDIDATE_OWNERSHIP.growthAssessmentSnapshot.validator).toBe(
      "src/diagnosis/diagnose-growth-snapshot.ts#validateGrowthAssessmentSnapshot",
    );
    expect(structuralCandidateDtoReady()).toBe(true);
  });

  it("records the Track A skill-installation DTO from PR 1204 instead of copying it", () => {
    expect(SKILL_INSTALLATION_CANDIDATE_OWNERSHIP.track).toBe("A");
    expect(SKILL_INSTALLATION_CANDIDATE_OWNERSHIP.module).toBe(
      "src/diagnosis/skill-installation-candidate.ts",
    );
    expect(SKILL_INSTALLATION_CANDIDATE_OWNERSHIP.a1CommitSha).toBe(
      SKILL_INSTALLATION_CANDIDATE_A1_COMMIT_SHA,
    );
    expect(SKILL_INSTALLATION_CANDIDATE_OWNERSHIP.consumedFromPr).toBe(
      SKILL_INSTALLATION_CANDIDATE_CONSUMED_FROM_PR,
    );
    expect(SKILL_INSTALLATION_CANDIDATE_OWNERSHIP.consumedFromOriginMain).toBeNull();
    expect(SKILL_INSTALLATION_CANDIDATE_OWNERSHIP.rejectedPreviewShas).toContain("c7d7aa54f2");
    expect(SKILL_INSTALLATION_CANDIDATE_OWNERSHIP.rejectedPreviewShas).toContain("bb97b44ce6");
    expect(SKILL_INSTALLATION_CANDIDATE_OWNERSHIP.schemaVersion).toBe(1);
    expect(skillInstallationCandidateDtoReady()).toBe(true);
  });
});

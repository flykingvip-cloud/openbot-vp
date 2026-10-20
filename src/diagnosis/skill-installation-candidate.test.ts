import { describe, expect, it } from "vitest";
import { produceDiagnoseEvolutionArtifacts } from "./diagnose-evolution-producer.js";
import { buildSkillInstallationPreviewFact } from "./diagnose-structural-preview.js";
import {
  buildSkillInstallationCandidate,
  skillInstallDeltaFromProposedChange,
  skillInstallationBaselineHash,
  SKILL_INSTALLATION_SURFACE_ID,
  type SkillInstallationPreviewFact,
} from "./skill-installation-candidate.js";

function fact(patch: Partial<SkillInstallationPreviewFact> = {}): SkillInstallationPreviewFact {
  return {
    structuralIntent: "install_existing_skill",
    proposedChange: { field: "skillId", operation: "install", skillId: "briefing" },
    surfaceId: SKILL_INSTALLATION_SURFACE_ID,
    targetHint: "bot-2",
    baselineHash: "skill-install-baseline-aaa",
    observationRef: "obs:explicit-install:briefing",
    evidenceRefs: ["evidence:task-result-1"],
    snapshotRef: "b".repeat(64),
    reportRef: "cdr-persisted-1",
    findingRef: "finding-1",
    observedWindow: {
      startedAt: "2026-09-18T00:00:00.000Z",
      endedAt: "2026-09-19T00:00:00.000Z",
    },
    installed: false,
    ...patch,
  };
}

describe("skill installation candidate DTO", () => {
  it("hashes installed versus missing as distinct live baselines", () => {
    const missing = skillInstallationBaselineHash("briefing", false);
    const installed = skillInstallationBaselineHash("briefing", true);
    expect(missing).toMatch(/^[a-f0-9]{64}$/);
    expect(installed).not.toBe(missing);
    expect(skillInstallationBaselineHash(" briefing ", false)).toBe(missing);
  });

  it("emits a preview without authority fields and maps to B install delta", () => {
    const built = buildSkillInstallationCandidate(fact());
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.candidate.surfaceId).toBe("capability.skill-installation");
    expect(built.candidate.structuralIntent).toBe("install_existing_skill");
    expect(JSON.stringify(built.candidate)).not.toContain("tenantId");
    expect(JSON.stringify(built.candidate)).not.toContain("proposalId");
    expect(skillInstallDeltaFromProposedChange(built.candidate.proposedChange)).toEqual({
      skillId: "briefing",
      operation: "install",
    });
  });

  it("rejects missing skillId, unused-skill-only, already installed, and skill-spec", () => {
    expect(
      buildSkillInstallationCandidate(
        fact({ proposedChange: { field: "skillId", operation: "install", skillId: "" } }),
      ).ok,
    ).toBe(false);
    expect(
      buildSkillInstallationCandidate(
        fact({
          structuralIntent: "learn_capability" as SkillInstallationPreviewFact["structuralIntent"],
        }),
      ).ok,
    ).toBe(false);
    expect(buildSkillInstallationCandidate(fact({ installed: true })).ok).toBe(false);
    expect(buildSkillInstallationCandidate(fact({ surfaceId: "capability.skill-spec" })).ok).toBe(
      false,
    );
    expect(buildSkillInstallationCandidate(fact({ reportRef: "pdr-display" })).ok).toBe(false);
  });

  it("keeps candidateVersion stable across provenance/window", () => {
    const first = buildSkillInstallationCandidate(fact());
    const shifted = buildSkillInstallationCandidate(
      fact({
        evidenceRefs: ["evidence:other"],
        observedWindow: {
          startedAt: "2026-09-17T00:00:00.000Z",
          endedAt: "2026-09-19T00:00:00.000Z",
        },
      }),
    );
    expect(first.ok && shifted.ok).toBe(true);
    if (first.ok && shifted.ok) {
      expect(shifted.candidate.candidateVersion).toBe(first.candidate.candidateVersion);
      expect(shifted.candidate.cooldownKey).toBe(first.candidate.cooldownKey);
    }
  });
});

describe("A1 skill installation preview construction", () => {
  it("builds a fact only from explicit install intent plus real report/finding/evidence", () => {
    const preview = buildSkillInstallationPreviewFact({
      observation: {
        kind: "explicit_install_intent",
        observationRef: "obs:explicit-install:briefing",
        proposedChange: { field: "skillId", operation: "install", skillId: "briefing" },
      },
      baseline: {
        baselineHash: "skill-install-baseline-aaa",
        skillId: "briefing",
        installed: false,
      },
      reportRef: "cdr-persisted-1",
      findingRef: "finding-1",
      evidenceRefs: ["evidence:task-result-1"],
      snapshotRef: "b".repeat(64),
      targetHint: "bot-2",
      observedWindow: {
        startedAt: "2026-09-18T00:00:00.000Z",
        endedAt: "2026-09-19T00:00:00.000Z",
      },
    });
    expect(preview).not.toBeNull();
    const producer = produceDiagnoseEvolutionArtifacts({
      professionalReportId: "pdr-display",
      subject: [{ displayName: "市场助手" }],
      runtimeAssessment: { completion: "INCONCLUSIVE", findingCount: 1, scanned: 1, skipped: 0 },
      growthAssessment: [],
      prescriptions: [],
      skillInstallationFacts: preview ? [preview] : [],
    });
    expect(producer.skillInstallationCandidates).toHaveLength(1);
    expect(producer.structuralCandidates).toEqual([]);
    expect(producer.candidates).toEqual([]);
  });

  it("does not emit from unused-skill observations or already-installed baseline", () => {
    expect(
      buildSkillInstallationPreviewFact({
        observation: {
          kind: "unused_skill" as "explicit_install_intent",
          observationRef: "obs:unused:briefing",
          proposedChange: { field: "skillId", operation: "install", skillId: "briefing" },
        },
        baseline: { baselineHash: "h", skillId: "briefing", installed: false },
        reportRef: "cdr-1",
        findingRef: "finding-1",
        evidenceRefs: ["evidence:1"],
        snapshotRef: "c".repeat(64),
        targetHint: "bot-2",
        observedWindow: {
          startedAt: "2026-09-18T00:00:00.000Z",
          endedAt: "2026-09-19T00:00:00.000Z",
        },
      }),
    ).toBeNull();
    expect(
      buildSkillInstallationPreviewFact({
        observation: {
          kind: "explicit_install_intent",
          observationRef: "obs:explicit-install:briefing",
          proposedChange: { field: "skillId", operation: "install", skillId: "briefing" },
        },
        baseline: { baselineHash: "h", skillId: "briefing", installed: true },
        reportRef: "cdr-1",
        findingRef: "finding-1",
        evidenceRefs: ["evidence:1"],
        snapshotRef: "c".repeat(64),
        targetHint: "bot-2",
        observedWindow: {
          startedAt: "2026-09-18T00:00:00.000Z",
          endedAt: "2026-09-19T00:00:00.000Z",
        },
      }),
    ).toBeNull();
  });
});

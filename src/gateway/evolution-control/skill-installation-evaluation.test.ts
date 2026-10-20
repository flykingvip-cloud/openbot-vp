import { skillMetricSet } from "@openbot/evolution-core";
import type {
  DiagnosisRecheckPort,
  EvolutionExperiment,
  EvolutionProposal,
  EvolutionVerification,
  RollbackDrillRecord,
} from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import {
  evaluateSkillInstallationClosure,
  skillInstallationEvaluationApplies,
} from "./working-dna-evaluation.js";

const TENANT = "tenant-e3-skill";
const SKILL_ID = "skill-e3-existing";
const metrics = skillMetricSet();

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:skill-e3",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "diagnosis.capability.install_gap",
    target: { domain: "capability", skillId: SKILL_ID },
    candidateRef: "cand:skill-e3",
    surfaceId: "capability.skill-installation",
    expectedEffects: [metrics.primary],
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    tenantScope: TENANT,
    grantId: "grant-1",
    status: "VERIFIED",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-07T00:00:00.000Z",
    experimentId: "exp-skill-e3",
    applicationId: "app-skill-e3",
    verificationId: "ver-skill-e3",
    ...over,
  };
}

function experiment(over: Partial<EvolutionExperiment> = {}): EvolutionExperiment {
  return {
    schemaVersion: 1,
    experimentId: "exp-skill-e3",
    proposalId: "evo:skill-e3",
    surfaceId: "capability.skill-installation",
    target: { domain: "capability", skillId: SKILL_ID },
    tenantScope: TENANT,
    baselineRef: "baseline",
    candidateRef: "cand:skill-e3",
    configRef: "cfg-fixture",
    assignment: { strategy: "canary", treatmentRefs: ["t"], controlRefs: ["c"] },
    primaryMetric: metrics.primary,
    guardrailMetrics: metrics.guardrails,
    minimumSampleSize: 20,
    requiredConfidence: 0.9,
    result: "improved",
    frozen: {
      baselineVersion: "skill:published:1.0.0",
      candidateVersion: "cand:skill-e3",
      codeSha: "sha",
      modelRef: "model",
      providerVersion: "provider",
      configSnapshotRef: "cfg",
      datasetOrCohortRef: "cohort-skill",
      tenantScope: TENANT,
      confidentialityScope: "enterprise",
      expiresAt: "2026-09-07T00:00:00.000Z",
      maxResourceBudget: 1,
    },
    baselineCapture: { status: "frozen", primaryPresent: true, missingCriticalGuardrails: [] },
    ...over,
    expiresAt: over.expiresAt ?? "2026-09-07T00:00:00.000Z",
  };
}

function verification(over: Partial<EvolutionVerification> = {}): EvolutionVerification {
  return {
    schemaVersion: 1,
    verificationId: "ver-skill-e3",
    applicationId: "app-skill-e3",
    baselineWindowRef: "baseline",
    evaluationWindowRef: "treatment",
    primaryEffect: 0.2,
    guardrailResults: [],
    sampleSize: 40,
    confidence: 0.95,
    outcome: "improved",
    evidenceRefs: ["ev-a"],
    verifiedAt: "2026-09-06T11:10:00.000Z",
    ...over,
  };
}

function drills(): RollbackDrillRecord[] {
  return [
    {
      schemaVersion: 1,
      drillId: "drill-skill-1",
      proposalId: "evo:skill-e3",
      experimentId: "exp-skill-e3",
      applicationId: "app-skill-e3",
      targetVersionBefore: "skill:published:1.0.0",
      targetVersionAfter: "skill:published:1.0.0:installed",
      restoredVersion: "skill:published:1.0.0",
      startedAt: "2026-09-06T11:06:00.000Z",
      completedAt: "2026-09-06T11:07:00.000Z",
      result: "passed",
      domainReceiptRef: "receipt",
      verifiedBy: "ent-admin",
      evidenceRefs: ["ev-a"],
    },
  ];
}

function recheckPort(
  outcome: "RESOLVED" | "STILL_OPEN" | "REGRESSED" | "INCONCLUSIVE" | "BLOCKED",
): DiagnosisRecheckPort {
  return {
    async recheck(request) {
      return {
        outcome,
        findingRefs: [...request.findingRefs],
        target: request.target,
        verificationRef: request.verificationRef,
        observedEvidenceRefs: ["obs:recheck-skill"],
        reasonCode: outcome.toLowerCase(),
      };
    },
  };
}

describe("skill installation evaluation slice", () => {
  it("applies only to diagnosis-origin skill installation with an existing skillId", () => {
    expect(skillInstallationEvaluationApplies(proposal())).toBe(true);
    expect(
      skillInstallationEvaluationApplies(proposal({ sourceMechanismRef: "case-skill-install" })),
    ).toBe(false);
  });

  it("refuses an install candidate that does not name an existing skillId", async () => {
    await expect(
      evaluateSkillInstallationClosure({
        proposal: proposal({ target: { domain: "capability", skillId: "" } }),
        experiment: experiment(),
        verification: verification(),
        externalEffectOutcome: "verified",
        drills: drills(),
        authorityOk: true,
        recheckPort: recheckPort("RESOLVED"),
      }),
    ).resolves.toEqual({ action: "block", reasonCode: "unknown_target" });
    await expect(
      evaluateSkillInstallationClosure({
        proposal: proposal({ target: { domain: "agent", agentId: "bot" } }),
        experiment: experiment(),
        verification: verification(),
        externalEffectOutcome: "verified",
        drills: drills(),
        authorityOk: true,
        recheckPort: recheckPort("RESOLVED"),
      }),
    ).resolves.toEqual({ action: "block", reasonCode: "unknown_target" });
  });

  it("promotes when experiment, external effect, and finding are all resolved", async () => {
    await expect(
      evaluateSkillInstallationClosure({
        proposal: proposal(),
        experiment: experiment(),
        verification: verification(),
        externalEffectOutcome: "verified",
        drills: drills(),
        authorityOk: true,
        recheckPort: recheckPort("RESOLVED"),
      }),
    ).resolves.toEqual({ action: "promote", reasonCode: "evaluation_passed" });
  });

  it("holds when the external effect is confirmed but the finding is still open", async () => {
    await expect(
      evaluateSkillInstallationClosure({
        proposal: proposal(),
        experiment: experiment(),
        verification: verification(),
        externalEffectOutcome: "verified",
        drills: drills(),
        authorityOk: true,
        recheckPort: recheckPort("STILL_OPEN"),
      }),
    ).resolves.toEqual({ action: "hold", reasonCode: "finding_still_open" });
  });

  it("rolls back when the finding resolved but a guardrail degraded", async () => {
    await expect(
      evaluateSkillInstallationClosure({
        proposal: proposal(),
        experiment: experiment(),
        verification: verification({
          guardrailResults: [
            {
              metricId: "security_violations",
              baseline: 0,
              treatment: 1,
              degraded: true,
              critical: true,
              withinBudget: false,
            },
          ],
        }),
        externalEffectOutcome: "verified",
        drills: drills(),
        authorityOk: true,
        recheckPort: recheckPort("RESOLVED"),
      }),
    ).resolves.toEqual({ action: "rollback", reasonCode: "guardrail_degraded" });
  });

  it("stays inconclusive when the sample is too small or recheck is missing", async () => {
    await expect(
      evaluateSkillInstallationClosure({
        proposal: proposal(),
        experiment: experiment(),
        verification: verification({ sampleSize: 3, confidence: null }),
        externalEffectOutcome: "verified",
        drills: drills(),
        authorityOk: true,
        recheckPort: recheckPort("RESOLVED"),
      }),
    ).resolves.toEqual({ action: "observe", reasonCode: "sample_insufficient" });
    await expect(
      evaluateSkillInstallationClosure({
        proposal: proposal(),
        experiment: experiment(),
        verification: verification(),
        externalEffectOutcome: "verified",
        drills: drills(),
        authorityOk: true,
      }),
    ).resolves.toEqual({ action: "block", reasonCode: "recheck_required" });
  });
});

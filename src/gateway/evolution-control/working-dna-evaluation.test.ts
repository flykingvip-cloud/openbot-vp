import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  DiagnosisRecheckPort,
  EvolutionExperiment,
  EvolutionProposal,
  EvolutionVerification,
  RollbackDrillRecord,
} from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { testInspector, testObservation, withWorkingDnaExternal } from "./test-support.js";
import {
  evaluateWorkingDnaClosure,
  workingDnaEvaluationApplies,
} from "./working-dna-evaluation.js";

const TENANT = "tenant-e2-dna";
const AGENT_ID = "dna-e2-bot";
const STYLE_VERSION = `style:${DEFAULT_WORKING_STYLE.outputFormat}:${DEFAULT_WORKING_STYLE.reportingCadence}:${DEFAULT_WORKING_STYLE.decisionPreference}:${DEFAULT_WORKING_STYLE.riskPreference}:${DEFAULT_WORKING_STYLE.communicationTone}`;

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:dna-e2",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "diagnosis.behavior.reporting_cadence_gap",
    target: { domain: "agent", agentId: AGENT_ID },
    candidateRef: "cand:dna-e2",
    surfaceId: "agent.working-dna",
    expectedEffects: [
      { metricId: "task_success_rate", improveWhen: "increase", minimumEffect: 0.02 },
    ],
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    tenantScope: TENANT,
    grantId: "grant-1",
    status: "VERIFIED",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-07T00:00:00.000Z",
    experimentId: "exp-dna-e2",
    applicationId: "app-dna-e2",
    verificationId: "ver-dna-e2",
    ...over,
  };
}

function experiment(over: Partial<EvolutionExperiment> = {}): EvolutionExperiment {
  return {
    schemaVersion: 1,
    experimentId: "exp-dna-e2",
    proposalId: "evo:dna-e2",
    surfaceId: "agent.working-dna",
    target: { domain: "agent", agentId: AGENT_ID },
    tenantScope: TENANT,
    baselineRef: "baseline",
    candidateRef: "cand:dna-e2",
    configRef: "cfg-fixture",
    assignment: { strategy: "canary", treatmentRefs: ["t"], controlRefs: ["c"] },
    primaryMetric: {
      metricId: "task_success_rate",
      kind: "primary",
      improveWhen: "increase",
      minimumEffect: 0.02,
    },
    guardrailMetrics: [],
    minimumSampleSize: 20,
    requiredConfidence: 0.9,
    result: "improved",
    frozen: {
      baselineVersion: STYLE_VERSION,
      candidateVersion: "cand:dna-e2",
      codeSha: "sha",
      modelRef: "model",
      providerVersion: "provider",
      configSnapshotRef: "cfg",
      datasetOrCohortRef: "cohort-a",
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
    verificationId: "ver-dna-e2",
    applicationId: "app-dna-e2",
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
      drillId: "drill-1",
      proposalId: "evo:dna-e2",
      experimentId: "exp-dna-e2",
      applicationId: "app-dna-e2",
      targetVersionBefore: STYLE_VERSION,
      targetVersionAfter: "style-next",
      restoredVersion: STYLE_VERSION,
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
        observedEvidenceRefs: ["obs:recheck-1"],
        reasonCode: outcome.toLowerCase(),
      };
    },
  };
}

describe("working DNA evaluation slice", () => {
  it("applies only to diagnosis-origin Working DNA", () => {
    expect(workingDnaEvaluationApplies(proposal())).toBe(true);
    expect(
      workingDnaEvaluationApplies(proposal({ sourceMechanismRef: "aud:evo:dna-promote" })),
    ).toBe(false);
  });

  it("promotes when experiment, external effect, and finding are all resolved", async () => {
    await expect(
      evaluateWorkingDnaClosure({
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
      evaluateWorkingDnaClosure({
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
      evaluateWorkingDnaClosure({
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
      evaluateWorkingDnaClosure({
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
      evaluateWorkingDnaClosure({
        proposal: proposal(),
        experiment: experiment(),
        verification: verification(),
        externalEffectOutcome: "verified",
        drills: drills(),
        authorityOk: true,
      }),
    ).resolves.toEqual({ action: "block", reasonCode: "recheck_required" });
  });

  it("does not promote when baseline or freeze metadata is missing", async () => {
    await expect(
      evaluateWorkingDnaClosure({
        proposal: proposal(),
        experiment: experiment({
          baselineCapture: {
            status: "missing",
            primaryPresent: false,
            missingCriticalGuardrails: [],
          },
        }),
        verification: verification(),
        externalEffectOutcome: "verified",
        drills: drills(),
        authorityOk: true,
        recheckPort: recheckPort("RESOLVED"),
      }),
    ).resolves.toEqual({ action: "observe", reasonCode: "baseline_not_frozen" });
    await expect(
      evaluateWorkingDnaClosure({
        proposal: proposal(),
        experiment: experiment({
          frozen: {
            ...experiment().frozen,
            candidateVersion: "",
          },
        }),
        verification: verification(),
        externalEffectOutcome: "verified",
        drills: drills(),
        authorityOk: true,
        recheckPort: recheckPort("RESOLVED"),
      }),
    ).resolves.toEqual({ action: "observe", reasonCode: "freeze_incomplete" });
  });

  it("reads a pending experiment through the verification outcome", async () => {
    await expect(
      evaluateWorkingDnaClosure({
        proposal: proposal(),
        experiment: experiment({ result: "pending" }),
        verification: verification(),
        externalEffectOutcome: "verified",
        drills: drills(),
        authorityOk: true,
        recheckPort: recheckPort("RESOLVED"),
      }),
    ).resolves.toEqual({ action: "promote", reasonCode: "evaluation_passed" });
  });
});

describe("working DNA diagnosis-origin promote gate", () => {
  let tmpDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-e2-"));
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function readyPlane(port: DiagnosisRecheckPort) {
    const inner = testObservation();
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: {
        captureBaseline: (input) => inner.captureBaseline(input),
        async collect(input) {
          const row = await inner.collect(input);
          return { ...row, confidence: 0.95 };
        },
      },
      now: () => "2026-09-06T11:00:00.000Z",
      diagnosisRecheckPort: port,
      ...withWorkingDnaExternal(cfg),
    });
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:dna-e2-live",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "diagnosis.behavior.reporting_cadence_gap",
        target: { domain: "agent", agentId: AGENT_ID },
        candidateRef: "cand:dna-e2-live",
        surfaceId: "agent.working-dna",
        expectedEffects: [
          { metricId: "task_success_rate", improveWhen: "increase", minimumEffect: 0.02 },
        ],
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        tenantScope: TENANT,
        grantId: "grant-1",
        status: "APPROVED_FOR_EXPERIMENT",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-07T00:00:00.000Z",
      },
      {
        agentId: AGENT_ID,
        delta: { reportingCadence: "milestone" as const },
        baselineStyle: DEFAULT_WORKING_STYLE,
        candidateVersion: "cand:dna-e2-live",
      },
    );
    const experimentRow = await plane.startWorkingDnaExperiment({
      commandId: "exp-e2",
      proposalId: "evo:dna-e2-live",
      now: "2026-09-06T11:00:00.000Z",
      freeze: {
        baselineVersion: STYLE_VERSION,
        candidateVersion: "cand:dna-e2-live",
        codeSha: "sha-e2",
        modelRef: "model-e2",
        providerVersion: "provider-e2",
        configSnapshotRef: "cfg-e2",
        datasetOrCohortRef: "cohort-e2",
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    const evaluated = await plane.evaluateExperiment(experimentRow.experimentId);
    expect(evaluated.experiment.applyApproval).toBe("pending_apply_approval");
    await plane.applyWorkingDna({
      commandId: "apply-e2-a",
      proposalId: "evo:dna-e2-live",
      experimentId: experimentRow.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    const applicationA = plane.listApplications({ proposalId: "evo:dna-e2-live" })[0];
    if (!applicationA) {
      throw new Error("missing application");
    }
    await plane.runRollbackDrill({
      commandId: "drill-e2",
      applicationId: applicationA.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      verifiedBy: "ent-admin",
      evidenceRefs: ["ev-a"],
    });
    await plane.applyWorkingDna({
      commandId: "apply-e2-b",
      proposalId: "evo:dna-e2-live",
      experimentId: experimentRow.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    const applicationB = plane
      .listApplications({ proposalId: "evo:dna-e2-live" })
      .find((row) => row.status === "applied");
    if (!applicationB) {
      throw new Error("missing live application");
    }
    await plane.verifyApplication({
      commandId: "ver-e2",
      applicationId: applicationB.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      now: "2026-09-06T11:10:00.000Z",
    });
    return plane;
  }

  it("refuses promote when the finding is still open", async () => {
    const plane = await readyPlane(recheckPort("STILL_OPEN"));
    await expect(plane.evaluateWorkingDnaClosure("evo:dna-e2-live")).resolves.toEqual({
      action: "hold",
      reasonCode: "finding_still_open",
    });
    expect(() =>
      plane.promoteProposal({
        commandId: "promo-e2",
        proposalId: "evo:dna-e2-live",
        principalRef: "ent-admin",
        trustedTenantId: TENANT,
      }),
    ).toThrow(/finding_still_open/);
    expect(plane.getProposal("evo:dna-e2-live")?.status).toBe("VERIFIED");
  });

  it("promotes after a resolved recheck and refuses promote without that evaluation", async () => {
    const plane = await readyPlane(recheckPort("RESOLVED"));
    expect(() =>
      plane.promoteProposal({
        commandId: "promo-e2-early",
        proposalId: "evo:dna-e2-live",
        principalRef: "ent-admin",
        trustedTenantId: TENANT,
      }),
    ).toThrow(/recheck_required/);
    await expect(plane.evaluateWorkingDnaClosure("evo:dna-e2-live")).resolves.toEqual({
      action: "promote",
      reasonCode: "evaluation_passed",
    });
    const promoted = plane.promoteProposal({
      commandId: "promo-e2-ok",
      proposalId: "evo:dna-e2-live",
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(promoted.status).toBe("PROMOTED");
  });
});

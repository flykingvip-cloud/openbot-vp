import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertDiagnosisRecheckBinding,
  decideEvaluationOutcome,
  evaluationPolicyFor,
} from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { createDiagnosisRecheckPort } from "../../diagnosis/diagnose-evolution-recheck.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { createLiveDiagnosisRecheckObserver } from "./diagnosis-recheck-observer.js";
import { workingDnaBaselineHash } from "./submit-diagnosis-candidate.js";
import { testInspector, testObservation, withWorkingDnaExternal } from "./test-support.js";
import { evaluateWorkingDnaClosure } from "./working-dna-evaluation.js";

const TENANT = "tenant-c4";
const AGENT_ID = "dna-c4-joint";

describe("C4 diagnosis-origin recheck closure", () => {
  let tmpDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-c4-closure-"));
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("promotes only after the live A4 port sees a resolved Working DNA store", async () => {
    const adapter = createWorkingDnaAdapter(cfg);
    const inner = testObservation();
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT),
      workingDnaAdapter: adapter,
      observationProvider: {
        captureBaseline: (input) => inner.captureBaseline(input),
        async collect(input) {
          const row = await inner.collect(input);
          return { ...row, confidence: 0.95 };
        },
      },
      now: () => "2026-09-06T11:00:00.000Z",
      diagnosisRecheckPort: createDiagnosisRecheckPort(
        createLiveDiagnosisRecheckObserver({
          cfg,
          resolveExpectation: (request) => {
            const application = plane.getApplication(request.verificationRef.applicationId);
            return {
              expectedAgentId: AGENT_ID,
              baselineHash: application?.targetVersionBefore,
              expectedHash: application?.targetVersionAfter,
              expectedDeltaKeys: ["reportingCadence"],
            };
          },
        }),
      ),
      ...withWorkingDnaExternal(cfg),
    });
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:c4-wdna",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "diagnosis.behavior.reporting_cadence_gap",
        target: { domain: "agent", agentId: AGENT_ID },
        candidateRef: "cand:c4-wdna",
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
        candidateVersion: "cand:c4-wdna",
      },
    );
    const experiment = await plane.startWorkingDnaExperiment({
      commandId: "exp-c4",
      proposalId: "evo:c4-wdna",
      now: "2026-09-06T11:00:00.000Z",
      freeze: {
        baselineVersion: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
        candidateVersion: "cand:c4-wdna",
        codeSha: "sha-c4",
        modelRef: "model-c4",
        providerVersion: "provider-c4",
        configSnapshotRef: "cfg-c4",
        datasetOrCohortRef: "cohort-c4",
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.experiment.result).toBe("improved");
    expect(evaluated.experiment.applyApproval).toBe("pending_apply_approval");
    await plane.applyWorkingDna({
      commandId: "apply-c4-a",
      proposalId: "evo:c4-wdna",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    const application = plane.listApplications({ proposalId: "evo:c4-wdna" })[0];
    if (!application) {
      throw new Error("missing application");
    }
    await plane.runRollbackDrill({
      commandId: "drill-c4",
      applicationId: application.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      verifiedBy: "ent-admin",
      evidenceRefs: ["ev-a"],
    });
    await plane.applyWorkingDna({
      commandId: "apply-c4-b",
      proposalId: "evo:c4-wdna",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    const live = plane
      .listApplications({ proposalId: "evo:c4-wdna" })
      .find((row) => row.status === "applied");
    if (!live) {
      throw new Error("missing live application");
    }
    await plane.verifyApplication({
      commandId: "ver-c4",
      applicationId: live.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      now: "2026-09-06T11:10:00.000Z",
    });
    await expect(plane.evaluateWorkingDnaClosure("evo:c4-wdna")).resolves.toEqual({
      action: "promote",
      reasonCode: "evaluation_passed",
    });
    const promoted = plane.promoteProposal({
      commandId: "promo-c4",
      proposalId: "evo:c4-wdna",
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(promoted.status).toBe("PROMOTED");
    const replay = plane.ledger.replay("evo:c4-wdna");
    expect(replay.some((row) => row.type === "proposal.created")).toBe(true);
    expect(replay.some((row) => row.type === "application.applied")).toBe(true);
    expect(replay.filter((row) => row.eventId === "led:promo-c4:promoted")).toHaveLength(1);
    expect(plane.getCandidate("cand:c4-wdna")?.version).toBe("cand:c4-wdna");
  });

  it("does not treat control-plane VERIFIED as a resolved finding", async () => {
    await expect(
      evaluateWorkingDnaClosure({
        proposal: {
          schemaVersion: 2,
          proposalId: "evo:c4-verified-only",
          sourceEvidenceRefs: ["ev-a"],
          sourceMechanismRef: "diagnosis.behavior.reporting_cadence_gap",
          target: { domain: "agent", agentId: AGENT_ID },
          candidateRef: "cand:c4-verified-only",
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
          experimentId: "exp-c4-verified",
          applicationId: "app-c4-verified",
          verificationId: "ver-c4-verified",
        },
        experiment: {
          schemaVersion: 1,
          experimentId: "exp-c4-verified",
          proposalId: "evo:c4-verified-only",
          surfaceId: "agent.working-dna",
          target: { domain: "agent", agentId: AGENT_ID },
          tenantScope: TENANT,
          baselineRef: "baseline",
          candidateRef: "cand:c4-verified-only",
          configRef: "cfg",
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
            baselineVersion: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
            candidateVersion: "cand:c4-verified-only",
            codeSha: "sha",
            modelRef: "model",
            providerVersion: "provider",
            configSnapshotRef: "cfg",
            datasetOrCohortRef: "cohort",
            tenantScope: TENANT,
            confidentialityScope: "enterprise",
            expiresAt: "2026-09-07T00:00:00.000Z",
            maxResourceBudget: 1,
          },
          baselineCapture: {
            status: "frozen",
            primaryPresent: true,
            missingCriticalGuardrails: [],
          },
          expiresAt: "2026-09-07T00:00:00.000Z",
        },
        verification: {
          schemaVersion: 1,
          verificationId: "ver-c4-verified",
          applicationId: "app-c4-verified",
          baselineWindowRef: "baseline",
          evaluationWindowRef: "treatment",
          primaryEffect: 0.2,
          guardrailResults: [],
          sampleSize: 40,
          confidence: 0.95,
          outcome: "improved",
          evidenceRefs: ["ev-a"],
          verifiedAt: "2026-09-06T11:10:00.000Z",
        },
        externalEffectOutcome: "verified",
        drills: [
          {
            schemaVersion: 1,
            drillId: "drill-c4-verified",
            proposalId: "evo:c4-verified-only",
            experimentId: "exp-c4-verified",
            applicationId: "app-c4-verified",
            targetVersionBefore: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
            targetVersionAfter: "style-next",
            restoredVersion: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
            startedAt: "2026-09-06T11:06:00.000Z",
            completedAt: "2026-09-06T11:07:00.000Z",
            result: "passed",
            domainReceiptRef: "receipt",
            verifiedBy: "ent-admin",
            evidenceRefs: ["ev-a"],
          },
        ],
        authorityOk: true,
        recheckPort: createDiagnosisRecheckPort(
          createLiveDiagnosisRecheckObserver({
            cfg,
            resolveExpectation: () => ({
              expectedAgentId: AGENT_ID,
              baselineHash: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
              expectedHash: "style:applied",
              expectedDeltaKeys: ["reportingCadence"],
            }),
          }),
        ),
      }),
    ).resolves.toEqual({ action: "hold", reasonCode: "finding_still_open" });
  });
});

describe("C4 EvaluationPolicy and binding contract", () => {
  const policy = evaluationPolicyFor({
    surfaceId: "agent.working-dna",
    producerKind: "diagnosis-origin",
  });
  if ("ok" in policy) {
    throw new Error("phase-1 policy missing");
  }

  function signals(over: Record<string, unknown> = {}) {
    return {
      experimentResult: "improved" as const,
      guardrailDegraded: false,
      authorityOk: true,
      domainVerified: true,
      externalEffectOutcome: "verified" as const,
      recheck: "RESOLVED" as const,
      sampleSize: 40,
      confidence: 0.95,
      rollbackDrillPassed: true,
      ...over,
    };
  }

  it("requires a resolved recheck before promote", () => {
    expect(decideEvaluationOutcome(policy, signals())).toEqual({
      action: "promote",
      reasonCode: "evaluation_passed",
    });
    expect(decideEvaluationOutcome(policy, signals({ recheck: "STILL_OPEN" }))).toEqual({
      action: "hold",
      reasonCode: "finding_still_open",
    });
    expect(decideEvaluationOutcome(policy, signals({ recheck: "REGRESSED" }))).toEqual({
      action: "rollback",
      reasonCode: "finding_regressed",
    });
    expect(decideEvaluationOutcome(policy, signals({ recheck: "INCONCLUSIVE" }))).toEqual({
      action: "observe",
      reasonCode: "recheck_inconclusive",
    });
    expect(decideEvaluationOutcome(policy, signals({ recheck: "BLOCKED" }))).toEqual({
      action: "block",
      reasonCode: "recheck_blocked",
    });
    expect(decideEvaluationOutcome(policy, signals({ recheck: null }))).toEqual({
      action: "block",
      reasonCode: "recheck_required",
    });
  });

  it("keeps negative facts ahead of a missing rollback drill", () => {
    expect(
      decideEvaluationOutcome(
        policy,
        signals({ guardrailDegraded: true, rollbackDrillPassed: false }),
      ),
    ).toEqual({ action: "rollback", reasonCode: "guardrail_degraded" });
    expect(decideEvaluationOutcome(policy, signals({ rollbackDrillPassed: false }))).toEqual({
      action: "observe",
      reasonCode: "rollback_drill_not_run",
    });
  });

  it("does not require recheck for operator-origin", () => {
    const operator = evaluationPolicyFor({
      surfaceId: "agent.working-dna",
      producerKind: "operator-origin",
    });
    if ("ok" in operator) {
      throw new Error("operator policy missing");
    }
    expect(operator.diagnosisRecheckPolicy).toBe("unsupported");
    expect(decideEvaluationOutcome(operator, signals({ recheck: null }))).toEqual({
      action: "promote",
      reasonCode: "evaluation_passed",
    });
  });

  it("rejects verification, target, finding, and empty observed-evidence bindings", () => {
    const req = {
      verificationRef: {
        schemaVersion: 1 as const,
        proposalId: "p",
        experimentId: "e",
        applicationId: "a",
        verificationId: "v",
      },
      target: { domain: "agent" as const, agentId: "bot" },
      findingRefs: ["f-1"],
      surfaceId: "agent.working-dna",
      tenantScope: "tenant-a",
    };
    const res = {
      outcome: "RESOLVED" as const,
      reasonCode: "sot_confirmed",
      findingRefs: ["f-1"],
      target: { domain: "agent" as const, agentId: "bot" },
      verificationRef: req.verificationRef,
      observedEvidenceRefs: ["obs:1"],
    };
    expect(assertDiagnosisRecheckBinding(req, res)).toEqual({ ok: true });
    expect(
      assertDiagnosisRecheckBinding(req, {
        ...res,
        verificationRef: { ...req.verificationRef, applicationId: "other" },
      }),
    ).toEqual({ ok: false, code: "verification_mismatch" });
    expect(
      assertDiagnosisRecheckBinding(req, { ...res, target: { domain: "agent", agentId: "other" } }),
    ).toEqual({ ok: false, code: "target_mismatch" });
    expect(assertDiagnosisRecheckBinding(req, { ...res, findingRefs: ["f-2"] })).toEqual({
      ok: false,
      code: "finding_mismatch",
    });
    expect(() => assertDiagnosisRecheckBinding(req, { ...res, observedEvidenceRefs: [] })).toThrow(
      /observedEvidenceRefs/,
    );
  });
});

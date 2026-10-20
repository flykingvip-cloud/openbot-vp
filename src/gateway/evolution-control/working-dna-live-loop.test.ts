import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  appendEvolutionTaskOutcome,
  readEvolutionTaskOutcomes,
} from "../agent-growth/evolution-task-outcomes.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { recordRunOutcome } from "../agent-growth/operational-metrics-store.js";
import { createGatewayEvolutionControlPlane } from "./gateway-plane.js";
import { testInspector } from "./test-support.js";

const TENANT = "tenant-live-dna";
const AGENT_ID = "dna-live-bot";
const COHORT = "cohort-live-dna";
const SAMPLE_SIZE = 20;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Working DNA first real longitudinal closed loop.
 *
 * Passing this file proves the Working DNA production loop on eligible data.
 * Capsule legacy rows remain a permanent eligibility exclusion, not a bug.
 */
describe("working-dna real longitudinal loop", () => {
  let tmpDir = "";
  let persistDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-dna-live-"));
    persistDir = path.join(tmpDir, "control");
    cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] },
    } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("does not import fixtures or a passing observation provider", () => {
    const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(text).not.toMatch(/import\s*\{[^}]*createPassingObservationProvider/);
    expect(text).not.toMatch(/createPassingObservationProvider\s*\(/);
    expect(text).not.toMatch(/assessmentMode\s*[:=]\s*["']deterministic-fixture["']/);
    expect(text).not.toMatch(/\btestObservation\s*\(/);
  });

  it("runs persist → baseline → canary → recordRunOutcome → evaluate → verify → rollback → restart", async () => {
    const baselineStartMs = Date.now() - 90_000;
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      appendEvolutionTaskOutcome(
        cfg,
        {
          agentId: AGENT_ID,
          occurredAt: baselineStartMs + i * 2_000,
          succeeded: i % 2 === 0,
          runId: `run-base-${i}`,
          tenantId: TENANT,
          cohortRef: COHORT,
          latencyMs: 40,
          toolsObserved: 0,
          humanTakeover: false,
        },
        { persistDir },
      );
    }

    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
    });
    plane.ingestV1(
      {
        schemaVersion: 1,
        proposalId: "evo:dna-live",
        sourceFindingIds: ["f-live"],
        sourceEvidenceRefs: ["ev-a"],
        tenantScope: TENANT,
        targetDomain: "agent_working_dna",
        proposedChange: { summary: "make reporting conservative" },
        expectedEffect: "raise success",
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        status: "APPROVED",
        approvalRequired: true,
        approverScope: "enterprise",
        grantId: "grant-1",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        auditReceipt: "aud:evo:dna-live",
        candidateRef: "cand:dna-live",
      },
      { agentId: AGENT_ID },
    );
    const baselineRows = readEvolutionTaskOutcomes(cfg, AGENT_ID);
    expect(baselineRows).toHaveLength(SAMPLE_SIZE);
    expect(baselineRows.every((row) => row.cohortRef === COHORT && row.runId)).toBe(true);
    expect(baselineRows.every((row) => row.securityViolation === false)).toBe(true);
    const candidate = plane.registerCandidate("cand:dna-live", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:dna-live",
    });
    expect(candidate.candidateRef).toBe("cand:dna-live");

    const experiment = await plane.startExperiment({
      commandId: "exp-dna-live",
      proposalId: "evo:dna-live",
      now: new Date(baselineStartMs + SAMPLE_SIZE * 2_000).toISOString(),
      freeze: {
        baselineVersion: `style:${DEFAULT_WORKING_STYLE.outputFormat}:${DEFAULT_WORKING_STYLE.reportingCadence}:${DEFAULT_WORKING_STYLE.decisionPreference}:${DEFAULT_WORKING_STYLE.riskPreference}:${DEFAULT_WORKING_STYLE.communicationTone}`,
        candidateVersion: "cand:dna-live",
        codeSha: "sha-live",
        modelRef: "model-live",
        providerVersion: "provider-live",
        configSnapshotRef: "cfg-live",
        datasetOrCohortRef: COHORT,
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2099-01-01T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    expect(experiment.baselineCapture?.status).toBe("frozen");
    expect(experiment.baselineCapture?.primaryPresent).toBe(true);
    expect(experiment.baselineCapture?.missingCriticalGuardrails).toEqual([]);

    const application = await plane.applyWorkingDna({
      commandId: "apply-dna-live",
      proposalId: "evo:dna-live",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(application.appliedToRuntime).toBe(true);
    expect(application.scope).toBe("canary");

    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      await recordRunOutcome(cfg, AGENT_ID, {
        success: true,
        runId: `run-treat-${i}`,
        tenantId: TENANT,
        latencyMs: 35,
        toolsTotal: 0,
        humanTakeover: false,
        occurredAt: Date.now(),
        evolutionPersistDir: persistDir,
      });
    }
    await recordRunOutcome(cfg, AGENT_ID, {
      success: true,
      tenantId: TENANT,
      latencyMs: 30,
      toolsTotal: 0,
      humanTakeover: false,
      occurredAt: Date.now(),
      evolutionPersistDir: persistDir,
    });
    appendEvolutionTaskOutcome(
      cfg,
      {
        agentId: AGENT_ID,
        occurredAt: Date.now(),
        succeeded: true,
        runId: "run-forged",
        tenantId: TENANT,
        experimentId: "exp-forged",
        applicationId: "app:forged",
        cohortRef: "cohort-forged",
        latencyMs: 20,
        toolsObserved: 0,
        humanTakeover: false,
      },
      { persistDir },
    );

    const rows = readEvolutionTaskOutcomes(cfg, AGENT_ID);
    const treatmentBound = rows.filter((row) => row.runId?.startsWith("run-treat-"));
    expect(treatmentBound).toHaveLength(SAMPLE_SIZE);
    expect(
      treatmentBound.every(
        (row) =>
          row.experimentId === experiment.experimentId &&
          row.applicationId === application.applicationId &&
          row.cohortRef === COHORT,
      ),
    ).toBe(true);
    const unlabeled = rows.find((row) => !row.runId);
    expect(unlabeled?.experimentId).toBe(experiment.experimentId);
    expect(unlabeled?.runId).toBeUndefined();
    const forged = rows.find((row) => row.runId === "run-forged");
    expect(forged?.experimentId).toBeUndefined();
    expect(forged?.applicationId).toBeUndefined();
    expect(forged?.cohortRef).toBeUndefined();
    expect(forged?.runId).toBe("run-forged");
    expect(forged?.tenantId).toBe(TENANT);

    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.decision.assessment.method).toBe("two-proportion-z");
    expect(evaluated.decision.assessment.confidence).not.toBeNull();
    expect(evaluated.decision.assessment.notes).not.toContain("offline_deterministic_contract");
    expect(evaluated.decision.assessment.baselineTrials).toBeGreaterThanOrEqual(SAMPLE_SIZE);
    expect(evaluated.decision.assessment.treatmentTrials).toBeGreaterThanOrEqual(SAMPLE_SIZE);
    expect(evaluated.decision.reasons).toContain("rollback_drill_not_run");
    expect(evaluated.decision.reasons).not.toContain("sample_size_insufficient");
    expect(evaluated.decision.reasons).not.toContain("window_overlap");
    expect(evaluated.decision.reasons).not.toContain("cohort_contaminated");
    expect(evaluated.decision.reasons).not.toContain("treatment_premature");
    expect(evaluated.decision.reasons).not.toContain("baseline_contaminated");
    expect(evaluated.decision.primaryEffect).toBeGreaterThan(0);

    const verification = await plane.verifyApplication({
      commandId: "verify-dna-live",
      applicationId: application.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(verification.assessment?.method).toBe("two-proportion-z");
    expect(verification.outcome).not.toBe("improved");
    expect(plane.getProposal("evo:dna-live")?.status).toBe("CANARY");
    expect(plane.getProposal("evo:dna-live")?.status).not.toBe("VERIFIED");

    const rolled = await plane.rollbackApplication({
      commandId: "rollback-dna-live",
      applicationId: application.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(rolled.application.status).toBe("rolled_back");

    const restarted = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
    });
    expect(restarted.getProposal("evo:dna-live")?.status).toBe("ROLLED_BACK");
    expect(restarted.getExperiment(experiment.experimentId)?.baselineCapture?.status).toBe(
      "frozen",
    );
    expect(restarted.getApplication(application.applicationId)?.status).toBe("rolled_back");
    expect(restarted.ledger.replay("evo:dna-live").map((row) => row.type)).toEqual(
      expect.arrayContaining([
        "legacy.imported",
        "experiment.started",
        "experiment.completed",
        "application.applied",
        "verification.completed",
        "rollback.started",
        "rollback.completed",
      ]),
    );
  });

  it("keeps Capsule and the generic verifier honestly unfinished", () => {
    expect(
      readFileSync(
        path.join(ROOT, "src/gateway/evolution-control/adapters/runtime-governance.ts"),
        "utf8",
      ),
    ).toMatch(/governance_human_intervention_rate/);
    expect(
      readFileSync(path.join(ROOT, "src/gateway/evolution-control/adapters/capsule.ts"), "utf8"),
    ).toMatch(/without failureClusterRef cannot compute recurrence/);
    expect(
      readFileSync(path.join(ROOT, "src/infra/execution-chain-provenance.ts"), "utf8"),
    ).toMatch(/Generic production verification is not implemented/);
  });
});

import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ledgerEventIsReceiptNotProof,
  projectEvolutionLineage,
  type EvolutionLedgerEventType,
} from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  appendEvolutionTaskOutcome,
  readEvolutionTaskOutcomes,
} from "../agent-growth/evolution-task-outcomes.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { recordRunOutcome } from "../agent-growth/operational-metrics-store.js";
import { readRobotWorkingStyle } from "../agent-growth/working-style-store.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createGatewayEvolutionControlPlane } from "./gateway-plane.js";
import { testInspector } from "./test-support.js";

const TENANT = "tenant-promote-dna";
const AGENT_ID = "dna-promote-bot";
const COHORT = "cohort-promote-dna";
const SAMPLE_SIZE = 20;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_STYLE_VERSION = `style:${DEFAULT_WORKING_STYLE.outputFormat}:${DEFAULT_WORKING_STYLE.reportingCadence}:${DEFAULT_WORKING_STYLE.decisionPreference}:${DEFAULT_WORKING_STYLE.riskPreference}:${DEFAULT_WORKING_STYLE.communicationTone}`;

/**
 * Working DNA successful promotion closed loop.
 *
 * Passing this file proves Working DNA eligible-data promotion, including
 * independent external verification. Capsule legacy rows stay excluded.
 */
describe("working-dna successful promotion loop", () => {
  let tmpDir = "";
  let persistDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-dna-promote-"));
    persistDir = path.join(tmpDir, "control");
    cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] },
    } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("does not import fixtures or stamp a passed drill", () => {
    const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(text).not.toMatch(/import\s*\{[^}]*createPassingObservationProvider/);
    expect(text).not.toMatch(/createPassingObservationProvider\s*\(/);
    expect(text).not.toMatch(/assessmentMode\s*[:=]\s*["']deterministic-fixture["']/);
    expect(text).not.toMatch(/\btestObservation\s*\(/);
    expect(text).not.toMatch(/rollbackDrill\s*[:=]\s*["']passed["']/);
    expect(text).not.toMatch(/confidence\s*[:=]\s*0\.9[05]/);
    expect(text).not.toMatch(/experimentId:\s*["']exp:/);
    expect(text).not.toMatch(/applicationId:\s*["']app:/);
  });

  it("promotes only after a real rollback drill, re-apply, and verification", async () => {
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
        proposalId: "evo:dna-promote",
        sourceFindingIds: ["f-promote"],
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
        auditReceipt: "aud:evo:dna-promote",
        candidateRef: "cand:dna-promote",
      },
      { agentId: AGENT_ID },
    );
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)).toHaveLength(SAMPLE_SIZE);
    plane.registerCandidate("cand:dna-promote", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:dna-promote",
    });

    const experiment = await plane.startExperiment({
      commandId: "exp-dna-promote",
      proposalId: "evo:dna-promote",
      now: new Date(baselineStartMs + SAMPLE_SIZE * 2_000).toISOString(),
      freeze: {
        baselineVersion: DEFAULT_STYLE_VERSION,
        candidateVersion: "cand:dna-promote",
        codeSha: "sha-promote",
        modelRef: "model-promote",
        providerVersion: "provider-promote",
        configSnapshotRef: "cfg-promote",
        datasetOrCohortRef: COHORT,
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2099-01-01T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    expect(experiment.baselineCapture?.status).toBe("frozen");

    const applicationA = await plane.applyWorkingDna({
      commandId: "apply-dna-promote-a",
      proposalId: "evo:dna-promote",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(applicationA.purpose).toBe("canary");
    expect(applicationA.appliedToRuntime).toBe(true);
    expect(applicationA.targetVersionBefore).toBe(DEFAULT_STYLE_VERSION);

    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      await recordRunOutcome(cfg, AGENT_ID, {
        success: true,
        runId: `run-treat-a-${i}`,
        tenantId: TENANT,
        latencyMs: 35,
        toolsTotal: 0,
        humanTakeover: false,
        occurredAt: Date.now(),
        evolutionPersistDir: persistDir,
      });
    }

    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.decision.assessment.method).toBe("two-proportion-z");
    expect(evaluated.decision.assessment.confidence).not.toBeNull();
    expect(evaluated.decision.primaryEffect).toBeGreaterThan(0);
    expect(evaluated.decision.reasons).toContain("rollback_drill_not_run");
    expect(plane.getProposal("evo:dna-promote")?.status).toBe("CANARY");

    const drill = await plane.runRollbackDrill({
      commandId: "drill-dna-promote-a",
      applicationId: applicationA.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      verifiedBy: "ent-admin",
      evidenceRefs: ["ev-drill-inspect"],
    });
    expect(drill.result).toBe("passed");
    expect(drill.applicationId).toBe(applicationA.applicationId);
    expect(drill.restoredVersion).toBe(applicationA.targetVersionBefore);
    expect(drill.restoredVersion).not.toBe(applicationA.targetVersionAfter);
    const restored = await createWorkingDnaAdapter(cfg).inspect({
      domain: "agent",
      agentId: AGENT_ID,
    });
    expect(restored.version).toBe(applicationA.targetVersionBefore);
    expect(plane.getApplication(applicationA.applicationId)?.status).toBe("rolled_back");
    expect(plane.getApplication(applicationA.applicationId)?.rollbackDrillId).toBe(drill.drillId);
    expect(plane.getProposal("evo:dna-promote")?.status).toBe("EXPERIMENTING");
    expect(plane.getProposal("evo:dna-promote")?.status).not.toBe("ROLLED_BACK");

    const applicationB = await plane.applyWorkingDna({
      commandId: "apply-dna-promote-b",
      proposalId: "evo:dna-promote",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(applicationB.applicationId).not.toBe(applicationA.applicationId);
    expect(applicationB.idempotencyKey).not.toBe(applicationA.idempotencyKey);
    expect(applicationB.purpose).toBe("canary");
    expect(applicationB.status).toBe("applied");

    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      await recordRunOutcome(cfg, AGENT_ID, {
        success: true,
        runId: `run-treat-b-${i}`,
        tenantId: TENANT,
        latencyMs: 32,
        toolsTotal: 0,
        humanTakeover: false,
        occurredAt: Date.now(),
        evolutionPersistDir: persistDir,
      });
    }
    const boundB = readEvolutionTaskOutcomes(cfg, AGENT_ID).filter((row) =>
      row.runId?.startsWith("run-treat-b-"),
    );
    expect(boundB).toHaveLength(SAMPLE_SIZE);
    expect(
      boundB.every(
        (row) =>
          row.experimentId === experiment.experimentId &&
          row.applicationId === applicationB.applicationId,
      ),
    ).toBe(true);

    const verification = await plane.verifyApplication({
      commandId: "verify-dna-promote-b",
      applicationId: applicationB.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(verification.applicationId).toBe(applicationB.applicationId);
    expect(verification.outcome).toBe("improved");
    expect(verification.assessment?.method).toBe("two-proportion-z");
    expect(plane.getProposal("evo:dna-promote")?.status).toBe("VERIFIED");

    const promoted = plane.promoteProposal({
      commandId: "promote-dna-promote",
      proposalId: "evo:dna-promote",
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(promoted.status).toBe("PROMOTED");
    expect(plane.getApplication(applicationB.applicationId)?.purpose).toBe("promoted");
    expect(plane.getApplication(applicationA.applicationId)?.purpose).toBe("canary");
    expect((await readRobotWorkingStyle(cfg, AGENT_ID))?.riskPreference).toBe("conservative");

    const restarted = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
    });
    expect(restarted.getProposal("evo:dna-promote")?.status).toBe("PROMOTED");
    expect(restarted.getExperiment(experiment.experimentId)?.baselineCapture?.status).toBe(
      "frozen",
    );
    expect(restarted.getApplication(applicationA.applicationId)?.status).toBe("rolled_back");
    expect(restarted.getApplication(applicationB.applicationId)?.purpose).toBe("promoted");
    expect(restarted.getVerification(verification.verificationId)?.outcome).toBe("improved");
    expect(restarted.getRollbackDrill(drill.drillId)?.result).toBe("passed");
    expect((await readRobotWorkingStyle(cfg, AGENT_ID))?.riskPreference).toBe("conservative");

    const replayed = restarted.ledger.replay("evo:dna-promote");
    const types = replayed.map((row) => row.type);
    const required: EvolutionLedgerEventType[] = [
      "experiment.started",
      "application.applied",
      "rollback_drill.started",
      "rollback_drill.completed",
      "application.rolled_back",
      "application.applied",
      "verification.completed",
      "promotion.completed",
    ];
    let cursor = -1;
    for (const type of required) {
      const next = types.indexOf(type, cursor + 1);
      expect(next, `missing ledger ${type}`).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(ledgerEventIsReceiptNotProof("rollback_drill.completed")).toBe(true);
    expect(ledgerEventIsReceiptNotProof("application.rolled_back")).toBe(true);
    expect(ledgerEventIsReceiptNotProof("verification.completed")).toBe(false);
    expect(ledgerEventIsReceiptNotProof("promotion.completed")).toBe(false);

    const lineage = projectEvolutionLineage({
      proposal: restarted.getProposal("evo:dna-promote")!,
      events: replayed,
    });
    expect(lineage.status).toBe("PROMOTED");
    expect(lineage.effectProof).toBe("verified");
    expect(
      lineage.steps
        .filter((step) => step.type === "application.applied")
        .map((step) => step.eventId),
    ).toHaveLength(2);
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

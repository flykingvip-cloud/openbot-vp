import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EvolutionApplication } from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { appendEvolutionTaskOutcome } from "../agent-growth/evolution-task-outcomes.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { recordRunOutcome } from "../agent-growth/operational-metrics-store.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import type { EvolutionControlPlane } from "./control-plane.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { createGatewayEvolutionControlPlane } from "./gateway-plane.js";
import { createAdapterObservationProvider } from "./observation.js";
import { resolveEvolutionAdapterDir } from "./persistent-store.js";
import { testInspector } from "./test-support.js";

const TENANT = "tenant-drill-dna";
const AGENT_ID = "dna-drill-bot";
const COHORT = "cohort-drill-dna";
const SAMPLE_SIZE = 20;
const DEFAULT_STYLE_VERSION = `style:${DEFAULT_WORKING_STYLE.outputFormat}:${DEFAULT_WORKING_STYLE.reportingCadence}:${DEFAULT_WORKING_STYLE.decisionPreference}:${DEFAULT_WORKING_STYLE.riskPreference}:${DEFAULT_WORKING_STYLE.communicationTone}`;

async function writeBaseline(cfg: OpenBotConfig, persistDir: string, startedAtMs: number) {
  for (let i = 0; i < SAMPLE_SIZE; i += 1) {
    appendEvolutionTaskOutcome(
      cfg,
      {
        agentId: AGENT_ID,
        occurredAt: startedAtMs + i * 2_000,
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
}

async function startCanary(input: {
  cfg: OpenBotConfig;
  persistDir: string;
  plane: EvolutionControlPlane;
  startedAtMs: number;
  commandSuffix: string;
}) {
  input.plane.ingestV1(
    {
      schemaVersion: 1,
      proposalId: `evo:dna-drill-${input.commandSuffix}`,
      sourceFindingIds: ["f-drill"],
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
      auditReceipt: `aud:evo:dna-drill-${input.commandSuffix}`,
      candidateRef: `cand:dna-drill-${input.commandSuffix}`,
    },
    { agentId: AGENT_ID },
  );
  input.plane.registerCandidate(`cand:dna-drill-${input.commandSuffix}`, {
    agentId: AGENT_ID,
    delta: { riskPreference: "conservative" },
    baselineStyle: DEFAULT_WORKING_STYLE,
    candidateVersion: `cand:dna-drill-${input.commandSuffix}`,
  });
  const experiment = await input.plane.startExperiment({
    commandId: `exp-dna-drill-${input.commandSuffix}`,
    proposalId: `evo:dna-drill-${input.commandSuffix}`,
    now: new Date(input.startedAtMs).toISOString(),
    freeze: {
      baselineVersion: DEFAULT_STYLE_VERSION,
      candidateVersion: `cand:dna-drill-${input.commandSuffix}`,
      codeSha: "sha-drill",
      modelRef: "model-drill",
      providerVersion: "provider-drill",
      configSnapshotRef: "cfg-drill",
      datasetOrCohortRef: COHORT,
      tenantScope: TENANT,
      confidentialityScope: "enterprise",
      expiresAt: "2099-01-01T00:00:00.000Z",
      maxResourceBudget: 1,
    },
  });
  const application = await input.plane.applyWorkingDna({
    commandId: `apply-dna-drill-${input.commandSuffix}`,
    proposalId: `evo:dna-drill-${input.commandSuffix}`,
    experimentId: experiment.experimentId,
    principalRef: "ent-admin",
    trustedTenantId: TENANT,
    scope: "canary",
  });
  return { experiment, application };
}

describe("governed rollback drill", () => {
  let tmpDir = "";
  let persistDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-drill-"));
    persistDir = path.join(tmpDir, "control");
    cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] },
    } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("does not stamp rollbackDrill=passed in this file", () => {
    const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(text).not.toMatch(/rollbackDrill\s*[:=]\s*["']passed["']/);
    expect(text).not.toMatch(/createPassingObservationProvider\s*\(/);
  });

  it("does not treat a business rollback as a passed drill", async () => {
    const startedAtMs = Date.now() - 90_000;
    await writeBaseline(cfg, persistDir, startedAtMs);
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
    });
    const { experiment, application } = await startCanary({
      cfg,
      persistDir,
      plane,
      startedAtMs,
      commandSuffix: "biz",
    });
    await plane.rollbackApplication({
      commandId: "rollback-dna-drill-biz",
      applicationId: application.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(plane.listRollbackDrills({ experimentId: experiment.experimentId })).toEqual([]);
    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.decision.reasons).not.toContain("rollback_drill_failed");
    expect(evaluated.decision.result).not.toBe("improved");
    expect(plane.getProposal("evo:dna-drill-biz")?.status).toBe("ROLLED_BACK");
    expect(
      plane.ledger
        .replay("evo:dna-drill-biz")
        .some((row) => row.type === "rollback_drill.completed"),
    ).toBe(false);
  });

  it("blocks VERIFIED and PROMOTED when the real adapter drill fails", async () => {
    const startedAtMs = Date.now() - 90_000;
    await writeBaseline(cfg, persistDir, startedAtMs);
    const real = createWorkingDnaAdapter(cfg, {
      persistDir: resolveEvolutionAdapterDir(persistDir),
    });
    const failing = {
      ...real,
      async rollback(application: EvolutionApplication) {
        return {
          applicationId: application.applicationId,
          status: "failed" as const,
          restoredVersion: "style:not-restored",
          reason: "forced-adapter-failure",
        };
      },
    };
    const plane = createEvolutionControlPlane({
      persistDir,
      inspector: testInspector(TENANT),
      workingDnaAdapter: failing,
      observationProvider: createAdapterObservationProvider({
        persistDir,
        resolveAdapter: () => failing,
      }),
    });
    const { experiment, application } = await startCanary({
      cfg,
      persistDir,
      plane,
      startedAtMs,
      commandSuffix: "fail",
    });
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      await recordRunOutcome(cfg, AGENT_ID, {
        success: true,
        runId: `run-treat-fail-${i}`,
        tenantId: TENANT,
        latencyMs: 30,
        toolsTotal: 0,
        humanTakeover: false,
        occurredAt: Date.now(),
        evolutionPersistDir: persistDir,
      });
    }
    const drill = await plane.runRollbackDrill({
      commandId: "drill-dna-fail",
      applicationId: application.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      verifiedBy: "ent-admin",
    });
    expect(drill.result).toBe("failed");
    expect(plane.getProposal("evo:dna-drill-fail")?.status).toBe("CANARY");
    expect(plane.getApplication(application.applicationId)?.status).toBe("applied");

    const verification = await plane.verifyApplication({
      commandId: "verify-dna-fail",
      applicationId: application.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(verification.outcome).not.toBe("improved");
    expect(plane.getProposal("evo:dna-drill-fail")?.status).toBe("CANARY");
    expect(plane.getProposal("evo:dna-drill-fail")?.status).not.toBe("VERIFIED");
    expect(() =>
      plane.promoteProposal({
        commandId: "promote-dna-fail",
        proposalId: "evo:dna-drill-fail",
        principalRef: "ent-admin",
        trustedTenantId: TENANT,
      }),
    ).toThrow(/not VERIFIED|verification/);

    const restarted = createEvolutionControlPlane({
      persistDir,
      inspector: testInspector(TENANT),
      workingDnaAdapter: failing,
      observationProvider: createAdapterObservationProvider({
        persistDir,
        resolveAdapter: () => failing,
      }),
    });
    expect(restarted.getRollbackDrill(drill.drillId)?.result).toBe("failed");
    expect(restarted.getProposal("evo:dna-drill-fail")?.status).toBe("CANARY");
    expect(restarted.ledger.replay("evo:dna-drill-fail").map((row) => row.type)).toEqual(
      expect.arrayContaining(["rollback_drill.started", "rollback_drill.completed"]),
    );
    expect(
      restarted.ledger
        .replay("evo:dna-drill-fail")
        .some((row) => row.type === "application.rolled_back"),
    ).toBe(false);
    expect(experiment.experimentId.startsWith("exp:")).toBe(true);
  });
});

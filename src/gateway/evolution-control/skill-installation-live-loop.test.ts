import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skillMetricSet, type EvolutionLedgerEventType } from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { testInspector } from "./test-support.js";

const TENANT = "tenant-skill-install-live";
const AGENT_ID = "skill-install-live-bot";
const COHORT = "cohort-skill-install-live";
const SAMPLE_SIZE = 20;
const { CONFIG_DIR } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require("node:os") as typeof import("node:os");
  return {
    CONFIG_DIR: nodePath.join(nodeOs.tmpdir(), `openbot-evo-skill-install-live-${Date.now()}`),
  };
});

vi.mock("../../utils.js", () => ({ CONFIG_DIR }));

const {
  getPersonalSkillAssetDetail,
  listRobotSkillAssets,
  resetSkillHealthWindowsCacheForTests,
  saveSkillAsset,
} = await import("../skill-lifecycle-store.js");
const { recordSkillInvocationCompleted } = await import("../skill-invocation/record.js");
const { createGatewayEvolutionControlPlane } = await import("./gateway-plane.js");

/**
 * Skill installation second-domain external verification live loop.
 *
 * Capsule legacy rows stay a permanent eligibility exclusion and are not a
 * remaining engineering item for this closed loop.
 */
describe("skill installation real longitudinal loop", () => {
  let persistDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    resetSkillHealthWindowsCacheForTests();
    await fs.rm(CONFIG_DIR, { recursive: true, force: true });
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    persistDir = path.join(CONFIG_DIR, "control");
    cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir: CONFIG_DIR }] },
    } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    resetSkillHealthWindowsCacheForTests();
    await fs.rm(CONFIG_DIR, { recursive: true, force: true });
  });

  it("does not import fixtures, passing providers, or adapter queries as proof", () => {
    const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
    expect(text).not.toMatch(/import\s*\{[^}]*createPassingObservationProvider/);
    expect(text).not.toMatch(/createPassingObservationProvider\s*\(/);
    expect(text).not.toMatch(/assessmentMode\s*[:=]\s*["']deterministic-fixture["']/);
    expect(text).not.toMatch(/\btestObservation\s*\(/);
    expect(text).not.toMatch(/from\s+["'][^"']*adapters\/skill/);
    expect(text).not.toMatch(/submitResult\s*\(/);
  });

  it("runs draft → baseline → canary install → EFFECT_VERIFIED → treatment → VERIFIED → promote → restart", async () => {
    const saved = saveSkillAsset({
      sourceAgentId: "author-bot",
      autoInstallEnabled: false,
      lifecycle: "private",
      profile: {
        name: "Install loop",
        summary: "Skill used only for the installation verifier live loop.",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: { prompts: ["stay brief"] },
    });
    const skillId = saved.skillId;
    const detail = getPersonalSkillAssetDetail(skillId);
    expect(detail.version).toBe("1.0.0");
    expect(listRobotSkillAssets(AGENT_ID).some((row) => row.id === skillId)).toBe(false);

    const baselineStartMs = Date.now() - 90_000;
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      recordSkillInvocationCompleted(
        {
          invocationId: `inv-base-${i}`,
          skillId,
          agentId: AGENT_ID,
          skillVersion: detail.version,
          tenantId: TENANT,
          outcome: i % 2 === 0 ? "success" : "failure",
          latencyMs: 40,
          completedAt: baselineStartMs + i * 2_000,
          runId: `run-base-${i}`,
          businessOutcome: null,
        },
        { configDir: CONFIG_DIR },
      );
    }

    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
    });
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:skill-install-live",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "case-skill-install",
        target: { domain: "capability", skillId },
        candidateRef: "cand:skill-install-live",
        surfaceId: "capability.skill-installation",
        expectedEffects: [skillMetricSet().primary],
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        tenantScope: TENANT,
        grantId: "grant-1",
        status: "APPROVED_FOR_EXPERIMENT",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      {
        skillId,
        operation: "install",
        agentId: AGENT_ID,
        candidateVersion: "cand:skill-install-live",
      },
    );

    const experiment = await plane.startExperiment({
      commandId: "exp-skill-install-live",
      proposalId: "evo:skill-install-live",
      now: new Date(baselineStartMs + SAMPLE_SIZE * 2_000).toISOString(),
      freeze: {
        baselineVersion: `skill:${detail.lifecycle}:${detail.version}`,
        candidateVersion: "cand:skill-install-live",
        codeSha: "sha-skill-install",
        modelRef: "model-skill-install",
        providerVersion: "provider-skill-install",
        configSnapshotRef: "cfg-skill-install",
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

    const applicationA = await plane.applySkill({
      commandId: "apply-skill-install-a",
      proposalId: "evo:skill-install-live",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(applicationA.adapterId).toBe("skill-installation");
    expect(applicationA.status).toBe("applied");
    const installed = listRobotSkillAssets(AGENT_ID).find((row) => row.id === skillId);
    expect(installed?.installedVersion).toBe("1.0.0");
    expect(installed?.enabled).toBe(true);

    const firstVerify = await plane.verifyApplication({
      commandId: "verify-skill-install-a",
      applicationId: applicationA.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(plane.getExternalEffectResult(applicationA.applicationId)?.outcome).toBe("verified");
    expect(plane.getExternalEffectResult(applicationA.applicationId)?.verifierId).toBe(
      "skill-installation-read-after-write",
    );
    expect(firstVerify.outcome).not.toBe("improved");
    expect(plane.getProposal("evo:skill-install-live")?.status).toBe("CANARY");
    expect(() =>
      plane.promoteProposal({
        commandId: "promo-too-early",
        proposalId: "evo:skill-install-live",
        principalRef: "ent-admin",
        trustedTenantId: TENANT,
      }),
    ).toThrow(/not VERIFIED|OUTCOME_VERIFIED/i);

    const drill = await plane.runRollbackDrill({
      commandId: "drill-skill-install-a",
      applicationId: applicationA.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      verifiedBy: "ent-admin",
      evidenceRefs: ["ev-drill-skill"],
    });
    expect(drill.result).toBe("passed");
    expect(listRobotSkillAssets(AGENT_ID).some((row) => row.id === skillId)).toBe(false);

    const applicationB = await plane.applySkill({
      commandId: "apply-skill-install-b",
      proposalId: "evo:skill-install-live",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(applicationB.applicationId).not.toBe(applicationA.applicationId);
    expect(listRobotSkillAssets(AGENT_ID).some((row) => row.id === skillId)).toBe(true);

    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      recordSkillInvocationCompleted(
        {
          invocationId: `inv-treat-${i}`,
          skillId,
          agentId: AGENT_ID,
          skillVersion: detail.version,
          tenantId: TENANT,
          outcome: "success",
          latencyMs: 28,
          completedAt: Date.now(),
          runId: `run-treat-${i}`,
          businessOutcome: null,
        },
        { configDir: CONFIG_DIR, persistDir },
      );
    }

    const verification = await plane.verifyApplication({
      commandId: "verify-skill-install-b",
      applicationId: applicationB.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(plane.getExternalEffectResult(applicationB.applicationId)?.outcome).toBe("verified");
    expect(verification.outcome).toBe("improved");
    expect(verification.assessment?.method).toBe("two-proportion-z");
    expect(plane.getProposal("evo:skill-install-live")?.status).toBe("VERIFIED");

    const promoted = plane.promoteProposal({
      commandId: "promote-skill-install",
      proposalId: "evo:skill-install-live",
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(promoted.status).toBe("PROMOTED");

    const restarted = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
    });
    expect(restarted.getProposal("evo:skill-install-live")?.status).toBe("PROMOTED");
    expect(restarted.getExperiment(experiment.experimentId)?.baselineCapture?.status).toBe(
      "frozen",
    );
    expect(restarted.getApplication(applicationB.applicationId)?.status).toBe("applied");
    expect(restarted.getVerification(verification.verificationId)?.outcome).toBe("improved");
    expect(restarted.getExternalEffectResult(applicationB.applicationId)?.outcome).toBe("verified");
    expect(restarted.getExternalEffectResult(applicationB.applicationId)?.receipt.requestId).toBe(
      `eef:${applicationB.applicationId}`,
    );
    const types = restarted.ledger.replay("evo:skill-install-live").map((row) => row.type);
    const required: EvolutionLedgerEventType[] = [
      "experiment.started",
      "application.applied",
      "external_effect.recorded",
      "verification.completed",
      "rollback_drill.completed",
      "application.applied",
      "verification.completed",
      "promotion.completed",
    ];
    for (const type of required) {
      expect(types).toContain(type);
    }
  });
});

import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  queryEvolutionPerception,
  type EvolutionLedgerEventType,
  type EvolutionProposal,
  type EvolutionTimelineItem,
} from "@openbot/evolution-core";
import { projectEvolutionTimelineItem } from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  appendEvolutionTaskOutcome,
  readEvolutionTaskOutcomes,
} from "../agent-growth/evolution-task-outcomes.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { recordRunOutcome } from "../agent-growth/operational-metrics-store.js";
import { createGatewayEvolutionControlPlane } from "./gateway-plane.js";
import {
  advanceSoftObserveDhProposal,
  classifySoftObserveDhStep,
  isSoftObserveDhEnabled,
  runSoftObserveDhLoopTick,
  setSoftObserveDhEnabledForTests,
  SOFT_OBSERVE_DH_SURFACES,
} from "./soft-observe-dh-loop.js";
import { testInspector } from "./test-support.js";

const TENANT = "tenant-soft-obs-dh";
const AGENT_ID = "dna-soft-obs-bot";
const COHORT = "cohort-soft-obs-dh";
const SAMPLE_SIZE = 20;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const LOOP_SRC = path.join(ROOT, "src/gateway/evolution-control/soft-observe-dh-loop.ts");
const SCHED_SRC = path.join(ROOT, "src/gateway/evolution-governance/scheduler.ts");
const DEFAULT_STYLE_VERSION = `style:${DEFAULT_WORKING_STYLE.outputFormat}:${DEFAULT_WORKING_STYLE.reportingCadence}:${DEFAULT_WORKING_STYLE.decisionPreference}:${DEFAULT_WORKING_STYLE.riskPreference}:${DEFAULT_WORKING_STYLE.communicationTone}`;

function includedTimeline(
  input: Parameters<typeof projectEvolutionTimelineItem>[0],
): EvolutionTimelineItem {
  const projected = projectEvolutionTimelineItem(input);
  expect(projected.included).toBe(true);
  if (!projected.included) {
    throw new Error(projected.reason);
  }
  return projected.item;
}

function systemProposal(): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:system-skip",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "governance.runtime",
    target: { domain: "system", componentId: "runtime-binding" },
    candidateRef: "cand:sys",
    surfaceId: "system.runtime-binding-governance",
    expectedEffects: [],
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    tenantScope: TENANT,
    grantId: "grant-1",
    status: "EXPERIMENTING",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    experimentId: "exp:sys",
  };
}

describe("soft/observe digital-employee Apply→Verify→Promote loop", () => {
  let tmpDir = "";
  let persistDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-soft-obs-dh-"));
    persistDir = path.join(tmpDir, "control");
    cfg = {
      agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] },
    } as unknown as OpenBotConfig;
    setSoftObserveDhEnabledForTests(true);
  });

  afterEach(async () => {
    setSoftObserveDhEnabledForTests(null);
    delete process.env.OPENBOT_EVOLUTION_SOFT_OBSERVE_DH;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("does not enable LIVE_INVOKE, Fabric default-on, or Phase D enforce", () => {
    const loop = readFileSync(LOOP_SRC, "utf8");
    const sched = readFileSync(SCHED_SRC, "utf8");
    for (const text of [loop, sched]) {
      expect(text).not.toMatch(/ORCHESTRATION_LIVE_INVOKE\s*=\s*['"]?(1|true|on)/i);
      expect(text).not.toMatch(/FABRIC_DEFAULT\s*=\s*['"]?(1|true|on)/i);
      expect(text).not.toMatch(/OPENBOT_PHASE_D_ENFORCE\s*=\s*['"]?(1|true|on)/i);
      expect(text).not.toMatch(/phaseDEnforce\s*=\s*true/i);
      expect(text).not.toMatch(/OPENBOT_FABRIC.*default.*on/i);
    }
    expect(loop).toMatch(/scope:\s*"canary"/);
    expect(SOFT_OBSERVE_DH_SURFACES.has("agent.working-dna")).toBe(true);
    expect(SOFT_OBSERVE_DH_SURFACES.has("system.runtime-binding-governance")).toBe(false);
  });

  it("defaults soft-observe DH enabled and can be turned off", () => {
    setSoftObserveDhEnabledForTests(null);
    delete process.env.OPENBOT_EVOLUTION_SOFT_OBSERVE_DH;
    expect(isSoftObserveDhEnabled()).toBe(true);
    process.env.OPENBOT_EVOLUTION_SOFT_OBSERVE_DH = "off";
    expect(isSoftObserveDhEnabled()).toBe(false);
  });

  it("skips system-domain proposals (never digital_human learned)", async () => {
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
    });
    plane.registerProposal(systemProposal());
    const classified = classifySoftObserveDhStep(plane, plane.getProposal("evo:system-skip")!);
    expect(classified.step).toBe("skip");
    expect(classified.reason).toBe("system_domain");
    const advanced = await advanceSoftObserveDhProposal(plane, "evo:system-skip");
    expect(advanced.step).toBe("skip");
    expect(plane.listApplications({ proposalId: "evo:system-skip" })).toHaveLength(0);
  });

  it("observe_hold on inconclusive — no promote / no verified_effective learned claim", async () => {
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
    });
    plane.ingestV1(
      {
        schemaVersion: 1,
        proposalId: "evo:dna-inconclusive",
        sourceFindingIds: ["f-inc"],
        sourceEvidenceRefs: ["ev-a"],
        tenantScope: TENANT,
        targetDomain: "agent_working_dna",
        proposedChange: { summary: "observe only" },
        expectedEffect: "raise success",
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        status: "APPROVED",
        approvalRequired: true,
        approverScope: "enterprise",
        grantId: "grant-1",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        auditReceipt: "aud:evo:dna-inconclusive",
        candidateRef: "cand:dna-inc",
      },
      { agentId: AGENT_ID },
    );
    plane.registerCandidate("cand:dna-inc", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:dna-inc",
    });
    const baselineStartMs = Date.now() - 90_000;
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      appendEvolutionTaskOutcome(
        cfg,
        {
          agentId: AGENT_ID,
          occurredAt: baselineStartMs + i * 2_000,
          succeeded: i % 2 === 0,
          runId: `run-inc-base-${i}`,
          tenantId: TENANT,
          cohortRef: COHORT,
          latencyMs: 40,
          toolsObserved: 0,
          humanTakeover: false,
        },
        { persistDir },
      );
    }
    const experiment = await plane.startExperiment({
      commandId: "exp-dna-inc",
      proposalId: "evo:dna-inconclusive",
      now: new Date(baselineStartMs + SAMPLE_SIZE * 2_000).toISOString(),
      freeze: {
        baselineVersion: DEFAULT_STYLE_VERSION,
        candidateVersion: "cand:dna-inc",
        codeSha: "sha-inc",
        modelRef: "model-inc",
        providerVersion: "provider-inc",
        configSnapshotRef: "cfg-inc",
        datasetOrCohortRef: COHORT,
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2099-01-01T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    expect(experiment.baselineCapture?.status).toBe("frozen");
    await plane.applyWorkingDna({
      commandId: "apply-inc-a",
      proposalId: "evo:dna-inconclusive",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    // No treatment outcomes → evaluate should stay inconclusive for soft hold
    // (sample/confidence), not invent promote / verified_effective.
    await plane.evaluateExperiment(experiment.experimentId);
    const result = plane.getExperiment(experiment.experimentId)?.result;
    expect(result === "inconclusive" || result === "neutral" || result === "regressed").toBe(true);

    const hold = classifySoftObserveDhStep(plane, plane.getProposal("evo:dna-inconclusive")!);
    // Pre-drill inconclusive from missing treatment should observe_hold or skip drill-path carefully.
    // If reasons were only rollback_drill_not_run, classify may offer drill — still must not promote.
    expect(hold.step).not.toBe("promote");

    for (let i = 0; i < 6; i += 1) {
      const stepped = await advanceSoftObserveDhProposal(plane, "evo:dna-inconclusive", {
        nowSalt: `inc-${i}`,
      });
      expect(stepped.step).not.toBe("promote");
      if (stepped.step === "observe_hold" || stepped.step === "skip") {
        break;
      }
    }
    expect(plane.getProposal("evo:dna-inconclusive")?.status).not.toBe("PROMOTED");

    const apps = plane.listApplications({ proposalId: "evo:dna-inconclusive" });
    const timeline = includedTimeline({
      proposal: plane.getProposal("evo:dna-inconclusive")!,
      events: plane.ledger.replay("evo:dna-inconclusive"),
      application: apps[0],
      verification: undefined,
    });
    expect(timeline.result).not.toBe("verified_effective");
    expect(timeline.audience).toBe("digital_human");

    const learned = queryEvolutionPerception(
      {
        events: plane.ledger.replay("evo:dna-inconclusive"),
        proposals: [plane.getProposal("evo:dna-inconclusive")!],
        applications: apps,
        verifications: [],
      },
      {
        intent: "learned_this_week",
        tenantScope: TENANT,
        window: { from: "2020-01-01T00:00:00.000Z", to: "2099-01-01T00:00:00.000Z" },
        permitted: true,
      },
    );
    if ("denied" in learned && learned.denied) {
      // ok
    } else if ("items" in learned) {
      expect(learned.items.every((item) => item.result === "verified_effective")).toBe(true);
      expect(learned.items).toHaveLength(0);
    }
  });

  it("self-runs soft canary Apply→Verify→Promote for Working DNA without LIVE_INVOKE", async () => {
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
        proposalId: "evo:dna-soft-obs",
        sourceFindingIds: ["f-soft"],
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
        auditReceipt: "aud:evo:dna-soft-obs",
        candidateRef: "cand:dna-soft",
      },
      { agentId: AGENT_ID },
    );
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)).toHaveLength(SAMPLE_SIZE);
    plane.registerCandidate("cand:dna-soft", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:dna-soft",
    });
    const experiment = await plane.startExperiment({
      commandId: "exp-dna-soft",
      proposalId: "evo:dna-soft-obs",
      now: new Date(baselineStartMs + SAMPLE_SIZE * 2_000).toISOString(),
      freeze: {
        baselineVersion: DEFAULT_STYLE_VERSION,
        candidateVersion: "cand:dna-soft",
        codeSha: "sha-soft",
        modelRef: "model-soft",
        providerVersion: "provider-soft",
        configSnapshotRef: "cfg-soft",
        datasetOrCohortRef: COHORT,
        tenantScope: TENANT,
        confidentialityScope: "enterprise",
        expiresAt: "2099-01-01T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    expect(experiment.baselineCapture?.status).toBe("frozen");

    let treatRound = 0;
    const steps: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const appsBefore = plane.listApplications({ proposalId: "evo:dna-soft-obs" });
      const applied = appsBefore.find((row) => row.status === "applied");
      if (applied) {
        treatRound += 1;
        for (let j = 0; j < SAMPLE_SIZE; j += 1) {
          await recordRunOutcome(cfg, AGENT_ID, {
            success: true,
            runId: `run-treat-${treatRound}-${j}`,
            tenantId: TENANT,
            latencyMs: 32,
            toolsTotal: 0,
            humanTakeover: false,
            occurredAt: Date.now(),
            evolutionPersistDir: persistDir,
          });
        }
      }
      const result = await advanceSoftObserveDhProposal(plane, "evo:dna-soft-obs", {
        nowSalt: `t${i}`,
      });
      steps.push(`${result.step}:${result.reason}`);
      if (result.step === "promote" || result.step === "skip" || result.step === "observe_hold") {
        break;
      }
    }
    expect(steps.some((s) => s.startsWith("apply_canary"))).toBe(true);
    expect(plane.getProposal("evo:dna-soft-obs")?.status).toBe("PROMOTED");
    expect(steps.at(-1)?.startsWith("promote")).toBe(true);

    const apps = plane.listApplications({ proposalId: "evo:dna-soft-obs" });
    expect(apps.some((row) => row.purpose === "promoted")).toBe(true);

    const verificationId = plane.getProposal("evo:dna-soft-obs")?.verificationId;
    expect(verificationId).toBeTruthy();
    const verification = plane.getVerification(verificationId!);
    expect(verification?.outcome).toBe("improved");

    const timeline = includedTimeline({
      proposal: plane.getProposal("evo:dna-soft-obs")!,
      events: plane.ledger.replay("evo:dna-soft-obs"),
      application: apps.find((row) => row.purpose === "promoted") ?? apps.at(-1),
      verification: verification ?? undefined,
    });
    expect(timeline.audience).toBe("digital_human");
    expect(timeline.result).toBe("verified_effective");

    const learned = queryEvolutionPerception(
      {
        events: plane.ledger.replay("evo:dna-soft-obs"),
        proposals: [plane.getProposal("evo:dna-soft-obs")!],
        applications: apps,
        verifications: verification ? [verification] : [],
      },
      {
        intent: "learned_this_week",
        tenantScope: TENANT,
        window: { from: "2020-01-01T00:00:00.000Z", to: "2099-01-01T00:00:00.000Z" },
        permitted: true,
      },
    );
    expect("items" in learned).toBe(true);
    if ("items" in learned) {
      expect(learned.items).toHaveLength(1);
      expect(learned.items[0]?.result).toBe("verified_effective");
      expect(learned.items[0]?.audience).toBe("digital_human");
    }

    const types = plane.ledger.replay("evo:dna-soft-obs").map((row) => row.type);
    const required: EvolutionLedgerEventType[] = [
      "experiment.started",
      "application.applied",
      "rollback_drill.completed",
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
  });

  it("tick no-ops when soft-observe DH is disabled", async () => {
    setSoftObserveDhEnabledForTests(false);
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT),
    });
    const tick = await runSoftObserveDhLoopTick(plane);
    expect(tick.enabled).toBe(false);
    expect(tick.advanced).toBe(0);
  });
});

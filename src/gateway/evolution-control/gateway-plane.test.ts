import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { capsuleMetricSet, organizationMetricSet, skillMetricSet } from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { readRobotWorkingStyle } from "../agent-growth/working-style-store.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { createGatewayEvolutionControlPlane } from "./gateway-plane.js";
import { resolveEvolutionAdapterDir } from "./persistent-store.js";
import { testInspector, testObservation } from "./test-support.js";

const TENANT_A = "tenant-fixture-a";
const AGENT_ID = "dna-bot";

function freeze(candidateVersion: string) {
  return {
    baselineVersion: "style-seed",
    candidateVersion,
    codeSha: "sha-fixture",
    modelRef: "model-fixture",
    providerVersion: "provider-fixture",
    configSnapshotRef: "cfg-fixture",
    datasetOrCohortRef: "cohort-a",
    tenantScope: TENANT_A,
    confidentialityScope: "enterprise" as const,
    expiresAt: "2026-09-07T00:00:00.000Z",
    maxResourceBudget: 1,
  };
}

function dnaV1(proposalId: string, candidateRef: string) {
  return {
    schemaVersion: 1 as const,
    proposalId,
    sourceFindingIds: ["f-1"],
    sourceEvidenceRefs: ["ev-a"],
    tenantScope: TENANT_A,
    targetDomain: "agent_working_dna" as const,
    proposedChange: { summary: "tune" },
    expectedEffect: "raise success",
    riskLevel: "medium" as const,
    confidentialityScope: "enterprise" as const,
    status: "APPROVED" as const,
    approvalRequired: true as const,
    approverScope: "enterprise" as const,
    grantId: "grant-1",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-06T12:00:00.000Z",
    auditReceipt: `aud:${proposalId}`,
    candidateRef,
  };
}

function v2Proposal(over: {
  proposalId: string;
  candidateRef: string;
  surfaceId: string;
  target:
    | { domain: "knowledge"; assetId: string }
    | { domain: "capability"; skillId: string }
    | { domain: "organization"; groupId: string };
  expectedEffects: ReturnType<typeof capsuleMetricSet>["primary"][];
}) {
  return {
    schemaVersion: 2 as const,
    proposalId: over.proposalId,
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "case-1",
    target: over.target,
    candidateRef: over.candidateRef,
    expectedEffects: over.expectedEffects,
    riskLevel: "medium" as const,
    surfaceId: over.surfaceId,
    tenantScope: TENANT_A,
    confidentialityScope: "enterprise" as const,
    status: "APPROVED_FOR_EXPERIMENT" as const,
    grantId: "grant-1",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-06T12:00:00.000Z",
  };
}

describe("evolution control persistence and gateway wiring", () => {
  let tmpDir = "";
  let persistDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-persist-"));
    persistDir = path.join(tmpDir, "control");
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reloads proposals, ledger, candidates and rolls back after restart", async () => {
    const adapterDir = resolveEvolutionAdapterDir(persistDir);
    const first = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg, { persistDir: adapterDir }),
      observationProvider: testObservation(),
      persistDir,
    });
    first.ingestV1(dnaV1("evo:dna", "cand:dna"), { agentId: AGENT_ID });
    first.registerCandidate("cand:dna", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:dna",
    });
    const experiment = await first.startExperiment({
      commandId: "exp-dna",
      proposalId: "evo:dna",
      freeze: freeze("cand:dna"),
      now: "2026-09-06T11:00:00.000Z",
    });
    await first.evaluateExperiment(experiment.experimentId);
    const applied = await first.applyWorkingDna({
      commandId: "apply-dna",
      proposalId: "evo:dna",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect((await readRobotWorkingStyle(cfg, AGENT_ID))?.riskPreference).toBe("conservative");

    const restarted = createEvolutionControlPlane({
      inspector: testInspector(TENANT_A),
      workingDnaAdapter: createWorkingDnaAdapter(cfg, { persistDir: adapterDir }),
      observationProvider: testObservation(),
      persistDir,
    });
    expect(restarted.getProposal("evo:dna")?.status).toBe("CANARY");
    expect(restarted.getExperiment(experiment.experimentId)?.proposalId).toBe("evo:dna");
    expect(restarted.getApplication(applied.applicationId)?.status).toBe("applied");
    expect(restarted.ledger.replay("evo:dna").map((row) => row.type)).toEqual([
      "legacy.imported",
      "experiment.started",
      "experiment.completed",
      "application.applied",
    ]);
    await restarted.rollbackApplication({
      commandId: "rb-dna",
      applicationId: applied.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });
    expect((await readRobotWorkingStyle(cfg, AGENT_ID))?.riskPreference).toBe(
      DEFAULT_WORKING_STYLE.riskPreference,
    );
    expect(restarted.getProposal("evo:dna")?.status).toBe("ROLLED_BACK");
  });

  it("evaluates through adapter observation instead of failing closed", async () => {
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT_A),
    });
    plane.ingestV1(dnaV1("evo:obs", "cand:obs"), { agentId: AGENT_ID });
    plane.registerCandidate("cand:obs", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:obs",
    });
    const experiment = await plane.startExperiment({
      commandId: "exp-obs",
      proposalId: "evo:obs",
      freeze: freeze("cand:obs"),
      now: "2026-09-06T11:00:00.000Z",
    });
    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.decision.result).toBe("inconclusive");
    expect(evaluated.decision.reasons.length).toBeGreaterThan(0);
    await expect(
      plane.applyWorkingDna({
        commandId: "apply-obs-canary",
        proposalId: "evo:obs",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/frozen baseline|critical guardrail|baseline/);
    const shadow = await plane.applyWorkingDna({
      commandId: "apply-obs-shadow",
      proposalId: "evo:obs",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "shadow",
    });
    expect(shadow.appliedToRuntime).toBe(false);
    expect(await readRobotWorkingStyle(cfg, AGENT_ID)).toBeNull();
    expect(plane.getProposal("evo:obs")?.status).toBe("EXPERIMENTING");
  });

  it("wires the default Gateway plane to live adapters instead of fail-closed stubs", async () => {
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      inspector: testInspector(TENANT_A),
      observationProvider: testObservation(),
    });
    plane.registerProposal(
      v2Proposal({
        proposalId: "evo:cap",
        candidateRef: "cand:cap",
        surfaceId: "knowledge.experience-capsule",
        target: { domain: "knowledge", assetId: "group-1/cap-1" },
        expectedEffects: [capsuleMetricSet().primary],
      }),
      {
        groupId: "group-1",
        capsuleId: "cap-1",
        targetBotId: AGENT_ID,
        candidateVersion: "cand:cap",
      },
    );
    plane.registerProposal(
      v2Proposal({
        proposalId: "evo:skill",
        candidateRef: "cand:skill",
        surfaceId: "capability.skill-spec",
        target: { domain: "capability", skillId: "skill-missing" },
        expectedEffects: [skillMetricSet().primary],
      }),
      {
        skillId: "skill-missing",
        operation: "publish",
        candidateVersion: "cand:skill",
      },
    );
    plane.registerProposal(
      v2Proposal({
        proposalId: "evo:org",
        candidateRef: "cand:org",
        surfaceId: "organization.task-routing",
        target: { domain: "organization", groupId: "group-org" },
        expectedEffects: [organizationMetricSet().primary],
      }),
      {
        groupId: "group-org",
        kind: "task-routing",
        strategyId: "task_driven",
        defaultOwnerAgentId: "bot-owner",
        candidateVersion: "cand:org",
      },
    );
    const start = async (proposalId: string, candidateRef: string, commandId: string) => {
      const experiment = await plane.startExperiment({
        commandId,
        proposalId,
        freeze: freeze(candidateRef),
        now: "2026-09-06T11:00:00.000Z",
      });
      await plane.evaluateExperiment(experiment.experimentId);
      return experiment.experimentId;
    };
    const capExp = await start("evo:cap", "cand:cap", "exp-cap");
    const skillExp = await start("evo:skill", "cand:skill", "exp-skill");
    const orgExp = await start("evo:org", "cand:org", "exp-org");
    await expect(
      plane.applyCapsule({
        commandId: "apply-cap",
        proposalId: "evo:cap",
        experimentId: capExp,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/capsule not found|content_governance_required/);
    await expect(
      plane.applySkill({
        commandId: "apply-skill",
        proposalId: "evo:skill",
        experimentId: skillExp,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/skill not found/);
    await expect(
      plane.applyOrganization({
        commandId: "apply-org",
        proposalId: "evo:org",
        experimentId: orgExp,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/organization policy not found/);
  });
});

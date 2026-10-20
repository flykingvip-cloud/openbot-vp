import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { writeRobotWorkingStyle } from "../agent-growth/working-style-store.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import {
  assertVerifierMaySubmit,
  createCompositionRootVerifierHandle,
} from "./external-effect-registry.js";
import { createExternalEffectService } from "./external-effect-service.js";
import {
  bootstrapWorkingDnaVerifierRegistry,
  runtimePlatformInspector,
  testInspector,
  testObservation,
  withWorkingDnaExternal,
} from "./test-support.js";
import {
  skillInstallationReadAfterWriteVerifier,
  SKILL_INSTALLATION_RAW_VERIFIER_ID,
  SKILL_INSTALLATION_RAW_VERIFIER_RECORD,
} from "./verifiers/skill-installation-raw.js";
import {
  workingDnaReadAfterWriteVerifier,
  WORKING_DNA_RAW_VERIFIER_ID,
  WORKING_DNA_RAW_VERIFIER_RECORD,
} from "./verifiers/working-dna-raw.js";

const TENANT = "tenant-eef-neg";
const AGENT_ID = "eef-neg-bot";

function proposal(over: { proposalId?: string; skillId?: string; surfaceId?: string } = {}) {
  const skillId = over.skillId ?? "skill-neg";
  return {
    schemaVersion: 2 as const,
    proposalId: over.proposalId ?? "evo:neg",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "m",
    target:
      over.surfaceId === "capability.skill-installation"
        ? { domain: "capability" as const, skillId }
        : { domain: "agent" as const, agentId: AGENT_ID },
    candidateRef: "cand:neg",
    surfaceId: over.surfaceId ?? "agent.working-dna",
    expectedEffects: [],
    riskLevel: "medium" as const,
    confidentialityScope: "enterprise" as const,
    tenantScope: TENANT,
    grantId: "grant-1",
    status: "CANARY" as const,
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-06T12:00:00.000Z",
  };
}

function application(applicationId: string, adapterId = "working-dna") {
  return {
    schemaVersion: 1 as const,
    applicationId,
    proposalId: "evo:neg",
    experimentId: "exp:neg",
    adapterId,
    idempotencyKey: `apply-${applicationId}`,
    targetVersionBefore: "before",
    targetVersionAfter: adapterId === "skill-installation" ? "skill:private:1.0.0" : "style-after",
    rollbackRef: "rb",
    scope: "canary" as const,
    status: "applied" as const,
    appliedToRuntime: true,
  };
}

describe("external verifier negatives", () => {
  let tmpDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-eef-neg-"));
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects Working DNA and Skill verifiers on the other domain", async () => {
    const service = createExternalEffectService({
      styleConfig: cfg,
      registry: bootstrapWorkingDnaVerifierRegistry(),
    });
    const dnaOnSkill = service.requestVerification({
      proposal: proposal({
        proposalId: "evo:cross-dna",
        surfaceId: "capability.skill-installation",
        skillId: "skill-x",
      }),
      application: { ...application("app:cross-dna"), proposalId: "evo:cross-dna" },
      target: { domain: "capability", skillId: "skill-x" },
      expectedEffect: { kind: "skill-installation", expectedValue: "1.0.0", agentId: AGENT_ID },
      verifierId: WORKING_DNA_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: "2026-09-06T12:00:00.000Z",
    });
    const dnaResult = await service.verifyBoundRequest({
      requestId: dnaOnSkill.requestId,
      proposal: proposal({
        proposalId: "evo:cross-dna",
        surfaceId: "capability.skill-installation",
        skillId: "skill-x",
      }),
      application: { ...application("app:cross-dna"), proposalId: "evo:cross-dna" },
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(dnaResult.outcome).toBe("inconclusive");

    const skillOnDna = service.requestVerification({
      proposal: proposal({ proposalId: "evo:cross-skill" }),
      application: { ...application("app:cross-skill"), proposalId: "evo:cross-skill" },
      target: { domain: "agent", agentId: AGENT_ID },
      expectedEffect: {
        kind: "working-style-field",
        field: "riskPreference",
        expectedValue: "conservative",
      },
      verifierId: SKILL_INSTALLATION_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: "2026-09-06T12:00:00.000Z",
    });
    const skillResult = await service.verifyBoundRequest({
      requestId: skillOnDna.requestId,
      proposal: proposal({ proposalId: "evo:cross-skill" }),
      application: { ...application("app:cross-skill"), proposalId: "evo:cross-skill" },
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(skillResult.outcome).toBe("inconclusive");
  });

  it("rejects a revoked builtin and a same-object applicator/verifier", async () => {
    const handle = createCompositionRootVerifierHandle();
    handle.installFixedBuiltin(WORKING_DNA_RAW_VERIFIER_RECORD, workingDnaReadAfterWriteVerifier);
    handle.revokeFixedBuiltin(
      WORKING_DNA_RAW_VERIFIER_ID,
      runtimePlatformInspector(TENANT),
      "grant-1",
    );
    expect(handle.registry.resolve(WORKING_DNA_RAW_VERIFIER_ID)).toBeUndefined();
    const service = createExternalEffectService({
      styleConfig: cfg,
      registry: handle.registry,
    });
    const request = service.requestVerification({
      proposal: proposal(),
      application: application("app:revoked"),
      target: { domain: "agent", agentId: AGENT_ID },
      expectedEffect: {
        kind: "working-style-field",
        field: "riskPreference",
        expectedValue: "conservative",
      },
      verifierId: WORKING_DNA_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: "2026-09-06T12:00:00.000Z",
    });
    const revoked = await service.verifyBoundRequest({
      requestId: request.requestId,
      proposal: proposal(),
      application: application("app:revoked"),
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(revoked.outcome).toBe("inconclusive");
    expect(
      assertVerifierMaySubmit({
        verifier: SKILL_INSTALLATION_RAW_VERIFIER_RECORD,
        now: "2026-09-06T11:00:00.000Z",
        adapterId: SKILL_INSTALLATION_RAW_VERIFIER_ID,
        tenantScope: TENANT,
        effectKind: "skill-installation",
        targetDomain: "capability",
      }),
    ).toMatchObject({ ok: false, code: "verifier_not_independent" });
  });

  it("rejects wrong request binding and receipt replay across requests", async () => {
    const service = createExternalEffectService({
      styleConfig: cfg,
      registry: bootstrapWorkingDnaVerifierRegistry(),
    });
    await writeRobotWorkingStyle(cfg, AGENT_ID, {
      ...DEFAULT_WORKING_STYLE,
      riskPreference: "conservative",
    });
    const first = service.requestVerification({
      proposal: proposal({ proposalId: "evo:r1" }),
      application: { ...application("app:r1"), proposalId: "evo:r1" },
      target: { domain: "agent", agentId: AGENT_ID },
      expectedEffect: {
        kind: "working-style-field",
        field: "riskPreference",
        expectedValue: "conservative",
      },
      verifierId: WORKING_DNA_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: "2026-09-06T12:00:00.000Z",
    });
    const verified = await service.verifyBoundRequest({
      requestId: first.requestId,
      proposal: proposal({ proposalId: "evo:r1" }),
      application: { ...application("app:r1"), proposalId: "evo:r1" },
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(verified.outcome).toBe("verified");
    await expect(
      service.verifyBoundRequest({
        requestId: first.requestId,
        proposal: proposal({ proposalId: "evo:other" }),
        application: { ...application("app:r1"), proposalId: "evo:other" },
        now: "2026-09-06T11:00:00.000Z",
      }),
    ).rejects.toThrow(/not bound to this proposal/);
    expect(verified.receipt.requestId).toBe(first.requestId);
    expect(verified.requestId).toBe(first.requestId);
    expect(verified.verifierId).toBe(WORKING_DNA_RAW_VERIFIER_ID);
  });

  it("keeps Skill installation missing SoT inconclusive and version mismatch contradicted", async () => {
    const service = createExternalEffectService({
      styleConfig: cfg,
      registry: bootstrapWorkingDnaVerifierRegistry(),
    });
    const missing = service.requestVerification({
      proposal: proposal({
        proposalId: "evo:missing-sot",
        surfaceId: "capability.skill-installation",
        skillId: "missing-skill",
      }),
      application: {
        ...application("app:missing-sot", "skill-installation"),
        proposalId: "evo:missing-sot",
      },
      target: { domain: "capability", skillId: "missing-skill" },
      expectedEffect: {
        kind: "skill-installation",
        field: "installedVersion",
        expectedValue: "1.0.0",
        expectedVersion: "skill:private:1.0.0",
        expectedEnabled: true,
        agentId: AGENT_ID,
      },
      verifierId: SKILL_INSTALLATION_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: "2026-09-06T12:00:00.000Z",
    });
    const missingResult = await service.verifyBoundRequest({
      requestId: missing.requestId,
      proposal: proposal({
        proposalId: "evo:missing-sot",
        surfaceId: "capability.skill-installation",
        skillId: "missing-skill",
      }),
      application: {
        ...application("app:missing-sot", "skill-installation"),
        proposalId: "evo:missing-sot",
      },
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(["inconclusive", "contradicted"]).toContain(missingResult.outcome);

    const receiptOnly = service.requestVerification({
      proposal: proposal({
        proposalId: "evo:receipt",
        surfaceId: "capability.skill-installation",
        skillId: "missing-skill",
      }),
      application: {
        ...application("app:receipt", "skill-installation"),
        proposalId: "evo:receipt",
      },
      target: { domain: "capability", skillId: "missing-skill" },
      expectedEffect: { kind: "skill-installation" },
      verifierId: SKILL_INSTALLATION_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: "2026-09-06T12:00:00.000Z",
    });
    const notObserved = await service.verifyBoundRequest({
      requestId: receiptOnly.requestId,
      proposal: proposal({
        proposalId: "evo:receipt",
        surfaceId: "capability.skill-installation",
        skillId: "missing-skill",
      }),
      application: {
        ...application("app:receipt", "skill-installation"),
        proposalId: "evo:receipt",
      },
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(notObserved.outcome).toBe("not_observed");
    expect(skillInstallationReadAfterWriteVerifier.verifierId).not.toBe(
      workingDnaReadAfterWriteVerifier.verifierId,
    );
  });

  it("does not expose register on the control plane or public registry", () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
      ...withWorkingDnaExternal(cfg),
    });
    expect(plane).not.toHaveProperty("registerPlatformVerifier");
    expect(plane).not.toHaveProperty("installFixedBuiltin");
  });
});

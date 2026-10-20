import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { writeRobotWorkingStyle } from "../agent-growth/working-style-store.js";
import {
  evaluatePromoteGateFromPersistedAudit,
  readEffectVerificationAudits,
  writeEffectVerificationAudit,
} from "./effect-verification-audit.js";
import {
  listEvolutionLoopLogsForTests,
  resetEvolutionLoopLogsForTests,
} from "./evolution-loop-log.js";
import { createExternalEffectService } from "./external-effect-service.js";
import { bootstrapWorkingDnaVerifierRegistry } from "./test-support.js";
import { WORKING_DNA_RAW_VERIFIER_ID } from "./verifiers/working-dna-raw.js";

const TENANT = "tenant-eef-audit";
const AGENT_ID = "eef-audit-bot";

function boundProposal(over: { proposalId?: string; agentId?: string; surfaceId?: string } = {}) {
  return {
    schemaVersion: 2 as const,
    proposalId: over.proposalId ?? "evo:eef-audit",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "m",
    target: { domain: "agent" as const, agentId: over.agentId ?? AGENT_ID },
    candidateRef: "cand:eef-audit",
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

function boundApplication(applicationId: string) {
  return {
    schemaVersion: 1 as const,
    applicationId,
    proposalId: "evo:eef-audit",
    experimentId: "exp:eef-audit",
    adapterId: "working-dna",
    idempotencyKey: `apply-${applicationId}`,
    targetVersionBefore: "style-before",
    targetVersionAfter: "style-after",
    rollbackRef: "rb",
    scope: "canary" as const,
    status: "applied" as const,
    appliedToRuntime: true,
  };
}

describe("effect verification audit and RAW verifier", () => {
  let tmpDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-eef-audit-"));
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
    resetEvolutionLoopLogsForTests();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    resetEvolutionLoopLogsForTests();
  });

  it("records read-after-write success from the external working-style store", async () => {
    await writeRobotWorkingStyle(cfg, AGENT_ID, {
      ...DEFAULT_WORKING_STYLE,
      riskPreference: "conservative",
    });
    const persistDir = path.join(tmpDir, "control");
    const service = createExternalEffectService({
      persistDir,
      styleConfig: cfg,
      registry: bootstrapWorkingDnaVerifierRegistry(),
    });
    const proposal = boundProposal();
    const application = boundApplication("app:raw-ok");
    const request = service.requestVerification({
      proposal,
      application,
      target: proposal.target,
      expectedEffect: {
        kind: "working-style-field",
        field: "riskPreference",
        expectedValue: "conservative",
      },
      verifierId: WORKING_DNA_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: proposal.expiresAt,
    });
    const verified = await service.verifyBoundRequest({
      requestId: request.requestId,
      proposal,
      application,
      now: "2026-09-06T11:00:00.000Z",
      runId: "run-raw-ok",
    });
    expect(verified.outcome).toBe("verified");
    expect(verified.observationReceiptRef.startsWith("raw-verified:")).toBe(true);
    const audit = readEffectVerificationAudits(persistDir);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      runId: "run-raw-ok",
      surfaceId: "agent.working-dna",
      beforeState: "style-before",
      result: "verified",
    });
    expect(audit[0]?.afterState).toEqual(
      expect.objectContaining({
        version: expect.any(String),
        hash: expect.any(String),
      }),
    );
  });

  it("contradicts when the external store does not match the expected field", async () => {
    await writeRobotWorkingStyle(cfg, AGENT_ID, {
      ...DEFAULT_WORKING_STYLE,
      riskPreference: "aggressive",
    });
    const persistDir = path.join(tmpDir, "control");
    const service = createExternalEffectService({
      persistDir,
      styleConfig: cfg,
      registry: bootstrapWorkingDnaVerifierRegistry(),
    });
    const proposal = boundProposal({ proposalId: "evo:mismatch" });
    const application = { ...boundApplication("app:mismatch"), proposalId: "evo:mismatch" };
    const request = service.requestVerification({
      proposal,
      application,
      target: proposal.target,
      expectedEffect: {
        kind: "working-style-field",
        field: "riskPreference",
        expectedValue: "conservative",
      },
      verifierId: WORKING_DNA_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: proposal.expiresAt,
    });
    const contradicted = await service.verifyBoundRequest({
      requestId: request.requestId,
      proposal,
      application,
      now: "2026-09-06T11:00:00.000Z",
      runId: "run-mismatch",
    });
    expect(contradicted.outcome).toBe("contradicted");
    expect(readEffectVerificationAudits(persistDir)[0]?.result).toBe("contradicted");
  });

  it("returns unavailable when the external store cannot be read", async () => {
    const persistDir = path.join(tmpDir, "control");
    const missingCfg = {
      agents: { list: [{ id: "missing-bot", agentDir: path.join(tmpDir, "missing") }] },
    } as unknown as OpenBotConfig;
    const service = createExternalEffectService({
      persistDir,
      styleConfig: missingCfg,
      registry: bootstrapWorkingDnaVerifierRegistry(),
    });
    const proposal = boundProposal({ proposalId: "evo:missing", agentId: "missing-bot" });
    const application = { ...boundApplication("app:missing"), proposalId: "evo:missing" };
    const request = service.requestVerification({
      proposal,
      application,
      target: proposal.target,
      expectedEffect: {
        kind: "working-style-field",
        field: "riskPreference",
        expectedValue: "conservative",
      },
      verifierId: WORKING_DNA_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: proposal.expiresAt,
    });
    const inconclusive = await service.verifyBoundRequest({
      requestId: request.requestId,
      proposal,
      application,
      now: "2026-09-06T11:00:00.000Z",
      runId: "run-missing",
    });
    expect(inconclusive.outcome).toBe("inconclusive");
    expect(readEffectVerificationAudits(persistDir)[0]).toMatchObject({
      result: "unavailable",
      outcome: "unavailable",
    });
    expect(
      listEvolutionLoopLogsForTests().some(
        (row) => row.event === "evolution.effect_verification.unavailable",
      ),
    ).toBe(true);
  });

  it("times out a hanging external read and stays unavailable", async () => {
    const persistDir = path.join(tmpDir, "control");
    const service = createExternalEffectService({
      persistDir,
      registry: bootstrapWorkingDnaVerifierRegistry(),
      verifyTimeoutMs: 30,
      domainReader: {
        readWorkingStyle: () => new Promise(() => {}),
      },
    });
    const proposal = boundProposal({ proposalId: "evo:timeout" });
    const application = { ...boundApplication("app:timeout"), proposalId: "evo:timeout" };
    const request = service.requestVerification({
      proposal,
      application,
      target: proposal.target,
      expectedEffect: {
        kind: "working-style-field",
        field: "riskPreference",
        expectedValue: "conservative",
      },
      verifierId: WORKING_DNA_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: proposal.expiresAt,
    });
    const timedOut = await service.verifyBoundRequest({
      requestId: request.requestId,
      proposal,
      application,
      now: "2026-09-06T11:00:00.000Z",
      runId: "run-timeout",
    });
    expect(timedOut.outcome).toBe("inconclusive");
    expect(timedOut.observationReceiptRef).toContain("verifier-timeout");
    expect(readEffectVerificationAudits(persistDir)[0]?.reason).toBe("verifier-timeout");
  });

  it("promotes only from a persisted RAW verified audit and fail-closes otherwise", () => {
    const persistDir = path.join(tmpDir, "control-gate");
    const missing = evaluatePromoteGateFromPersistedAudit({
      runId: "run-missing",
      agentId: AGENT_ID,
      tenantId: TENANT,
      surfaceId: "agent.working-dna",
      persistDir,
    });
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe("not_verified");

    writeEffectVerificationAudit({
      runId: "run-raw",
      agentId: AGENT_ID,
      tenantId: TENANT,
      surfaceId: "agent.working-dna",
      target: { domain: "agent", agentId: AGENT_ID },
      outcome: "verified",
      verifierVersion: WORKING_DNA_RAW_VERIFIER_ID,
      reason: "raw-verified:fixture",
      persistDir,
    });
    const accepted = evaluatePromoteGateFromPersistedAudit({
      runId: "run-raw",
      agentId: AGENT_ID,
      tenantId: TENANT,
      surfaceId: "agent.working-dna",
      persistDir,
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.verificationId).toBe("ver:raw:run-raw");
  });
});

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
  createVerifierRegistry,
} from "./external-effect-registry.js";
import { createExternalEffectService } from "./external-effect-service.js";
import {
  bootstrapWorkingDnaVerifierRegistry,
  testInspector,
  testObservation,
  withWorkingDnaExternal,
} from "./test-support.js";
import {
  workingDnaReadAfterWriteVerifier,
  WORKING_DNA_RAW_VERIFIER_ID,
  WORKING_DNA_RAW_VERIFIER_RECORD,
} from "./verifiers/working-dna-raw.js";

const TENANT = "tenant-eef";
const AGENT_ID = "eef-bot";

function freeze() {
  return {
    baselineVersion: `style:${DEFAULT_WORKING_STYLE.outputFormat}:${DEFAULT_WORKING_STYLE.reportingCadence}:${DEFAULT_WORKING_STYLE.decisionPreference}:${DEFAULT_WORKING_STYLE.riskPreference}:${DEFAULT_WORKING_STYLE.communicationTone}`,
    candidateVersion: "cand:eef",
    codeSha: "sha",
    modelRef: "model",
    providerVersion: "provider",
    configSnapshotRef: "cfg",
    datasetOrCohortRef: "cohort",
    tenantScope: TENANT,
    confidentialityScope: "enterprise" as const,
    expiresAt: "2026-09-07T00:00:00.000Z",
    maxResourceBudget: 1,
  };
}

function v1() {
  return {
    schemaVersion: 1 as const,
    proposalId: "evo:eef",
    sourceFindingIds: ["f-1"],
    sourceEvidenceRefs: ["ev-a"],
    tenantScope: TENANT,
    targetDomain: "agent_working_dna" as const,
    proposedChange: { summary: "tune dna" },
    expectedEffect: "raise success",
    riskLevel: "medium" as const,
    confidentialityScope: "enterprise" as const,
    status: "APPROVED" as const,
    approvalRequired: true as const,
    approverScope: "enterprise" as const,
    grantId: "grant-1",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    auditReceipt: "aud:evo:eef",
    candidateRef: "cand:eef",
  };
}

function boundProposal(over: { proposalId?: string; agentId?: string } = {}) {
  return {
    schemaVersion: 2 as const,
    proposalId: over.proposalId ?? "evo:eef",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "m",
    target: { domain: "agent" as const, agentId: over.agentId ?? AGENT_ID },
    candidateRef: "cand:eef",
    surfaceId: "agent.working-dna",
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
    proposalId: "evo:eef",
    experimentId: "exp:eef",
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

describe("external effect verifier registry and RAW verifier", () => {
  let tmpDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-eef-"));
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("fails closed when the registry is empty", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
      styleConfig: cfg,
    });
    plane.ingestV1(v1(), { agentId: AGENT_ID });
    plane.registerCandidate("cand:eef", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:eef",
    });
    const experiment = await plane.startExperiment({
      commandId: "exp-empty",
      proposalId: "evo:eef",
      freeze: freeze(),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(experiment.experimentId);
    const applied = await plane.applyWorkingDna({
      commandId: "apply-empty",
      proposalId: "evo:eef",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    await plane.verifyApplication({
      commandId: "ver-empty",
      applicationId: applied.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(plane.getExternalEffectResult(applied.applicationId)?.outcome).toBe("inconclusive");
    expect(plane.getProposal("evo:eef")?.status).not.toBe("VERIFIED");
    expect(() =>
      plane.promoteProposal({
        commandId: "promo-empty",
        proposalId: "evo:eef",
        principalRef: "ent-admin",
        trustedTenantId: TENANT,
      }),
    ).toThrow(/not VERIFIED|OUTCOME_VERIFIED|external effect/i);
  });

  it("rejects caller self-registration, forged platform authority, and plaintext tokens", () => {
    const registry = createVerifierRegistry();
    expect(registry).not.toHaveProperty("register");
    expect(registry).not.toHaveProperty("installFixedBuiltin");
    expect(typeof (registry as { registerWithInspector?: unknown }).registerWithInspector).toBe(
      "undefined",
    );
    const handle = createCompositionRootVerifierHandle();
    handle.installFixedBuiltin(WORKING_DNA_RAW_VERIFIER_RECORD, workingDnaReadAfterWriteVerifier);
    for (const status of ["EXPIRED", "REVOKED", "CONSUMED", "SUSPENDED", "REQUESTED", "DENIED"]) {
      expect(() =>
        handle.revokeFixedBuiltin(
          WORKING_DNA_RAW_VERIFIER_ID,
          testInspector(TENANT, {
            status,
            confidentialityCeiling: "platform",
            allowedActions: ["platform"],
          }),
          "grant-1",
        ),
      ).toThrow(/grant_expired|grant_revoked|grant_inactive|grant_inactive/);
    }
    const service = createExternalEffectService();
    expect(() =>
      service.submitResult({
        request: {
          requestId: "missing",
          proposalId: "p",
          experimentId: "e",
          applicationId: "a",
          target: { domain: "agent", agentId: AGENT_ID },
          expectedEffect: { kind: "working-style-field" },
          applicationReceiptRef: "app:a",
          tenantScope: TENANT,
          verifierId: WORKING_DNA_RAW_VERIFIER_ID,
          evidenceRefs: [],
          expiresAt: "2026-09-06T12:00:00.000Z",
        },
        result: {
          requestId: "missing",
          outcome: "verified",
          observedAt: "2026-09-06T11:00:00.000Z",
          verifierId: WORKING_DNA_RAW_VERIFIER_ID,
          evidenceRefs: [],
          observationReceiptRef: "token",
        },
        token: "plaintext-token",
      }),
    ).toThrow(/only be produced by verifyBoundRequest/);
  });

  it("rejects expired and revoked verifiers", () => {
    const expired = assertVerifierMaySubmit({
      verifier: {
        ...WORKING_DNA_RAW_VERIFIER_RECORD,
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
      now: "2026-09-06T11:00:00.000Z",
      adapterId: "working-dna",
      tenantScope: TENANT,
      effectKind: "working-style-field",
      targetDomain: "agent",
    });
    expect(expired).toMatchObject({ ok: false, code: "verifier_expired" });
    const revoked = assertVerifierMaySubmit({
      verifier: { ...WORKING_DNA_RAW_VERIFIER_RECORD, status: "revoked" },
      now: "2026-09-06T11:00:00.000Z",
      adapterId: "working-dna",
      tenantScope: TENANT,
      effectKind: "working-style-field",
      targetDomain: "agent",
    });
    expect(revoked).toMatchObject({ ok: false, code: "verifier_revoked" });
  });

  it("rejects applicator=verifier and does not expose control-plane registration", () => {
    const sameComponent = assertVerifierMaySubmit({
      verifier: WORKING_DNA_RAW_VERIFIER_RECORD,
      now: "2026-09-06T11:00:00.000Z",
      adapterId: WORKING_DNA_RAW_VERIFIER_ID,
      tenantScope: TENANT,
      effectKind: "working-style-field",
      targetDomain: "agent",
    });
    expect(sameComponent).toMatchObject({ ok: false, code: "verifier_not_independent" });
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
      ...withWorkingDnaExternal(cfg),
    });
    expect(plane).not.toHaveProperty("registerPlatformVerifier");
    const handle = createCompositionRootVerifierHandle();
    expect(() =>
      handle.installFixedBuiltin(
        {
          ...WORKING_DNA_RAW_VERIFIER_RECORD,
          credentialRef: "key-ref:platform/working-dna-raw",
          trustedBy: undefined,
        },
        workingDnaReadAfterWriteVerifier,
      ),
    ).toThrow(/code-fixed builtin|code identity/);
    expect(() =>
      handle.installFixedBuiltin(
        {
          ...WORKING_DNA_RAW_VERIFIER_RECORD,
          verifierId: "forged-verifier",
        },
        workingDnaReadAfterWriteVerifier,
      ),
    ).toThrow(/code-fixed builtin/);
  });

  it("treats a receipt-only expected effect as not_observed and a mismatch as contradicted", async () => {
    const service = createExternalEffectService({
      styleConfig: cfg,
      registry: bootstrapWorkingDnaVerifierRegistry(),
    });
    const proposal = boundProposal();
    const application = boundApplication("app:eef");
    const receiptOnly = service.requestVerification({
      proposal,
      application,
      target: proposal.target,
      expectedEffect: { kind: "working-style-field" },
      verifierId: WORKING_DNA_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: proposal.expiresAt,
    });
    await writeRobotWorkingStyle(cfg, AGENT_ID, {
      ...DEFAULT_WORKING_STYLE,
      riskPreference: "aggressive",
    });
    const notObserved = await service.verifyBoundRequest({
      requestId: receiptOnly.requestId,
      proposal,
      application,
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(notObserved.outcome).toBe("not_observed");

    const mismatchReq = service.requestVerification({
      proposal: { ...proposal, proposalId: "evo:eef-2" },
      application: { ...application, applicationId: "app:eef-2" },
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
      requestId: mismatchReq.requestId,
      proposal: { ...proposal, proposalId: "evo:eef-2" },
      application: { ...application, applicationId: "app:eef-2" },
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(contradicted.outcome).toBe("contradicted");

    const missingCfg = {
      agents: { list: [{ id: "missing-bot", agentDir: path.join(tmpDir, "missing") }] },
    } as unknown as OpenBotConfig;
    const missingService = createExternalEffectService({
      styleConfig: missingCfg,
      registry: bootstrapWorkingDnaVerifierRegistry(),
    });
    const missing = missingService.requestVerification({
      proposal: {
        ...proposal,
        proposalId: "evo:missing",
        target: { domain: "agent", agentId: "missing-bot" },
      },
      application: { ...application, applicationId: "app:missing" },
      target: { domain: "agent", agentId: "missing-bot" },
      expectedEffect: {
        kind: "working-style-field",
        field: "riskPreference",
        expectedValue: "conservative",
      },
      verifierId: WORKING_DNA_RAW_VERIFIER_ID,
      now: "2026-09-06T11:00:00.000Z",
      expiresAt: proposal.expiresAt,
    });
    const inconclusive = await missingService.verifyBoundRequest({
      requestId: missing.requestId,
      proposal: {
        ...proposal,
        proposalId: "evo:missing",
        target: { domain: "agent", agentId: "missing-bot" },
      },
      application: { ...application, applicationId: "app:missing" },
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(inconclusive.outcome).toBe("inconclusive");
  });

  it("keeps duplicate verifyBoundRequest results idempotent and does not overwrite conflicts", async () => {
    const service = createExternalEffectService({
      styleConfig: cfg,
      registry: bootstrapWorkingDnaVerifierRegistry(),
    });
    const proposal = boundProposal({ proposalId: "evo:dup" });
    const application = {
      ...boundApplication("app:dup"),
      proposalId: "evo:dup",
      experimentId: "exp:dup",
    };
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
      expiresAt: "2026-09-06T12:00:00.000Z",
    });
    await writeRobotWorkingStyle(cfg, AGENT_ID, {
      ...DEFAULT_WORKING_STYLE,
      riskPreference: "conservative",
    });
    const first = await service.verifyBoundRequest({
      requestId: request.requestId,
      proposal,
      application,
      now: "2026-09-06T11:00:00.000Z",
    });
    expect(first.outcome).toBe("verified");
    const duplicate = await service.verifyBoundRequest({
      requestId: request.requestId,
      proposal,
      application,
      now: "2026-09-06T11:01:00.000Z",
    });
    expect(duplicate).toEqual(first);
    await writeRobotWorkingStyle(cfg, AGENT_ID, {
      ...DEFAULT_WORKING_STYLE,
      riskPreference: "aggressive",
    });
    const conflict = await service.verifyBoundRequest({
      requestId: request.requestId,
      proposal,
      application,
      now: "2026-09-06T11:02:00.000Z",
    });
    expect(conflict.outcome).toBe("verified");
    expect(service.getResultForApplication("app:dup")?.outcome).toBe("verified");
    expect(service.listConflicts()).toHaveLength(1);
    expect(service.listConflicts()[0]?.outcome).toBe("contradicted");
    expect(() =>
      service.submitResult({
        request,
        result: { ...first, outcome: "verified" },
      }),
    ).toThrow(/only be produced by verifyBoundRequest/);
  });

  it("ignores injected registry JSON and replaced builtin identity", async () => {
    const persistPath = path.join(tmpDir, "verifier-registry.json");
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(
      persistPath,
      `${JSON.stringify({
        "forged-platform-verifier": {
          verifierId: "forged-platform-verifier",
          verifierKind: "external",
          supportedTargetDomains: ["agent"],
          supportedEffectKinds: ["working-style-field"],
          tenantScope: null,
          credentialRef: "key-ref:forged",
          status: "active",
          expiresAt: "2099-01-01T00:00:00.000Z",
          independentFromAdapterIds: ["working-dna"],
          authorityGrantRef: "key-ref:forged",
        },
        [WORKING_DNA_RAW_VERIFIER_ID]: {
          ...WORKING_DNA_RAW_VERIFIER_RECORD,
          credentialRef: "key-ref:tampered",
          trustedBy: "code-identity",
          status: "active",
        },
      })}\n`,
    );
    const registry = createVerifierRegistry(persistPath);
    expect(registry.get("forged-platform-verifier")).toBeUndefined();
    expect(registry.get(WORKING_DNA_RAW_VERIFIER_ID)).toBeUndefined();
    expect(registry.resolve("forged-platform-verifier")).toBeUndefined();
    expect(registry.resolve(WORKING_DNA_RAW_VERIFIER_ID)).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });

  it("does not mark VERIFIED when statistics improve but the external effect is contradicted", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
      ...withWorkingDnaExternal(cfg),
    });
    plane.ingestV1(v1(), { agentId: AGENT_ID });
    plane.registerCandidate("cand:eef", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:eef",
    });
    const experiment = await plane.startExperiment({
      commandId: "exp-contradicted",
      proposalId: "evo:eef",
      freeze: freeze(),
      now: "2026-09-06T11:00:00.000Z",
    });
    await plane.evaluateExperiment(experiment.experimentId);
    const applied = await plane.applyWorkingDna({
      commandId: "apply-contradicted",
      proposalId: "evo:eef",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    await writeRobotWorkingStyle(cfg, AGENT_ID, {
      ...DEFAULT_WORKING_STYLE,
      riskPreference: "aggressive",
    });
    await plane.verifyApplication({
      commandId: "ver-contradicted",
      applicationId: applied.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
    });
    expect(plane.getExternalEffectResult(applied.applicationId)?.outcome).toBe("contradicted");
    expect(plane.getProposal("evo:eef")?.status).not.toBe("VERIFIED");
  });

  it("does not fall back to the Working DNA verifier for unsupported surfaces", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
      ...withWorkingDnaExternal(cfg),
    });
    plane.registerProposal({
      schemaVersion: 2,
      proposalId: "evo:skill-spec",
      sourceEvidenceRefs: ["ev-a"],
      sourceMechanismRef: "m",
      target: { domain: "capability", skillId: "skill-spec-1" },
      candidateRef: "cand:skill-spec",
      surfaceId: "capability.skill-spec",
      expectedEffects: [],
      riskLevel: "medium",
      confidentialityScope: "enterprise",
      tenantScope: TENANT,
      grantId: "grant-1",
      status: "APPROVED_FOR_EXPERIMENT",
      createdAt: "2026-09-06T10:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(plane.getExternalEffectResult("missing")).toBeUndefined();
  });

  it("does not promote from EFFECT_VERIFIED alone", async () => {
    const plane = createEvolutionControlPlane({
      inspector: testInspector(TENANT),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
      ...withWorkingDnaExternal(cfg),
    });
    plane.ingestV1(v1(), { agentId: AGENT_ID });
    plane.registerCandidate("cand:eef", {
      agentId: AGENT_ID,
      delta: { riskPreference: "conservative" },
      baselineStyle: DEFAULT_WORKING_STYLE,
      candidateVersion: "cand:eef",
    });
    const experiment = await plane.startExperiment({
      commandId: "exp-effect",
      proposalId: "evo:eef",
      freeze: freeze(),
      now: "2026-09-06T11:00:00.000Z",
    });
    const applied = await plane.applyWorkingDna({
      commandId: "apply-effect",
      proposalId: "evo:eef",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT,
      scope: "canary",
    });
    expect(applied.status).toBe("applied");
    expect(plane.getProposal("evo:eef")?.status).not.toBe("VERIFIED");
    expect(() =>
      plane.promoteProposal({
        commandId: "promo-effect",
        proposalId: "evo:eef",
        principalRef: "ent-admin",
        trustedTenantId: TENANT,
      }),
    ).toThrow(/not VERIFIED|OUTCOME_VERIFIED/i);
  });
});

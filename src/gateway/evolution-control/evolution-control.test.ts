import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { createDiagnosisDelegationMachine } from "../../diagnosis/delegation.js";
import type { DelegationActor, DelegationCommandInput } from "../../diagnosis/delegation.js";
import {
  createDelegationEvolutionInspector,
  createDiagnosisEvolutionProposalMachine,
  type EvolutionAuthorizationInspector,
} from "../../diagnosis/evolution-proposal.js";
import type { DiagnosticPrincipal, TrustedTenantContext } from "../../diagnosis/types.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { readRobotWorkingStyle } from "../agent-growth/working-style-store.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { checkEvolutionAuthority } from "./authority-gate.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { createAdapterObservationProvider } from "./observation.js";
import { resolveEvolutionSurface } from "./surface-registry.js";
import { TEST_ALLOWED_ACTIONS, testObservation, withWorkingDnaExternal } from "./test-support.js";

const TENANT_A = "tenant-fixture-a";
const TRUSTED_A: TrustedTenantContext = { tenantId: TENANT_A };
const TRUSTED_PLATFORM: TrustedTenantContext = { tenantId: null };
const AGENT_ID = "dna-bot";

function principal(id: string, tenantId: string | null): DiagnosticPrincipal {
  return { schemaVersion: 1, principalId: id, kind: "user", tenantId };
}

const platform: DelegationActor = { role: "platform", principal: principal("plat-admin", null) };
const enterprise: DelegationActor = {
  role: "enterprise",
  principal: principal("ent-admin", TENANT_A),
};

function request(
  over: Partial<DelegationCommandInput> &
    Pick<DelegationCommandInput, "commandId" | "actor" | "trusted">,
) {
  return {
    command: "request" as const,
    expiresAt: "2026-09-06T12:00:00.000Z",
    targetTenant: TENANT_A,
    allowedEvidence: ["ev-a"],
    allowedActions: ["diagnose", "suggest", "apply"],
    ...over,
  };
}

function approveEnterpriseGrant() {
  const grants = createDiagnosisDelegationMachine({
    now: () => Date.parse("2026-09-06T10:00:00.000Z"),
  });
  const requested = grants.dispatch(
    request({
      commandId: "cmd-ent-grant",
      actor: platform,
      trusted: TRUSTED_PLATFORM,
      scenario: "platform_to_enterprise",
      approver: enterprise,
      grantee: enterprise,
    }),
  );
  grants.dispatch({
    commandId: "cmd-ent-ok",
    command: "approve",
    actor: enterprise,
    trusted: TRUSTED_A,
    grantId: requested.grantId,
  });
  return {
    grantId: requested.grantId!,
    inspector: createDelegationEvolutionInspector(grants),
  };
}

function mockInspector(
  over: Partial<{ status: string; tenantScope: string | null }>,
): EvolutionAuthorizationInspector {
  return {
    inspect: () => ({
      grantId: "grant-1",
      status: over.status ?? "APPROVED",
      tenantScope: over.tenantScope ?? TENANT_A,
      allowedEvidence: ["ev-a"],
      allowedActions: [...TEST_ALLOWED_ACTIONS],
      confidentialityCeiling: "enterprise",
    }),
  };
}

function dnaCandidate() {
  return {
    agentId: AGENT_ID,
    delta: { riskPreference: "conservative" as const },
    baselineStyle: DEFAULT_WORKING_STYLE,
    candidateVersion: "cand:evo:dna-1",
  };
}

describe("evolution control plane", () => {
  let tmpDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-dna-"));
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("projects a live v1 proposal without changing Diagnosis behavior", () => {
    const { inspector, grantId } = approveEnterpriseGrant();
    const machine = createDiagnosisEvolutionProposalMachine({
      now: () => Date.parse("2026-09-06T10:05:00.000Z"),
      grantInspector: inspector,
    });
    machine.dispatch({
      commandId: "cmd-dna",
      command: "suggest",
      actor: enterprise,
      trusted: TRUSTED_A,
      grantId,
      sourceCaseId: "case-open",
      targetDomain: "agent_working_dna",
      proposedChange: { summary: "tune working DNA", action: "suggest" },
    });
    machine.dispatch({
      commandId: "cmd-submit",
      command: "submit",
      actor: enterprise,
      trusted: TRUSTED_A,
      proposalId: "evo:cmd-dna",
    });
    machine.dispatch({
      commandId: "cmd-approve",
      command: "approve",
      actor: enterprise,
      trusted: TRUSTED_A,
      proposalId: "evo:cmd-dna",
    });
    const v1 = machine.getProposal("evo:cmd-dna");
    expect(v1?.status).toBe("APPROVED");
    const plane = createEvolutionControlPlane({
      inspector,
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
    });
    const projected = plane.ingestV1(v1!, { agentId: AGENT_ID });
    expect(projected.status).toBe("APPROVED_FOR_EXPERIMENT");
    expect(projected.status).not.toBe("APPROVED_FOR_APPLICATION");
    expect(v1?.status).toBe("APPROVED");
  });

  it("runs the Working DNA slice: experiment -> apply -> verify -> rollback", async () => {
    const inspector = mockInspector({});
    const plane = createEvolutionControlPlane({
      inspector,
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
      now: () => "2026-09-06T11:00:00.000Z",
      ...withWorkingDnaExternal(cfg),
    });
    plane.ingestV1(
      {
        schemaVersion: 1,
        proposalId: "evo:dna-1",
        sourceFindingIds: ["f-1"],
        sourceEvidenceRefs: ["ev-a"],
        tenantScope: TENANT_A,
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
        expiresAt: "2026-09-06T12:00:00.000Z",
        auditReceipt: "aud:evo:dna-1",
        candidateRef: "cand:evo:dna-1",
      },
      { agentId: AGENT_ID },
    );
    plane.registerCandidate("cand:evo:dna-1", dnaCandidate());
    const experiment = await plane.startWorkingDnaExperiment({
      commandId: "exp-1",
      proposalId: "evo:dna-1",
      now: "2026-09-06T11:00:00.000Z",
      freeze: {
        baselineVersion: `style:${DEFAULT_WORKING_STYLE.outputFormat}:${DEFAULT_WORKING_STYLE.reportingCadence}:${DEFAULT_WORKING_STYLE.decisionPreference}:${DEFAULT_WORKING_STYLE.riskPreference}:${DEFAULT_WORKING_STYLE.communicationTone}`,
        candidateVersion: "cand:evo:dna-1",
        codeSha: "sha-fixture",
        modelRef: "model-fixture",
        providerVersion: "provider-fixture",
        configSnapshotRef: "cfg-fixture",
        datasetOrCohortRef: "cohort-a",
        tenantScope: TENANT_A,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.decision.result).toBe("improved");
    const first = await plane.applyWorkingDna({
      commandId: "apply-1",
      proposalId: "evo:dna-1",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    const second = await plane.applyWorkingDna({
      commandId: "apply-1",
      proposalId: "evo:dna-1",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(second.applicationId).toBe(first.applicationId);
    expect((await readRobotWorkingStyle(cfg, AGENT_ID))?.riskPreference).toBe("conservative");
    const verification = await plane.verifyApplication({
      commandId: "ver-1",
      applicationId: first.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      now: "2026-09-06T11:10:00.000Z",
    });
    expect(verification.outcome).toBe("improved");
    expect(plane.getProposal("evo:dna-1")?.status).toBe("VERIFIED");
    const promoted = plane.promoteProposal({
      commandId: "promo-1",
      proposalId: "evo:dna-1",
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });
    expect(promoted.status).toBe("PROMOTED");
    await plane.rollbackApplication({
      commandId: "rb-1",
      applicationId: first.applicationId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });
    expect((await readRobotWorkingStyle(cfg, AGENT_ID))?.riskPreference).toBe(
      DEFAULT_WORKING_STYLE.riskPreference,
    );
    const lineage = plane.ledger.replay("evo:dna-1");
    expect(lineage.map((row) => row.type)).toEqual([
      "legacy.imported",
      "experiment.started",
      "experiment.completed",
      "application.applied",
      "external_effect.recorded",
      "verification.completed",
      "promotion.completed",
      "rollback.started",
      "rollback.completed",
    ]);
    expect(
      lineage.every(
        (row, index) => index === 0 || row.previousEventHash === lineage[index - 1]?.eventHash,
      ),
    ).toBe(true);
  });

  it("fails closed for unknown surfaces, expired grants, and cross-tenant apply", () => {
    expect(resolveEvolutionSurface("agent.unknown")).toBeNull();
    expect(
      checkEvolutionAuthority(mockInspector({ status: "EXPIRED" }), {
        surfaceId: "agent.working-dna",
        grantId: "grant-1",
        tenantScope: TENANT_A,
        trustedTenantId: TENANT_A,
        requestedAction: "apply",
        evidenceRefs: ["ev-a"],
        confidentialityScope: "enterprise",
      }).ok,
    ).toBe(false);
    expect(
      checkEvolutionAuthority(mockInspector({}), {
        surfaceId: "agent.working-dna",
        grantId: "grant-1",
        tenantScope: "tenant-b",
        trustedTenantId: TENANT_A,
        requestedAction: "apply",
        evidenceRefs: ["ev-a"],
        confidentialityScope: "enterprise",
      }).ok,
    ).toBe(false);
  });

  it("does not treat a linked receipt as VERIFIED", () => {
    const inspector = mockInspector({});
    const plane = createEvolutionControlPlane({
      inspector,
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
    });
    const projected = plane.ingestV1({
      schemaVersion: 1,
      proposalId: "evo:linked",
      sourceFindingIds: [],
      sourceEvidenceRefs: ["ev-a"],
      tenantScope: TENANT_A,
      targetDomain: "agent_working_dna",
      proposedChange: { summary: "linked only" },
      expectedEffect: "n/a",
      riskLevel: "low",
      confidentialityScope: "enterprise",
      status: "VERIFIED",
      approvalRequired: true,
      approverScope: "enterprise",
      grantId: "grant-1",
      createdAt: "2026-09-06T10:00:00.000Z",
      expiresAt: "2026-09-06T12:00:00.000Z",
      auditReceipt: "aud:evo:linked",
      verificationRef: "ver:legacy",
    });
    expect(projected.status).toBe("ACTIVE");
    expect(projected.legacy?.linkedVerificationOnly).toBe(true);
  });

  it("blocks new applications when the kill switch is on", async () => {
    const plane = createEvolutionControlPlane({
      inspector: mockInspector({}),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
      isKillSwitchActive: () => true,
      now: () => "2026-09-06T11:00:00.000Z",
    });
    plane.ingestV1(
      {
        schemaVersion: 1,
        proposalId: "evo:dna-kill",
        sourceFindingIds: ["f-1"],
        sourceEvidenceRefs: ["ev-a"],
        tenantScope: TENANT_A,
        targetDomain: "agent_working_dna",
        proposedChange: { summary: "blocked" },
        expectedEffect: "n/a",
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        status: "APPROVED",
        approvalRequired: true,
        approverScope: "enterprise",
        grantId: "grant-1",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-06T12:00:00.000Z",
        auditReceipt: "aud:evo:dna-kill",
        candidateRef: "cand:kill",
      },
      { agentId: AGENT_ID },
    );
    plane.registerCandidate("cand:kill", { ...dnaCandidate(), candidateVersion: "cand:kill" });
    const experiment = await plane.startExperiment({
      commandId: "kill-exp",
      proposalId: "evo:dna-kill",
      now: "2026-09-06T11:00:00.000Z",
      freeze: {
        baselineVersion: "style-seed",
        candidateVersion: "cand:kill",
        codeSha: "sha-fixture",
        modelRef: "model-fixture",
        providerVersion: "provider-fixture",
        configSnapshotRef: "cfg-fixture",
        datasetOrCohortRef: "cohort-a",
        tenantScope: TENANT_A,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    await plane.evaluateExperiment(experiment.experimentId);
    await expect(
      plane.applyWorkingDna({
        commandId: "kill-apply",
        proposalId: "evo:dna-kill",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/kill switch blocks new applications/);
  });

  it("refuses unattended apply under the default assist policy", async () => {
    const plane = createEvolutionControlPlane({
      inspector: mockInspector({}),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
      now: () => "2026-09-06T11:00:00.000Z",
    });
    plane.ingestV1(
      {
        schemaVersion: 1,
        proposalId: "evo:dna-auto",
        sourceFindingIds: ["f-1"],
        sourceEvidenceRefs: ["ev-a"],
        tenantScope: TENANT_A,
        targetDomain: "agent_working_dna",
        proposedChange: { summary: "no auto" },
        expectedEffect: "n/a",
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        status: "APPROVED",
        approvalRequired: true,
        approverScope: "enterprise",
        grantId: "grant-1",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-06T12:00:00.000Z",
        auditReceipt: "aud:evo:dna-auto",
        candidateRef: "cand:auto",
      },
      { agentId: AGENT_ID },
    );
    plane.registerCandidate("cand:auto", { ...dnaCandidate(), candidateVersion: "cand:auto" });
    const experiment = await plane.startExperiment({
      commandId: "auto-exp",
      proposalId: "evo:dna-auto",
      now: "2026-09-06T11:00:00.000Z",
      freeze: {
        baselineVersion: "style-seed",
        candidateVersion: "cand:auto",
        codeSha: "sha-fixture",
        modelRef: "model-fixture",
        providerVersion: "provider-fixture",
        configSnapshotRef: "cfg-fixture",
        datasetOrCohortRef: "cohort-a",
        tenantScope: TENANT_A,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    await plane.evaluateExperiment(experiment.experimentId);
    await expect(
      plane.applyWorkingDna({
        commandId: "auto-apply",
        proposalId: "evo:dna-auto",
        experimentId: experiment.experimentId,
        principalRef: "control-plane",
        trustedTenantId: TENANT_A,
        scope: "shadow",
        unattended: true,
      }),
    ).rejects.toThrow(/autoApply is not granted|assist cannot auto-apply/);
  });

  it("holds an experiment without auto-hold, then resumes the same experiment", async () => {
    const adapter = createWorkingDnaAdapter(cfg);
    const plane = createEvolutionControlPlane({
      inspector: mockInspector({}),
      workingDnaAdapter: adapter,
      observationProvider: createAdapterObservationProvider({
        resolveAdapter: () => adapter,
      }),
      now: () => "2026-09-06T11:00:00.000Z",
    });
    plane.ingestV1(
      {
        schemaVersion: 1,
        proposalId: "evo:dna-hold",
        sourceFindingIds: ["f-1"],
        sourceEvidenceRefs: ["ev-a"],
        tenantScope: TENANT_A,
        targetDomain: "agent_working_dna",
        proposedChange: { summary: "hold slice" },
        expectedEffect: "n/a",
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        status: "APPROVED",
        approvalRequired: true,
        approverScope: "enterprise",
        grantId: "grant-1",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-06T12:00:00.000Z",
        auditReceipt: "aud:evo:dna-hold",
        candidateRef: "cand:hold",
      },
      { agentId: AGENT_ID },
    );
    plane.registerCandidate("cand:hold", { ...dnaCandidate(), candidateVersion: "cand:hold" });
    const freeze = {
      baselineVersion: "style-seed",
      candidateVersion: "cand:hold",
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
    const experiment = await plane.startExperiment({
      commandId: "hold-exp",
      proposalId: "evo:dna-hold",
      now: "2026-09-06T11:00:00.000Z",
      freeze,
    });
    const evaluated = await plane.evaluateExperiment(experiment.experimentId);
    expect(evaluated.decision.result).toBe("inconclusive");
    expect(evaluated.recommendedFollowUp).toBe("hold");
    expect(plane.getProposal("evo:dna-hold")?.status).toBe("EXPERIMENTING");
    expect(() =>
      plane.holdProposal({
        commandId: "hold-x",
        proposalId: "evo:dna-hold",
        principalRef: "ent-admin",
        trustedTenantId: "other-tenant",
      }),
    ).toThrow(/proposal not found/);
    expect(plane.getProposal("evo:dna-hold")?.status).toBe("EXPERIMENTING");
    const held = plane.holdProposal({
      commandId: "hold-1",
      proposalId: "evo:dna-hold",
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
    });
    expect(held.status).toBe("HELD");
    expect(
      plane.ledger
        .list({ proposalId: "evo:dna-hold" })
        .some((row) => row.type === "experiment.held"),
    ).toBe(true);
    const resumed = await plane.startExperiment({
      commandId: "hold-resume",
      proposalId: "evo:dna-hold",
      now: "2026-09-06T11:05:00.000Z",
      freeze,
    });
    expect(resumed.experimentId).toBe(experiment.experimentId);
    expect(plane.getProposal("evo:dna-hold")?.status).toBe("EXPERIMENTING");
    expect(plane.getProposal("evo:dna-hold")?.experimentId).toBe(experiment.experimentId);
  });

  it("refuses hold after canary application", async () => {
    const plane = createEvolutionControlPlane({
      inspector: mockInspector({}),
      workingDnaAdapter: createWorkingDnaAdapter(cfg),
      observationProvider: testObservation(),
      now: () => "2026-09-06T11:00:00.000Z",
    });
    plane.ingestV1(
      {
        schemaVersion: 1,
        proposalId: "evo:dna-canary-hold",
        sourceFindingIds: ["f-1"],
        sourceEvidenceRefs: ["ev-a"],
        tenantScope: TENANT_A,
        targetDomain: "agent_working_dna",
        proposedChange: { summary: "no hold after apply" },
        expectedEffect: "n/a",
        riskLevel: "medium",
        confidentialityScope: "enterprise",
        status: "APPROVED",
        approvalRequired: true,
        approverScope: "enterprise",
        grantId: "grant-1",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-06T12:00:00.000Z",
        auditReceipt: "aud:evo:dna-canary-hold",
        candidateRef: "cand:canary-hold",
      },
      { agentId: AGENT_ID },
    );
    plane.registerCandidate("cand:canary-hold", {
      ...dnaCandidate(),
      candidateVersion: "cand:canary-hold",
    });
    const experiment = await plane.startExperiment({
      commandId: "canary-hold-exp",
      proposalId: "evo:dna-canary-hold",
      now: "2026-09-06T11:00:00.000Z",
      freeze: {
        baselineVersion: "style-seed",
        candidateVersion: "cand:canary-hold",
        codeSha: "sha-fixture",
        modelRef: "model-fixture",
        providerVersion: "provider-fixture",
        configSnapshotRef: "cfg-fixture",
        datasetOrCohortRef: "cohort-a",
        tenantScope: TENANT_A,
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    await plane.evaluateExperiment(experiment.experimentId);
    await plane.applyWorkingDna({
      commandId: "canary-hold-apply",
      proposalId: "evo:dna-canary-hold",
      experimentId: experiment.experimentId,
      principalRef: "ent-admin",
      trustedTenantId: TENANT_A,
      scope: "canary",
    });
    expect(plane.getProposal("evo:dna-canary-hold")?.status).toBe("CANARY");
    expect(() =>
      plane.holdProposal({
        commandId: "canary-hold-1",
        proposalId: "evo:dna-canary-hold",
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
      }),
    ).toThrow(/hold requires an active EXPERIMENTING proposal/);
  });
});

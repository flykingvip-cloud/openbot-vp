import { organizationMetricSet } from "@openbot/evolution-core";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import { createWorkingDnaAdapter } from "../evolution-control/adapters/working-dna.js";
import { createEvolutionControlPlane } from "../evolution-control/control-plane.js";
import { setDiagnosisCandidateStatusPortsForTests } from "../evolution-control/project-diagnosis-candidate.js";
import { createMemoryDiagnosisSubmitPorts } from "../evolution-control/submit-diagnosis-candidate.js";
import { TEST_ALLOWED_ACTIONS, testObservation } from "../evolution-control/test-support.js";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";
import { createEvolutionControlHandlers } from "./evolution-control.js";
import { evolutionControlPack } from "./evolution-control.pack.js";
import { GATEWAY_METHOD_PACKS } from "./packs/registry.js";
import type { GatewayClient, GatewayRequestHandler } from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-fixture-b";

function inspector(): EvolutionAuthorizationInspector {
  return {
    inspect: () => ({
      grantId: "grant-1",
      status: "APPROVED",
      tenantScope: TENANT_A,
      allowedEvidence: ["ev-a"],
      allowedActions: [...TEST_ALLOWED_ACTIONS],
      confidentialityCeiling: "enterprise",
    }),
  };
}

function clientFor(tenantId: string): GatewayClient {
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 3,
      client: {
        id: "ctrl",
        displayName: "ctrl",
        version: "1",
        platform: "web",
        mode: "webchat",
      },
    },
    user: "ent-admin",
    sessionEnterpriseId: tenantId,
    sessionTenantId: tenantId,
  };
}

function invoke(
  handler: GatewayRequestHandler,
  params: Record<string, unknown>,
  client: GatewayClient | null,
) {
  return new Promise<{ ok: boolean; payload?: unknown; error?: { message?: string } }>(
    (resolve) => {
      void handler({
        req: { id: "1", method: "test", type: "req" },
        params,
        client,
        isWebchatConnect: () => false,
        respond: (ok, payload, error) => {
          resolve({ ok, payload, error: error as { message?: string } | undefined });
        },
        context: {} as never,
      });
    },
  );
}

describe("evolution control method pack", () => {
  afterEach(() => {
    setDiagnosisCandidateStatusPortsForTests();
  });

  it("registers the first RPC set without touching legacy method lists", () => {
    expect(evolutionControlPack.id).toBe("evolution-control");
    expect(GATEWAY_METHOD_PACKS.some((pack) => pack.id === "evolution-control")).toBe(true);
    expect(evolutionControlPack.methods).toContain("evolution.surfaces.list");
    expect(evolutionControlPack.methods).toContain("evolution.applications.verify");
    expect(evolutionControlPack.methods).toContain("evolution.task-outcomes.record");
    expect(evolutionControlPack.methods).toContain("evolution.working-dna.verify-effect");
    expect(evolutionControlPack.methods).toContain("evolution.working-dna.evaluate-promote");
    expect(evolutionControlPack.methods).toContain("evolution.diagnosis.status");
    expect(evolutionControlPack.methods).toContain("evolution.diagnosis.recheck");
    expect(evolutionControlPack.methods).toContain("evolution.applications.approve");
    expect(
      authorizeOperatorScopesForMethod("evolution.diagnosis.recheck", ["operator.approvals"])
        .allowed,
    ).toBe(true);
    expect(
      authorizeOperatorScopesForMethod("evolution.applications.approve", ["operator.approvals"])
        .allowed,
    ).toBe(true);
    expect(
      authorizeOperatorScopesForMethod("evolution.applications.approve", ["operator.read"]),
    ).toEqual({ allowed: false, missingScope: "operator.approvals" });
    expect(
      authorizeOperatorScopesForMethod("evolution.diagnosis.status", ["operator.read"]).allowed,
    ).toBe(true);
    expect(
      authorizeOperatorScopesForMethod("evolution.experiments.create", ["operator.read"]),
    ).toEqual({ allowed: false, missingScope: "operator.approvals" });
    expect(
      authorizeOperatorScopesForMethod("evolution.diagnosis.submit", ["operator.read"]),
    ).toEqual({ allowed: false, missingScope: "operator.approvals" });
    expect(
      authorizeOperatorScopesForMethod("evolution.diagnosis.submit", ["operator.approvals"])
        .allowed,
    ).toBe(true);
    expect(
      authorizeOperatorScopesForMethod("evolution.task-outcomes.record", ["operator.read"]),
    ).toEqual({ allowed: false, missingScope: "operator.approvals" });
    expect(
      authorizeOperatorScopesForMethod("evolution.working-dna.verify-effect", [
        "operator.approvals",
      ]).allowed,
    ).toBe(true);
    expect(evolutionControlPack.scopes["operator.approvals"]).toContain(
      "evolution.applications.apply",
    );
    expect(
      authorizeOperatorScopesForMethod("evolution.proposals.list", ["operator.read"]).allowed,
    ).toBe(true);
    expect(
      authorizeOperatorScopesForMethod("evolution.applications.apply", ["operator.read"]),
    ).toEqual({ allowed: false, missingScope: "operator.approvals" });
    expect(
      authorizeOperatorScopesForMethod("evolution.applications.apply", ["operator.approvals"])
        .allowed,
    ).toBe(true);
  });

  it("lists surfaces and hides cross-tenant proposals", async () => {
    const plane = createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      observationProvider: testObservation(),
    });
    plane.registerProposal({
      schemaVersion: 2,
      proposalId: "evo:org-a",
      sourceEvidenceRefs: ["ev-a"],
      sourceMechanismRef: "case-org",
      target: { domain: "organization", groupId: "g1" },
      candidateRef: "cand:org-a",
      surfaceId: "organization.task-routing",
      expectedEffects: [organizationMetricSet().primary],
      riskLevel: "high",
      confidentialityScope: "enterprise",
      tenantScope: TENANT_A,
      grantId: "grant-1",
      status: "SUGGESTED",
      createdAt: "2026-09-06T10:00:00.000Z",
      expiresAt: "2026-09-06T12:00:00.000Z",
    });
    const handlers = createEvolutionControlHandlers(() => plane);
    const surfaces = await invoke(handlers["evolution.surfaces.list"], {}, clientFor(TENANT_A));
    expect(surfaces.ok).toBe(true);
    const listedA = await invoke(handlers["evolution.proposals.list"], {}, clientFor(TENANT_A));
    const listedB = await invoke(handlers["evolution.proposals.list"], {}, clientFor(TENANT_B));
    expect((listedA.payload as { proposals: { proposalId: string }[] }).proposals).toHaveLength(1);
    expect((listedB.payload as { proposals: unknown[] }).proposals).toHaveLength(0);
  });

  it("exposes triageTag on evolution.proposals.list and supports triageTag filter", async () => {
    const plane = createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      observationProvider: testObservation(),
    });
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:gap-perception",
        sourceEvidenceRefs: ["ev-a"],
        sourceMechanismRef: "capability-gap:perception",
        target: { domain: "capability", skillId: "gap:perception" },
        candidateRef: "cand:gap-perception",
        surfaceId: "capability.skill-spec",
        expectedEffects: [organizationMetricSet().primary],
        riskLevel: "low",
        confidentialityScope: "enterprise",
        tenantScope: TENANT_A,
        grantId: "grant-1",
        status: "SUGGESTED",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-06T12:00:00.000Z",
      },
      {
        kind: "capability-gap",
        category: "perception",
        triageTag: "perception-triage",
        reason: "silent_private",
        lifecycle: "in_progress",
      },
    );
    const handlers = createEvolutionControlHandlers(() => plane);
    const listed = await invoke(handlers["evolution.proposals.list"], {}, clientFor(TENANT_A));
    expect(listed.ok).toBe(true);
    const proposals = (
      listed.payload as {
        proposals: Array<{
          proposalId: string;
          triageTag: string | null;
          capabilityGap: { triageTag: string | null } | null;
        }>;
      }
    ).proposals;
    const row = proposals.find((p) => p.proposalId === "evo:gap-perception");
    expect(row?.triageTag).toBe("perception-triage");
    expect(row?.capabilityGap?.triageTag).toBe("perception-triage");

    const filtered = await invoke(
      handlers["evolution.proposals.list"],
      { triageTag: "perception-triage" },
      clientFor(TENANT_A),
    );
    expect(filtered.ok).toBe(true);
    const filteredRows = (filtered.payload as { proposals: unknown[] }).proposals;
    expect(filteredRows).toHaveLength(1);

    const miss = await invoke(
      handlers["evolution.proposals.list"],
      { triageTag: "other-tag" },
      clientFor(TENANT_A),
    );
    expect((miss.payload as { proposals: unknown[] }).proposals).toHaveLength(0);
  });

  it("requires command IDs on writes and rejects client-forged verification", async () => {
    const plane = createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      observationProvider: testObservation(),
    });
    plane.registerProposal({
      schemaVersion: 2,
      proposalId: "evo:org-a",
      sourceEvidenceRefs: ["ev-a"],
      sourceMechanismRef: "case-org",
      target: { domain: "organization", groupId: "g1" },
      candidateRef: "cand:org-a",
      surfaceId: "organization.task-routing",
      expectedEffects: [organizationMetricSet().primary],
      riskLevel: "high",
      confidentialityScope: "enterprise",
      tenantScope: TENANT_A,
      grantId: "grant-1",
      status: "SUGGESTED",
      createdAt: "2026-09-06T10:00:00.000Z",
      expiresAt: "2026-09-06T12:00:00.000Z",
    });
    const handlers = createEvolutionControlHandlers(() => plane);
    const missing = await invoke(
      handlers["evolution.proposals.transition"],
      { proposalId: "evo:org-a", command: "reject" },
      clientFor(TENANT_A),
    );
    expect(missing.ok).toBe(false);
    expect(missing.error?.message).toMatch(/commandId is required/);
    const forged = await invoke(
      handlers["evolution.verifications.get"],
      { verificationId: "ver:1", outcome: "improved" },
      clientFor(TENANT_A),
    );
    expect(forged.ok).toBe(false);
    expect(forged.error?.message).toMatch(/cannot submit verification outcomes/);
    const unattended = await invoke(
      handlers["evolution.applications.apply"],
      {
        commandId: "cmd-auto",
        proposalId: "evo:org-a",
        experimentId: "exp:1",
        scope: "shadow",
        unattended: true,
      },
      clientFor(TENANT_A),
    );
    expect(unattended.ok).toBe(false);
    expect(unattended.error?.message).toMatch(/cannot request unattended apply/);
    const rejected = await invoke(
      handlers["evolution.proposals.transition"],
      { commandId: "cmd-reject", proposalId: "evo:org-a", command: "reject" },
      clientFor(TENANT_A),
    );
    expect(rejected.ok).toBe(true);
    expect(plane.getProposal("evo:org-a")?.status).toBe("REJECTED");
  });

  it("rejects client-supplied candidates and evaluations, and does not mutate on cross-tenant reject", async () => {
    const plane = createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      observationProvider: testObservation(),
    });
    plane.registerProposal({
      schemaVersion: 2,
      proposalId: "evo:org-a",
      sourceEvidenceRefs: ["ev-a"],
      sourceMechanismRef: "case-org",
      target: { domain: "organization", groupId: "g1" },
      candidateRef: "cand:org-a",
      surfaceId: "organization.task-routing",
      expectedEffects: [organizationMetricSet().primary],
      riskLevel: "high",
      confidentialityScope: "enterprise",
      tenantScope: TENANT_A,
      grantId: "grant-1",
      status: "SUGGESTED",
      createdAt: "2026-09-06T10:00:00.000Z",
      expiresAt: "2026-09-06T12:00:00.000Z",
    });
    const handlers = createEvolutionControlHandlers(() => plane);
    const forgedCandidate = await invoke(
      handlers["evolution.applications.apply"],
      {
        commandId: "cmd-apply",
        proposalId: "evo:org-a",
        experimentId: "exp:1",
        scope: "canary",
        candidate: { forged: true },
      },
      clientFor(TENANT_A),
    );
    expect(forgedCandidate.ok).toBe(false);
    expect(forgedCandidate.error?.message).toMatch(/cannot submit a candidate payload/);
    const forgedEval = await invoke(
      handlers["evolution.experiments.evaluate"],
      {
        commandId: "cmd-eval",
        experimentId: "exp:1",
        evaluation: { rollbackDrill: "passed" },
      },
      clientFor(TENANT_A),
    );
    expect(forgedEval.ok).toBe(false);
    expect(forgedEval.error?.message).toMatch(/cannot submit experiment evaluation/);
    const forgedDecision = await invoke(
      handlers["evolution.applications.verify"],
      {
        commandId: "cmd-ver",
        applicationId: "app:1",
        decision: { result: "improved" },
      },
      clientFor(TENANT_A),
    );
    expect(forgedDecision.ok).toBe(false);
    expect(forgedDecision.error?.message).toMatch(/cannot submit experiment evaluation/);
    const crossTenant = await invoke(
      handlers["evolution.proposals.transition"],
      { commandId: "cmd-x", proposalId: "evo:org-a", command: "reject" },
      clientFor(TENANT_B),
    );
    expect(crossTenant.ok).toBe(false);
    expect(crossTenant.error?.message).toMatch(/proposal not found/);
    expect(plane.getProposal("evo:org-a")?.status).toBe("SUGGESTED");
  });

  it("holds an experimenting proposal over RPC and resumes the same experiment", async () => {
    const plane = createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      observationProvider: testObservation(),
    });
    plane.registerProposal({
      schemaVersion: 2,
      proposalId: "evo:org-hold",
      sourceEvidenceRefs: ["ev-a"],
      sourceMechanismRef: "case-org",
      target: { domain: "organization", groupId: "g1" },
      candidateRef: "cand:org-hold",
      surfaceId: "organization.task-routing",
      expectedEffects: [organizationMetricSet().primary],
      riskLevel: "high",
      confidentialityScope: "enterprise",
      tenantScope: TENANT_A,
      grantId: "grant-1",
      status: "APPROVED_FOR_EXPERIMENT",
      createdAt: "2026-09-06T10:00:00.000Z",
      expiresAt: "2026-09-06T12:00:00.000Z",
    });
    const freeze = {
      baselineVersion: "policy-seed",
      candidateVersion: "cand:org-hold",
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
      commandId: "rpc-hold-exp",
      proposalId: "evo:org-hold",
      now: "2026-09-06T11:00:00.000Z",
      freeze,
    });
    const handlers = createEvolutionControlHandlers(() => plane);
    const forbidden = await invoke(
      handlers["evolution.proposals.transition"],
      { commandId: "cmd-verify", proposalId: "evo:org-hold", command: "verify" },
      clientFor(TENANT_A),
    );
    expect(forbidden.ok).toBe(false);
    expect(forbidden.error?.message).toMatch(/only reject, promote, or hold/);
    const crossTenant = await invoke(
      handlers["evolution.proposals.transition"],
      { commandId: "cmd-x-hold", proposalId: "evo:org-hold", command: "hold" },
      clientFor(TENANT_B),
    );
    expect(crossTenant.ok).toBe(false);
    expect(plane.getProposal("evo:org-hold")?.status).toBe("EXPERIMENTING");
    const held = await invoke(
      handlers["evolution.proposals.transition"],
      { commandId: "cmd-hold", proposalId: "evo:org-hold", command: "hold" },
      clientFor(TENANT_A),
    );
    expect(held.ok).toBe(true);
    expect(plane.getProposal("evo:org-hold")?.status).toBe("HELD");
    const resumed = await invoke(
      handlers["evolution.experiments.create"],
      { commandId: "cmd-resume", proposalId: "evo:org-hold" },
      clientFor(TENANT_A),
    );
    expect(resumed.ok).toBe(true);
    expect(
      (resumed.payload as { experiment: { experimentId: string } }).experiment.experimentId,
    ).toBe(experiment.experimentId);
    expect(plane.getProposal("evo:org-hold")?.status).toBe("EXPERIMENTING");
  });

  it("rejects client-supplied verification outcomes on canary write RPCs", async () => {
    const handlers = createEvolutionControlHandlers();
    const forgedRecord = await invoke(
      handlers["evolution.task-outcomes.record"],
      { commandId: "cmd-out", agentId: "bot", outcome: "verified" },
      clientFor(TENANT_A),
    );
    expect(forgedRecord.ok).toBe(false);
    expect(forgedRecord.error?.message).toMatch(/cannot submit verification outcomes/);
    const forgedRaw = await invoke(
      handlers["evolution.working-dna.verify-effect"],
      { commandId: "cmd-raw", agentId: "bot", outcome: "verified" },
      clientFor(TENANT_A),
    );
    expect(forgedRaw.ok).toBe(false);
    expect(forgedRaw.error?.message).toMatch(/cannot submit verification outcomes/);
    const forgedPromote = await invoke(
      handlers["evolution.working-dna.evaluate-promote"],
      { commandId: "cmd-prom", agentId: "bot", verified: true },
      clientFor(TENANT_A),
    );
    expect(forgedPromote.ok).toBe(false);
    expect(forgedPromote.error?.message).toMatch(/cannot submit verification outcomes/);
  });

  it("reads diagnosis candidate status from control-plane ports without copying status onto the receipt", async () => {
    const version = "b".repeat(64);
    const submit = createMemoryDiagnosisSubmitPorts({
      proposals: [
        {
          schemaVersion: 2,
          proposalId: "evo:diag:status-1",
          sourceEvidenceRefs: ["ev-a"],
          sourceMechanismRef: "diagnosis.behavior.reporting_cadence_gap",
          target: { domain: "agent", agentId: "bot-2" },
          candidateRef: version,
          surfaceId: "agent.working-dna",
          expectedEffects: [],
          riskLevel: "low",
          confidentialityScope: "enterprise",
          tenantScope: TENANT_A,
          grantId: "grant-1",
          status: "APPROVED_FOR_EXPERIMENT",
          createdAt: "2026-09-06T10:00:00.000Z",
          expiresAt: "2026-09-13T10:00:00.000Z",
        },
      ],
      wals: [
        {
          commandId: "cmd-status",
          proposalId: "evo:diag:status-1",
          candidateRef: version,
          surfaceId: "agent.working-dna",
          contentHash: version,
          tenantScope: TENANT_A,
          targetKey: "agent:bot-2",
          mechanism: "diagnosis.behavior.reporting_cadence_gap",
          candidateVersion: version,
          grantId: "grant-1",
          state: "committed",
          ledgerEventIds: ["evt-status"],
        },
      ],
    });
    setDiagnosisCandidateStatusPortsForTests({
      listProposals: () => submit.listProposals(),
      getProposal: (id) => submit.getProposal(id),
      listWals: () => submit.listWals(),
      getExperiment: () => undefined,
    });
    const handlers = createEvolutionControlHandlers();
    const listed = await invoke(
      handlers["evolution.diagnosis.status"],
      { candidateVersion: version },
      clientFor(TENANT_A),
    );
    expect(listed.ok).toBe(true);
    const projection = (
      listed.payload as { projection: { liveStatus: string; submissionRef: object } }
    ).projection;
    expect(projection.liveStatus).toBe(submit.getProposal("evo:diag:status-1")?.status);
    expect(JSON.stringify(projection.submissionRef)).not.toContain('"status"');
    const hidden = await invoke(
      handlers["evolution.diagnosis.status"],
      { candidateVersion: version },
      clientFor(TENANT_B),
    );
    expect(hidden.ok).toBe(true);
    expect((hidden.payload as { projection: { found: boolean } }).projection.found).toBe(false);
  });
});

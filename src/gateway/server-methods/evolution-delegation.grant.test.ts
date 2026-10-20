import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { workingDnaMetricSet } from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  assertClientMayAccessAgentDetailed: vi.fn(),
}));

vi.mock("./operator-access.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./operator-access.js")>();
  return {
    ...actual,
    assertClientMayAccessAgentDetailed: hoisted.assertClientMayAccessAgentDetailed,
  };
});
import type { OpenBotConfig } from "../../config/config.js";
import { createFileDelegationStore } from "../../diagnosis/delegation-file-store.js";
import { createDiagnosisDelegationMachine } from "../../diagnosis/delegation.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { resetEvolutionControlPlaneForTests } from "../evolution-control/bootstrap.js";
import {
  getSharedDiagnosisDelegationMachine,
  resetSharedDiagnosisDelegationForTests,
  resolveDelegationStorePath,
} from "../evolution-control/delegation-service.js";
import {
  approveEvolutionGrant,
  evolutionGrantActorFromPrincipal,
  requestEvolutionWorkingDnaGrant,
} from "../evolution-control/evolution-grant.js";
import { createGatewayEvolutionControlPlane } from "../evolution-control/gateway-plane.js";
import { testObservation } from "../evolution-control/test-support.js";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";
import {
  createEvolutionControlHandlers,
  setEvolutionControlPlaneForTests,
} from "./evolution-control.js";
import { evolutionDelegationHandlers } from "./evolution-delegation.js";
import { evolutionDelegationPack } from "./evolution-delegation.pack.js";
import type { GatewayClient, GatewayRequestHandler } from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-fixture-b";
const AGENT_ID = "wdna-grant-bot";

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

function freeze(candidateRef: string) {
  return {
    baselineVersion: "style-seed",
    candidateVersion: candidateRef,
    codeSha: "sha-fixture",
    modelRef: "model-fixture",
    providerVersion: "provider-fixture",
    configSnapshotRef: "cfg-fixture",
    datasetOrCohortRef: "cohort-a",
    tenantScope: TENANT_A,
    confidentialityScope: "enterprise" as const,
    expiresAt: "2027-09-07T00:00:00.000Z",
    maxResourceBudget: 1,
  };
}

function issueApprovedGrant(input: {
  persistDir: string;
  tenantId: string;
  agentId: string;
  expiresAt?: string;
  proposalId?: string;
  /** Freeze delegation clock so expired grants can still be approved in tests. */
  asOf?: string;
}): string {
  resetSharedDiagnosisDelegationForTests();
  const machine = input.asOf
    ? createDiagnosisDelegationMachine({
        now: () => Date.parse(input.asOf!),
        store: createFileDelegationStore(resolveDelegationStorePath(input.persistDir)),
      })
    : getSharedDiagnosisDelegationMachine(input.persistDir);
  const issuer = evolutionGrantActorFromPrincipal(
    { schemaVersion: 1, principalId: "platform-evolution", kind: "service", tenantId: null },
    "platform",
  );
  const enterprise = evolutionGrantActorFromPrincipal(
    { schemaVersion: 1, principalId: "ent-admin", kind: "user", tenantId: input.tenantId },
    "enterprise",
  );
  const requested = requestEvolutionWorkingDnaGrant({
    machine,
    commandId: `cmd-grant-req-${input.tenantId}`,
    trusted: { tenantId: input.tenantId },
    issuer,
    approver: enterprise,
    grantee: enterprise,
    tenantId: input.tenantId,
    agentId: input.agentId,
    proposalId: input.proposalId,
    evidenceRefs: ["ev-grant"],
    expiresAt: input.expiresAt ?? "2027-09-07T00:00:00.000Z",
  });
  approveEvolutionGrant({
    machine,
    commandId: `cmd-grant-appr-${input.tenantId}`,
    trusted: { tenantId: input.tenantId },
    approver: enterprise,
    grantId: requested.grantId,
  });
  return requested.grantId;
}

describe("evolution delegation grant RPC and experiments.create authority", () => {
  let tmpDir = "";
  let persistDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-evo-grant-"));
    persistDir = path.join(tmpDir, "control");
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
    hoisted.assertClientMayAccessAgentDetailed.mockImplementation(async (_client, agentId) => ({
      agentId,
      tenantId: TENANT_A,
      userId: "ent-admin",
    }));
    resetEvolutionControlPlaneForTests();
    resetSharedDiagnosisDelegationForTests();
  });

  afterEach(async () => {
    setEvolutionControlPlaneForTests(undefined);
    resetEvolutionControlPlaneForTests();
    resetSharedDiagnosisDelegationForTests();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("registers delegation RPC scopes", () => {
    expect(evolutionDelegationPack.methods).toContain("evolution.delegation.request");
    expect(
      authorizeOperatorScopesForMethod("evolution.delegation.approve", ["operator.approvals"])
        .allowed,
    ).toBe(true);
    expect(
      authorizeOperatorScopesForMethod("evolution.delegation.get", ["operator.read"]).allowed,
    ).toBe(true);
  });

  it("issues an auditable grant through gateway RPC request + approve", async () => {
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      observationProvider: testObservation(),
    });
    setEvolutionControlPlaneForTests(plane);
    const requested = await invoke(
      evolutionDelegationHandlers["evolution.delegation.request"],
      { commandId: "cmd-rpc-req", agentId: AGENT_ID, evidenceRefs: ["ev-rpc"] },
      clientFor(TENANT_A),
    );
    expect(requested.ok).toBe(true);
    const grantId = (requested.payload as { grantId: string }).grantId;
    const approved = await invoke(
      evolutionDelegationHandlers["evolution.delegation.approve"],
      { commandId: "cmd-rpc-appr", grantId },
      clientFor(TENANT_A),
    );
    expect(approved.ok).toBe(true);
    const viewed = await invoke(
      evolutionDelegationHandlers["evolution.delegation.get"],
      { grantId },
      clientFor(TENANT_A),
    );
    expect(viewed.ok).toBe(true);
    expect((viewed.payload as { grant: { status: string } }).grant.status).toBe("APPROVED");
  });

  it("allows experiments.create when a linked grant is approved", async () => {
    const grantId = issueApprovedGrant({ persistDir, tenantId: TENANT_A, agentId: AGENT_ID });
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      observationProvider: testObservation(),
    });
    const metrics = workingDnaMetricSet();
    plane.registerProposal(
      {
        schemaVersion: 2,
        proposalId: "evo:wdna-grant-ok",
        sourceEvidenceRefs: ["ev-grant"],
        sourceMechanismRef: "obs:run-grant-ok",
        target: { domain: "agent", agentId: AGENT_ID },
        candidateRef: "cand:wdna-grant-ok",
        expectedEffects: [metrics.primary, ...metrics.guardrails],
        riskLevel: "low",
        surfaceId: "agent.working-dna",
        tenantScope: TENANT_A,
        confidentialityScope: "enterprise",
        status: "APPROVED_FOR_EXPERIMENT",
        grantId,
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2027-09-07T00:00:00.000Z",
      },
      {
        agentId: AGENT_ID,
        delta: { reportingCadence: "milestone" },
        baselineStyle: DEFAULT_WORKING_STYLE,
        candidateVersion: "cand:wdna-grant-ok",
      },
    );
    setEvolutionControlPlaneForTests(plane);
    const handlers = createEvolutionControlHandlers(() => plane);
    const created = await invoke(
      handlers["evolution.experiments.create"],
      {
        commandId: "cmd-exp-grant-ok",
        proposalId: "evo:wdna-grant-ok",
        freeze: freeze("cand:wdna-grant-ok"),
      },
      clientFor(TENANT_A),
    );
    expect(created.ok).toBe(true);
    expect(
      (created.payload as { experiment: { experimentId: string } }).experiment.experimentId,
    ).toMatch(/^exp:/);
  });

  it("rejects experiments.create when the linked grant is missing", async () => {
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      observationProvider: testObservation(),
    });
    const metrics = workingDnaMetricSet();
    plane.registerProposal({
      schemaVersion: 2,
      proposalId: "evo:wdna-missing-grant",
      sourceEvidenceRefs: ["ev-a"],
      sourceMechanismRef: "obs:run-missing",
      target: { domain: "agent", agentId: AGENT_ID },
      candidateRef: "cand:wdna-missing",
      expectedEffects: [metrics.primary, ...metrics.guardrails],
      riskLevel: "low",
      surfaceId: "agent.working-dna",
      tenantScope: TENANT_A,
      confidentialityScope: "enterprise",
      status: "APPROVED_FOR_EXPERIMENT",
      grantId: "grant-does-not-exist",
      createdAt: "2026-09-06T10:00:00.000Z",
      expiresAt: "2027-09-07T00:00:00.000Z",
    });
    setEvolutionControlPlaneForTests(plane);
    const handlers = createEvolutionControlHandlers(() => plane);
    const denied = await invoke(
      handlers["evolution.experiments.create"],
      {
        commandId: "cmd-exp-missing-grant",
        proposalId: "evo:wdna-missing-grant",
        freeze: freeze("cand:wdna-missing"),
      },
      clientFor(TENANT_A),
    );
    expect(denied.ok).toBe(false);
    expect(denied.error?.message).toMatch(/linked grant is missing/);
  });

  it("rejects cross-tenant grant binding on experiments.create", async () => {
    const grantId = issueApprovedGrant({ persistDir, tenantId: TENANT_A, agentId: AGENT_ID });
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      observationProvider: testObservation(),
    });
    const metrics = workingDnaMetricSet();
    plane.registerProposal({
      schemaVersion: 2,
      proposalId: "evo:wdna-cross-tenant",
      sourceEvidenceRefs: ["ev-a"],
      sourceMechanismRef: "obs:run-cross",
      target: { domain: "agent", agentId: AGENT_ID },
      candidateRef: "cand:wdna-cross",
      expectedEffects: [metrics.primary, ...metrics.guardrails],
      riskLevel: "low",
      surfaceId: "agent.working-dna",
      tenantScope: TENANT_B,
      confidentialityScope: "enterprise",
      status: "APPROVED_FOR_EXPERIMENT",
      grantId,
      createdAt: "2026-09-06T10:00:00.000Z",
      expiresAt: "2027-09-07T00:00:00.000Z",
    });
    setEvolutionControlPlaneForTests(plane);
    const handlers = createEvolutionControlHandlers(() => plane);
    const denied = await invoke(
      handlers["evolution.experiments.create"],
      {
        commandId: "cmd-exp-cross-tenant",
        proposalId: "evo:wdna-cross-tenant",
        freeze: { ...freeze("cand:wdna-cross"), tenantScope: TENANT_B },
      },
      clientFor(TENANT_B),
    );
    expect(denied.ok).toBe(false);
    expect(denied.error?.message).toMatch(/tenant|grant|authorization/i);
  });

  it("rejects expired linked grants on experiments.create", async () => {
    const grantId = issueApprovedGrant({
      persistDir,
      tenantId: TENANT_A,
      agentId: AGENT_ID,
      expiresAt: "2026-09-01T00:00:00.000Z",
      asOf: "2026-08-31T00:00:00.000Z",
    });
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      observationProvider: testObservation(),
    });
    const metrics = workingDnaMetricSet();
    plane.registerProposal({
      schemaVersion: 2,
      proposalId: "evo:wdna-expired-grant",
      sourceEvidenceRefs: ["ev-a"],
      sourceMechanismRef: "obs:run-expired",
      target: { domain: "agent", agentId: AGENT_ID },
      candidateRef: "cand:wdna-expired",
      expectedEffects: [metrics.primary, ...metrics.guardrails],
      riskLevel: "low",
      surfaceId: "agent.working-dna",
      tenantScope: TENANT_A,
      confidentialityScope: "enterprise",
      status: "APPROVED_FOR_EXPERIMENT",
      grantId,
      createdAt: "2026-09-06T10:00:00.000Z",
      expiresAt: "2027-09-07T00:00:00.000Z",
    });
    setEvolutionControlPlaneForTests(plane);
    const handlers = createEvolutionControlHandlers(() => plane);
    const denied = await invoke(
      handlers["evolution.experiments.create"],
      {
        commandId: "cmd-exp-expired-grant",
        proposalId: "evo:wdna-expired-grant",
        freeze: freeze("cand:wdna-expired"),
      },
      clientFor(TENANT_A),
    );
    expect(denied.ok).toBe(false);
    expect(denied.error?.message).toMatch(/expired|not approved|grant/i);
  });
});

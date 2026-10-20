import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  configDir: "",
  assertClientMayAccessAgentDetailed: vi.fn(),
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: hoisted.configDir,
  };
});

vi.mock("../server-methods/operator-access.js", () => ({
  assertClientMayAccessAgentDetailed: hoisted.assertClientMayAccessAgentDetailed,
}));

import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { readRobotWorkingStyle } from "../agent-growth/working-style-store.js";
import { proposeWorkingDnaFromObservation } from "../pattern-detection/working-dna-proposal.js";
import {
  createEvolutionControlHandlers,
  setEvolutionControlPlaneForTests,
} from "../server-methods/evolution-control.js";
import type { GatewayClient, GatewayRequestHandler } from "../server-methods/types.js";
import { setEvolutionApplyAuthPortsForTests } from "./apply-authorization.js";
import { resetEvolutionControlPlaneForTests } from "./bootstrap.js";
import {
  getSharedDiagnosisDelegationMachine,
  resetSharedDiagnosisDelegationForTests,
} from "./delegation-service.js";
import {
  approveEvolutionGrant,
  evolutionGrantActorFromPrincipal,
  requestEvolutionWorkingDnaGrant,
} from "./evolution-grant.js";
import { createGatewayEvolutionControlPlane } from "./gateway-plane.js";
import {
  resetEvolutionObservationIndexForTests,
  writeEvolutionObservationAudit,
} from "./observation-audit.js";
import {
  issueRuntimeOwnershipProof,
  resetRuntimeOwnershipProofsForTests,
} from "./runtime-ownership-proof.js";
import { testObservation } from "./test-support.js";

const TENANT = "tenant-fixture-a";
const AGENT_ID = "wdna-chain-bot";
const RUN_ID = "run-governance-chain";
const OWNERSHIP_SECRET = "test-evolution-ownership-secret";

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  let testCfg: OpenBotConfig | undefined;
  return {
    ...actual,
    loadConfig: () => testCfg ?? actual.loadConfig(),
    __setTestConfig: (cfg: OpenBotConfig) => {
      testCfg = cfg;
    },
    __clearTestConfig: () => {
      testCfg = undefined;
    },
  };
});

const configModule = await import("../../config/config.js");
const setTestConfig = (
  configModule as typeof configModule & { __setTestConfig: (cfg: OpenBotConfig) => void }
).__setTestConfig;
const clearTestConfig = (configModule as typeof configModule & { __clearTestConfig: () => void })
  .__clearTestConfig;

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
      scopes: ["operator.approvals"],
    },
    user: "ent-admin",
    platformUserId: "ent-admin",
    sessionKind: "enterprise-admin",
    sessionMembershipId: "membership-ent-admin",
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
    tenantScope: TENANT,
    confidentialityScope: "enterprise" as const,
    expiresAt: "2027-09-07T00:00:00.000Z",
    maxResourceBudget: 1,
  };
}

function issueApprovedGrant(persistDir: string, proposalId: string): string {
  resetSharedDiagnosisDelegationForTests();
  const machine = getSharedDiagnosisDelegationMachine(persistDir);
  const issuer = evolutionGrantActorFromPrincipal(
    { schemaVersion: 1, principalId: "platform-evolution", kind: "service", tenantId: null },
    "platform",
  );
  const enterprise = evolutionGrantActorFromPrincipal(
    { schemaVersion: 1, principalId: "ent-admin", kind: "user", tenantId: TENANT },
    "enterprise",
  );
  const requested = requestEvolutionWorkingDnaGrant({
    machine,
    commandId: "cmd-chain-grant-req",
    trusted: { tenantId: TENANT },
    issuer,
    approver: enterprise,
    grantee: enterprise,
    tenantId: TENANT,
    agentId: AGENT_ID,
    proposalId,
    evidenceRefs: [`obs:${RUN_ID}`],
    expiresAt: "2027-09-07T00:00:00.000Z",
  });
  approveEvolutionGrant({
    machine,
    commandId: "cmd-chain-grant-appr",
    trusted: { tenantId: TENANT },
    approver: enterprise,
    grantId: requested.grantId,
  });
  return requested.grantId;
}

describe("working-dna governance chain apply → verify → promote → rollback", () => {
  let tmpDir = "";
  let persistDir = "";
  let cfg: OpenBotConfig;
  let audit: Record<string, unknown>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-wdna-chain-"));
    hoisted.configDir = tmpDir;
    persistDir = path.join(tmpDir, "evolution-control");
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
    setTestConfig(cfg);
    audit = { runId: RUN_ID, tenantId: TENANT, agentId: AGENT_ID };
    process.env.OPENBOT_EVOLUTION_OWNERSHIP_PROOF_SECRET = OWNERSHIP_SECRET;
    hoisted.assertClientMayAccessAgentDetailed.mockImplementation(async (_client, agentId) => ({
      agentId,
      tenantId: TENANT,
      userId: "ent-admin",
    }));
    resetEvolutionControlPlaneForTests();
    resetSharedDiagnosisDelegationForTests();
    resetEvolutionObservationIndexForTests();
    resetRuntimeOwnershipProofsForTests();
    setEvolutionApplyAuthPortsForTests({
      async resolveActor() {
        return {
          sessionKind: "enterprise-admin",
          membershipRole: "enterprise-admin",
          tenantId: TENANT,
          userId: "ent-admin",
        };
      },
      async resolveObject() {
        return {
          tenantId: TENANT,
          targetId: `agent:${AGENT_ID}`,
          objectKind: "enterprise",
          ownerUserId: null,
        };
      },
      async resolveGrant() {
        return null;
      },
    });
  });

  afterEach(async () => {
    setEvolutionControlPlaneForTests(undefined);
    resetEvolutionControlPlaneForTests();
    resetSharedDiagnosisDelegationForTests();
    resetEvolutionObservationIndexForTests();
    resetRuntimeOwnershipProofsForTests();
    setEvolutionApplyAuthPortsForTests();
    clearTestConfig();
    delete process.env.OPENBOT_EVOLUTION_OWNERSHIP_PROOF_SECRET;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("runs grant → proposal → experiment → apply(canary) → verify-effect → evaluate-promote → rollback", async () => {
    writeEvolutionObservationAudit({
      runId: RUN_ID,
      agentId: AGENT_ID,
      tenantId: TENANT,
      surfaceId: "pattern-detection.sample",
      source: "pattern-detection.ingest-sample",
      ownershipProof: `binding:${RUN_ID}:v1`,
      attributionSource: "binding",
      inputStructureHash: "in-chain",
      outputStructureHash: "out-chain",
      persistDir,
    });

    const proposalId = `evo:wdna:${RUN_ID}`;
    const grantId = issueApprovedGrant(persistDir, proposalId);
    audit.grantRef = grantId;

    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      observationProvider: testObservation(),
    });

    const proposed = await proposeWorkingDnaFromObservation({
      commandId: "cmd-chain-propose",
      tenantId: TENANT,
      agentId: AGENT_ID,
      grantId,
      runId: RUN_ID,
      evidenceRefs: [`obs:${RUN_ID}`],
      persistDir,
      cfg,
      plane,
    });
    expect("skipped" in proposed).toBe(false);
    if ("skipped" in proposed && proposed.skipped) {
      throw new Error(proposed.reason);
    }
    audit.proposalId = proposed.proposal.proposalId;
    audit.candidateRef = proposed.candidateRef;

    setEvolutionControlPlaneForTests(plane);
    const handlers = createEvolutionControlHandlers(() => plane);
    const ownershipProof = issueRuntimeOwnershipProof({
      runId: RUN_ID,
      agentId: AGENT_ID,
      tenantId: TENANT,
      secret: OWNERSHIP_SECRET,
      persistDir,
    })?.token;

    const experimentRes = await invoke(
      handlers["evolution.experiments.create"],
      {
        commandId: "cmd-chain-exp",
        proposalId,
        freeze: freeze(proposed.candidateRef),
      },
      clientFor(TENANT),
    );
    expect(experimentRes.ok).toBe(true);
    const experimentId = (experimentRes.payload as { experiment: { experimentId: string } })
      .experiment.experimentId;
    audit.experimentId = experimentId;

    await plane.evaluateExperiment(experimentId);

    const beforeStyle = await readRobotWorkingStyle(cfg, AGENT_ID);
    audit.beforeState = beforeStyle?.riskPreference ?? DEFAULT_WORKING_STYLE.riskPreference;

    const applied = await invoke(
      handlers["evolution.applications.apply"],
      {
        commandId: "cmd-chain-apply",
        proposalId,
        experimentId,
        scope: "canary",
      },
      clientFor(TENANT),
    );
    expect(applied.ok).toBe(true);
    const applicationId = (applied.payload as { application: { applicationId: string } })
      .application.applicationId;
    audit.applicationId = applicationId;

    const afterApply = await readRobotWorkingStyle(cfg, AGENT_ID);
    expect(afterApply?.reportingCadence).toBe("milestone");
    audit.afterApplyState = afterApply?.reportingCadence;

    const verified = await invoke(
      handlers["evolution.working-dna.verify-effect"],
      {
        commandId: "cmd-chain-verify",
        agentId: AGENT_ID,
        runId: RUN_ID,
        ownershipProof,
        field: "reportingCadence",
        expectedValue: "milestone",
      },
      clientFor(TENANT),
    );
    expect(verified.ok).toBe(true);
    expect(
      (verified.payload as { verification: { result: string; outcome: string } }).verification
        .result,
    ).toBe("verified");
    audit.verifierId = (
      verified.payload as { verification: { verifierId: string } }
    ).verification.verifierId;

    const promote = await invoke(
      handlers["evolution.working-dna.evaluate-promote"],
      {
        commandId: "cmd-chain-promote",
        agentId: AGENT_ID,
        runId: RUN_ID,
        ownershipProof,
      },
      clientFor(TENANT),
    );
    expect(promote.ok).toBe(true);
    expect((promote.payload as { gate: { ok: boolean } }).gate.ok).toBe(true);
    audit.promoteResult = (promote.payload as { gate: { ok: boolean } }).gate;

    const rolled = await invoke(
      handlers["evolution.applications.rollback"],
      {
        commandId: "cmd-chain-rollback",
        applicationId,
      },
      clientFor(TENANT),
    );
    expect(rolled.ok).toBe(true);
    audit.rollbackResult = (
      rolled.payload as { application: { status: string } }
    ).application.status;

    const afterRollback = await readRobotWorkingStyle(cfg, AGENT_ID);
    expect(afterRollback?.reportingCadence).toBe(DEFAULT_WORKING_STYLE.reportingCadence);
    audit.afterRollbackState = afterRollback?.reportingCadence;

    expect(audit).toMatchObject({
      runId: RUN_ID,
      tenantId: TENANT,
      agentId: AGENT_ID,
      proposalId,
      candidateRef: proposed.candidateRef,
      grantRef: grantId,
      experimentId: expect.any(String),
      applicationId: expect.any(String),
      verifierId: expect.any(String),
      promoteResult: { ok: true },
      rollbackResult: "rolled_back",
    });
  });
});

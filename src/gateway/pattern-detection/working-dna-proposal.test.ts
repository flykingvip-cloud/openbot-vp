import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { resetEvolutionControlPlaneForTests } from "../evolution-control/bootstrap.js";
import {
  getSharedDiagnosisDelegationMachine,
  resetSharedDiagnosisDelegationForTests,
} from "../evolution-control/delegation-service.js";
import {
  approveEvolutionGrant,
  evolutionGrantActorFromPrincipal,
  requestEvolutionWorkingDnaGrant,
} from "../evolution-control/evolution-grant.js";
import { createGatewayEvolutionControlPlane } from "../evolution-control/gateway-plane.js";
import {
  resetEvolutionObservationIndexForTests,
  writeEvolutionObservationAudit,
} from "../evolution-control/observation-audit.js";
import { testObservation } from "../evolution-control/test-support.js";
import { resetPatternDetectionStoreForTests } from "./index.js";
import { proposeWorkingDnaFromObservation } from "./working-dna-proposal.js";

const TENANT = "tenant-fixture-a";
const AGENT_ID = "wdna-proposal-bot";

function issueApprovedGrant(persistDir: string): string {
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
    commandId: "cmd-proposal-grant-req",
    trusted: { tenantId: TENANT },
    issuer,
    approver: enterprise,
    grantee: enterprise,
    tenantId: TENANT,
    agentId: AGENT_ID,
    evidenceRefs: ["ev-proposal"],
    expiresAt: "2027-09-07T00:00:00.000Z",
  });
  approveEvolutionGrant({
    machine,
    commandId: "cmd-proposal-grant-appr",
    trusted: { tenantId: TENANT },
    approver: enterprise,
    grantId: requested.grantId,
  });
  return requested.grantId;
}

describe("working-dna proposal from operational observation", () => {
  let tmpDir = "";
  let persistDir = "";
  let cfg: OpenBotConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-wdna-proposal-"));
    persistDir = path.join(tmpDir, "control");
    cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
    resetEvolutionControlPlaneForTests();
    resetSharedDiagnosisDelegationForTests();
    resetEvolutionObservationIndexForTests();
    resetPatternDetectionStoreForTests();
  });

  afterEach(async () => {
    resetEvolutionControlPlaneForTests();
    resetSharedDiagnosisDelegationForTests();
    resetEvolutionObservationIndexForTests();
    resetPatternDetectionStoreForTests();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates an agent.working-dna proposal from a real observation signal", async () => {
    const runId = "run-proposal-ok";
    writeEvolutionObservationAudit({
      runId,
      agentId: AGENT_ID,
      tenantId: TENANT,
      surfaceId: "pattern-detection.sample",
      source: "pattern-detection.ingest-sample",
      ownershipProof: "binding:run-proposal-ok:v1",
      attributionSource: "binding",
      inputStructureHash: "in-proposal",
      outputStructureHash: "out-proposal",
      persistDir,
    });
    const grantId = issueApprovedGrant(persistDir);
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      observationProvider: testObservation(),
    });
    const result = await proposeWorkingDnaFromObservation({
      commandId: "cmd-propose-ok",
      tenantId: TENANT,
      agentId: AGENT_ID,
      grantId,
      runId,
      evidenceRefs: [`obs:${runId}`],
      persistDir,
      cfg,
      plane,
    });
    expect("skipped" in result).toBe(false);
    if ("skipped" in result && result.skipped) {
      throw new Error(`unexpected skip: ${result.reason}`);
    }
    expect(result.proposal.surfaceId).toBe("agent.working-dna");
    expect(result.proposal.proposalId).toBe(`evo:wdna:${runId}`);
    expect(result.proposal.grantId).toBe(grantId);
    expect(result.proposal.tenantScope).toBe(TENANT);
    expect(result.proposal.expectedEffects.length).toBeGreaterThan(0);
    expect(plane.getProposal(result.proposal.proposalId)?.surfaceId).toBe("agent.working-dna");
  });

  it("skips proposal creation when no observation exists for the runId", async () => {
    const grantId = issueApprovedGrant(persistDir);
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      observationProvider: testObservation(),
    });
    const result = await proposeWorkingDnaFromObservation({
      commandId: "cmd-propose-skip",
      tenantId: TENANT,
      agentId: AGENT_ID,
      grantId,
      runId: "run-no-observation",
      evidenceRefs: ["obs:missing"],
      persistDir,
      cfg,
      plane,
    });
    expect(result).toEqual({ skipped: true, reason: "no observation for runId" });
    expect(plane.listProposals()).toHaveLength(0);
  });

  it("fail-closes when grant tenant does not match observation tenant", async () => {
    writeEvolutionObservationAudit({
      runId: "run-tenant-mismatch",
      agentId: AGENT_ID,
      tenantId: TENANT,
      surfaceId: "pattern-detection.sample",
      source: "pattern-detection.ingest-sample",
      ownershipProof: "binding:run-tenant-mismatch:v1",
      attributionSource: "binding",
      persistDir,
    });
    const grantId = issueApprovedGrant(persistDir);
    const plane = createGatewayEvolutionControlPlane({
      cfg,
      persistDir,
      observationProvider: testObservation(),
    });
    await expect(
      proposeWorkingDnaFromObservation({
        commandId: "cmd-propose-tenant-mismatch",
        tenantId: "tenant-fixture-b",
        agentId: AGENT_ID,
        grantId,
        runId: "run-tenant-mismatch",
        evidenceRefs: ["obs:run-tenant-mismatch"],
        persistDir,
        cfg,
        plane,
      }),
    ).rejects.toThrow(/tenant|grant/i);
  });
});

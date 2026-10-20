/**
 * P1-3: capability-gap system grant is expire-only for stale DISCOVERED gaps.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { organizationMetricSet } from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { createEvolutionControlHandlers } from "../server-methods/evolution-control.js";
import type { GatewayClient, GatewayRequestHandler } from "../server-methods/types.js";
import { resetEvolutionControlPlaneForTests } from "./bootstrap.js";
import {
  configureCapabilityGapConsumer,
  resetCapabilityGapConsumerConfigForTests,
  runCapabilityGapConsumerTick,
} from "./capability-gap-consumer.js";
import {
  CAPABILITY_GAP_ALLOWED_ACTIONS,
  ensureCapabilityGapSystemGrant,
  evaluateCapabilityGapSystemGrantAction,
} from "./capability-gap-grant.js";
import {
  recordCapabilityGapEvent,
  resetCapabilityGapDedupForTests,
} from "./capability-gap-ingest.js";
import {
  getSharedDiagnosisDelegationMachine,
  resetSharedDiagnosisDelegationForTests,
} from "./delegation-service.js";
import { resetEvolutionLoopLogsForTests } from "./evolution-loop-log.js";
import { createGatewayEvolutionControlPlane } from "./gateway-plane.js";
import { setEvolutionRpcTestIdentityForTests } from "./rpc-test-identity.js";

const TENANT = "tenant-expire-scope";
const AGENT = "bot-expire-scope";

function clientFor(tenantId: string): GatewayClient {
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 3,
      client: {
        id: "openbot-control-ui",
        version: "1",
        platform: "web",
        mode: "webchat",
      },
    },
    user: "ent-admin",
    sessionEnterpriseId: tenantId,
    sessionTenantId: tenantId,
  } as GatewayClient;
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

describe("capability-gap system grant expire-only scope", () => {
  let persistDir = "";
  const tempDirs: string[] = [];

  beforeEach(async () => {
    resetEvolutionLoopLogsForTests();
    resetCapabilityGapDedupForTests();
    resetCapabilityGapConsumerConfigForTests();
    resetSharedDiagnosisDelegationForTests();
    resetEvolutionControlPlaneForTests();
    setEvolutionRpcTestIdentityForTests({
      user: "ent-admin",
      platformUserId: "ent-admin",
      sessionKind: "enterprise-admin",
      sessionMembershipId: "mem-1",
      sessionEnterpriseId: TENANT,
    });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-gap-expire-"));
    tempDirs.push(root);
    persistDir = path.join(root, "control");
    await fs.mkdir(persistDir, { recursive: true });
  });

  afterEach(async () => {
    setEvolutionRpcTestIdentityForTests();
    resetSharedDiagnosisDelegationForTests();
    resetEvolutionControlPlaneForTests();
    await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  it("grant allows only suggest+expire", () => {
    expect([...CAPABILITY_GAP_ALLOWED_ACTIONS]).toEqual(["suggest", "expire"]);
  });

  it("authority layer refuses reject; expire requires stale DISCOVERED capability-gap", () => {
    const grantId = `grant:capability-gap:system:${TENANT}`;
    expect(
      evaluateCapabilityGapSystemGrantAction({
        grantId,
        requestedAction: "reject",
        proposal: {
          status: "SUGGESTED",
          sourceMechanismRef: "capability-gap:skill",
          expiresAt: "2000-01-01T00:00:00.000Z",
          grantId,
        },
      }).ok,
    ).toBe(false);

    expect(
      evaluateCapabilityGapSystemGrantAction({
        grantId,
        requestedAction: "expire",
        proposal: {
          status: "DISCOVERED",
          sourceMechanismRef: "capability-gap:skill",
          expiresAt: "2000-01-01T00:00:00.000Z",
          grantId,
        },
        nowMs: Date.parse("2026-01-01T00:00:00.000Z"),
      }).ok,
    ).toBe(true);

    expect(
      evaluateCapabilityGapSystemGrantAction({
        grantId,
        requestedAction: "expire",
        proposal: {
          status: "DISCOVERED",
          sourceMechanismRef: "organization.case",
          expiresAt: "2000-01-01T00:00:00.000Z",
          grantId,
        },
      }).ok,
    ).toBe(false);
  });

  it("RPC reject with system grant is refused; expire sweep still works", async () => {
    const machine = getSharedDiagnosisDelegationMachine(persistDir);
    ensureCapabilityGapSystemGrant({ machine, tenantId: TENANT });
    const plane = createGatewayEvolutionControlPlane({
      persistDir,
      cfg: { agents: { list: [] } } as unknown as OpenBotConfig,
    });
    configureCapabilityGapConsumer({ explicitMarkerThreshold: 1 });

    const stale = recordCapabilityGapEvent({
      plane,
      persistDir,
      agentId: AGENT,
      tenantId: TENANT,
      category: "skill",
      reason: "expire_scope_marker",
      explicitMarker: true,
      sourceKind: "marker",
      dedupWindowMs: 0,
      nowMs: Date.parse("2020-01-01T00:00:00.000Z"),
    });
    expect(stale.proposal?.status).toBe("DISCOVERED");

    const expired = plane.expireProposal({
      commandId: `gap-expire-test:${stale.proposalId}`,
      proposalId: stale.proposalId!,
      principalRef: "system:capability-gap-consumer",
      trustedTenantId: TENANT,
    });
    expect(expired.status).toBe("EXPIRED");

    const fresh = recordCapabilityGapEvent({
      plane,
      persistDir,
      agentId: AGENT,
      tenantId: TENANT,
      category: "skill",
      reason: "reject_scope_marker",
      explicitMarker: true,
      sourceKind: "marker",
      dedupWindowMs: 0,
    });
    runCapabilityGapConsumerTick({ plane, persistDir });
    expect(plane.getProposal(fresh.proposalId!)?.status).toBe("SUGGESTED");

    const handlers = createEvolutionControlHandlers(() => plane);
    const rejected = await invoke(
      handlers["evolution.proposals.transition"],
      {
        commandId: "cmd-reject-system-grant",
        proposalId: fresh.proposalId!,
        command: "reject",
      },
      clientFor(TENANT),
    );
    expect(rejected.ok).toBe(false);
    expect(String(rejected.error?.message ?? "")).toMatch(
      /cannot reject|expire-only|system grant|does not allow/i,
    );
    expect(plane.getProposal(fresh.proposalId!)?.status).toBe("SUGGESTED");
  });

  it("system grant cannot expire a non-capability-gap proposal", async () => {
    const machine = getSharedDiagnosisDelegationMachine(persistDir);
    const ensured = ensureCapabilityGapSystemGrant({ machine, tenantId: TENANT });
    const plane = createGatewayEvolutionControlPlane({
      persistDir,
      cfg: { agents: { list: [] } } as unknown as OpenBotConfig,
    });
    const metrics = organizationMetricSet();
    plane.registerProposal({
      schemaVersion: 2,
      proposalId: "evo:org-forged",
      sourceEvidenceRefs: [],
      sourceMechanismRef: "organization.case",
      target: { domain: "organization", groupId: "g1" },
      candidateRef: "cand:org-forged",
      surfaceId: "organization.task-routing",
      expectedEffects: [metrics.primary],
      riskLevel: "low",
      confidentialityScope: "enterprise",
      tenantScope: TENANT,
      grantId: ensured.grantId,
      status: "DISCOVERED",
      createdAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    expect(() =>
      plane.expireProposal({
        commandId: "cmd-expire-forged",
        proposalId: "evo:org-forged",
        principalRef: "system:capability-gap-consumer",
        trustedTenantId: TENANT,
      }),
    ).toThrow(/capability-gap/);
    expect(plane.getProposal("evo:org-forged")?.status).toBe("DISCOVERED");
  });
});

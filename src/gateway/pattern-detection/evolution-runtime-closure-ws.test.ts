/**
 * Live Gateway WebSocket e2e for evolution-runtime-closure Phase 5.1.
 *
 * Proves: real WS connect → rpcReq → handler → pattern/governance stores.
 * Membership is stubbed (token auth has no platform-auth user); agent ownership
 * is seeded via agent-runtime-store so ACL gates behave like a unique-owner tenant.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertAgent } from "../agent-runtime-store.js";
import { setGovernanceKillSwitch } from "../evolution-governance/index.js";
import { connectOk, installGatewayTestHooks, rpcReq } from "../test-helpers.js";
import { withServer } from "../test-with-server.js";
import {
  listPatternCandidates,
  resetPatternDetectionStoreForTests,
  structureHashFromText,
} from "./index.js";

vi.mock("../tenant-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...actual,
    resolveAuthoritativeMembership: async () => ({
      tenantId: "tenant-a",
      userId: "user-a",
    }),
  };
});

installGatewayTestHooks({ scope: "suite" });

function seedOwnedAgent(runtimeAgentId: string) {
  const now = Date.now();
  upsertAgent({
    runtimeAgentId,
    name: runtimeAgentId,
    runtimeVersion: "1",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: ["tenant-a"],
    boundCapabilityCount: 1,
    activeSessionCount: 0,
    resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
    deployedAt: now,
    lastActiveAt: now,
  });
}

describe("evolution-runtime-closure live gateway WS", () => {
  beforeEach(() => {
    resetPatternDetectionStoreForTests();
    setGovernanceKillSwitch(false);
    seedOwnedAgent("agent-a");
    seedOwnedAgent("agent-b");
  });

  it("routes ingest → apply-limit → apply-redirect → snapshot over WebSocket", async () => {
    await withServer(async (ws) => {
      await connectOk(ws, {
        token: "secret",
        scopes: ["operator.admin", "operator.write", "operator.approvals"],
      });

      const inHash = structureHashFromText("# ws ingest\n1. a");
      const outHash = structureHashFromText("# ws out\n- ok");
      for (let i = 1; i <= 3; i += 1) {
        const ingest = await rpcReq<{ candidateId?: string; sampleCount?: number }>(
          ws,
          "pattern-detection.ingest-sample",
          {
            agentId: "agent-a",
            runId: `ws-run-${i}`,
            taskId: `ws-task-${i}`,
            inputStructureHash: inHash,
            outputStructureHash: outHash,
            toolsUsed: ["notes"],
            success: true,
          },
        );
        expect(ingest.ok).toBe(true);
      }

      const candidates = listPatternCandidates({ agentId: "agent-a", tenantId: "tenant-a" });
      expect(candidates[0]?.contract.toolsRequired).toEqual(["notes"]);

      const limit = await rpcReq<{ ok?: boolean }>(ws, "evolution-governance.apply-limit", {
        runtimeAgentId: "agent-a",
        reason: "ws-e2e-limit",
      });
      expect(limit.ok).toBe(true);
      expect(limit.payload?.ok).toBe(true);

      const redirect = await rpcReq<{ ok?: boolean }>(ws, "evolution-governance.apply-redirect", {
        runtimeAgentId: "agent-a",
        targetAgentId: "agent-b",
        reason: "ws-e2e-redirect",
      });
      expect(redirect.ok).toBe(true);
      expect(redirect.payload?.ok).toBe(true);

      const snapshot = await rpcReq<{
        limits?: Record<string, unknown>;
        redirects?: Record<string, { targetAgentId?: string }>;
      }>(ws, "evolution-governance.snapshot", {});
      expect(snapshot.ok).toBe(true);
      expect(snapshot.payload?.limits?.["agent-a"]).toBeTruthy();
      expect(snapshot.payload?.redirects?.["agent-a"]?.targetAgentId).toBe("agent-b");
    });
  }, 60_000);

  it("rejects approve without operator.approvals over WebSocket", async () => {
    await withServer(async (ws) => {
      await connectOk(ws, {
        token: "secret",
        scopes: ["operator.write"],
      });
      const res = await rpcReq(ws, "pattern-detection.approve", {
        candidateId: "pc_missing",
        agentId: "agent-a",
      });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("operator.approvals");
    });
  }, 60_000);
});

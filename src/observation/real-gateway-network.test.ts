/** Real gateway WebSocket chain with isolated test identity ports; not production authentication. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { startGatewayServerHarness } from "../gateway/server.e2e-ws-harness.js";
import { installGatewayTestHooks, rpcReq } from "../gateway/test-helpers.js";
const isolated = vi.hoisted(() => ({
  cfg: {} as OpenBotConfig,
  tenant: "tenant",
  calls: 0,
  membershipCalls: 0,
  revoked: false,
  revokeOnRead: false,
}));
vi.mock("./query-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query-gateway.js")>();
  return {
    ...actual,
    createObservationQueryHandlers: () => {
      const handlers = actual.createObservationQueryHandlers({
        loadConfig: () => isolated.cfg,
        authDeps: {
          resolveMembership: async () => {
            isolated.membershipCalls++;
            if (isolated.revoked) {
              throw new Error("revoked");
            }
            if (isolated.revokeOnRead && isolated.membershipCalls > 1) {
              isolated.revoked = true;
              throw new Error("revoked");
            }
            return { tenantId: isolated.tenant, userId: "alice" };
          },
        },
      });
      return {
        [actual.OBSERVATION_QUERY_METHOD]: async (
          ctx: Parameters<(typeof handlers)[string]>[0],
        ) => {
          isolated.calls++;
          if (ctx.client) {
            ctx.client.platformUserId = "alice";
            ctx.client.sessionDomain = "enterprise";
          }
          await handlers[actual.OBSERVATION_QUERY_METHOD](ctx);
        },
      };
    },
  };
});

import { resetEvidenceAssociations } from "../executor-evidence/association.js";
import {
  observeModelCandidate,
  resetModelCallsForTests,
} from "../executor-evidence/model-call-evidence.js";
import {
  chargeModelCallAgainstTip,
  recordRunnerTurnOutcome,
  type ModelCallCloseoutLink,
} from "../task-outcome/runtime-from-runner.js";
installGatewayTestHooks();
let root = "";
afterEach(() => {
  resetModelCallsForTests();
  resetEvidenceAssociations();
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
    root = "";
  }
});
async function seed(enabled: boolean) {
  process.env.OPENBOT_EXECUTOR_EVIDENCE = enabled ? "1" : "0";
  root = fs.mkdtempSync(path.join(os.tmpdir(), "observation-ws-"));
  isolated.cfg = { agents: { list: [{ id: "bot", agentDir: root, workspace: root }] } };
  const scope = {
    kind: "enterprise" as const,
    enterpriseDomainId: "domain",
    tenantId: "tenant",
    subjectRef: "subject:alice",
    authzScopeRef: "test-auth",
  };
  let link: ModelCallCloseoutLink | null = null;
  await observeModelCandidate({
    context: {
      agentId: "bot",
      scope,
      taskId: "task",
      runId: "run",
      storeRoot: path.join(root, "task-outcomes"),
      provenance: "injected",
      collector: "network-isolation",
    },
    attemptIndex: 0,
    provider: "isolated",
    model: "fake",
    run: async () => {
      const charge = chargeModelCallAgainstTip(isolated.cfg, "bot", {
        taskId: "task",
        scope,
        runId: "run",
        callSeq: 1,
        usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
        budgetLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
      });
      link = charge.modelCallLink;
      return "test";
    },
  });
  const closed = await recordRunnerTurnOutcome(isolated.cfg, "bot", {
    taskId: "task",
    scope,
    runId: "run",
    success: true,
    skipBudgetCharge: true,
    modelCallLink: link,
    acceptance: { status: "passed" },
    delivery: { status: "delivered" },
    deliveryId: "test-delivery",
  });
  resetModelCallsForTests();
  resetEvidenceAssociations();
  return {
    agentId: "bot",
    taskId: "task",
    outcomeVersion: closed.record.outcomeVersion,
    from: Date.now() - 60000,
    to: Date.now(),
  };
}
describe("real gateway WebSocket observation with test identity ports", () => {
  it.each([true, false])(
    "reads real ResultService disk evidence (collection=%s), denies cross-scope and revocation",
    async (enabled) => {
      const params = await seed(enabled);
      isolated.tenant = "tenant";
      isolated.revoked = false;
      isolated.revokeOnRead = false;
      isolated.calls = 0;
      isolated.membershipCalls = 0;
      expect(process.env.OPENCLAW_SKIP_CHANNELS).toBe("1");
      expect(process.env.OPENCLAW_SKIP_CRON).toBe("1");
      const harness = await startGatewayServerHarness();
      const { ws } = await harness.openClient({ scopes: ["operator.read"] });
      try {
        const response = await rpcReq(ws, "diagnosis.observation.query", params, 15000);
        expect(isolated.calls).toBeGreaterThan(0);
        expect(response.ok).toBe(true);
        const payload = response.payload as {
          executorTechnicalEvidence: {
            calls: { provenance: string }[];
            runTotalCost: null;
            state: string;
          };
        };
        expect(payload.executorTechnicalEvidence.calls).toHaveLength(enabled ? 1 : 0);
        expect(payload.executorTechnicalEvidence.runTotalCost).toBeNull();
        if (enabled) {
          expect(payload.executorTechnicalEvidence.calls[0].provenance).toBe("injected");
        } else {
          expect(payload.executorTechnicalEvidence.state).toBe("unknown");
        }
        expect(JSON.stringify(payload)).not.toContain("test-auth");
        isolated.tenant = "foreign";
        const denied = await rpcReq(ws, "diagnosis.observation.query", params, 15000);
        expect(denied.ok).toBe(false);
        expect(denied.payload).toBeUndefined();
        isolated.tenant = "tenant";
        isolated.membershipCalls = 0;
        isolated.revokeOnRead = true;
        const revoked = await rpcReq(ws, "diagnosis.observation.query", params, 15000);
        expect(revoked.ok).toBe(false);
        expect(revoked.payload).toBeUndefined();
      } finally {
        ws.close();
        await harness.close();
      }
    },
    90000,
  );
});

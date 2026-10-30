/**
 * P2-H strongest feasible delivery evidence without live webhook/HTTP:
 * dispatchCronDelivery → deliverOutboundPayloads (mocked adapter) → delivered flag
 * → CronService persists lastDeliveryStatus. Not a claim of live channel delivery.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../agents/subagent-registry.js", () => ({
  countActiveDescendantRuns: vi.fn().mockReturnValue(0),
}));

vi.mock("../infra/outbound/deliver.js", () => ({
  deliverOutboundPayloads: vi.fn(),
}));

vi.mock("../infra/outbound/identity.js", () => ({
  resolveAgentOutboundIdentity: vi.fn().mockReturnValue({}),
}));

vi.mock("../infra/outbound/session-context.js", () => ({
  buildOutboundSessionContext: vi.fn().mockReturnValue({}),
}));

vi.mock("../cli/outbound-send-deps.js", () => ({
  createOutboundSendDeps: vi.fn().mockReturnValue({}),
}));

vi.mock("../logger.js", () => ({
  logWarn: vi.fn(),
}));

vi.mock("./isolated-agent/subagent-followup.js", () => ({
  expectsSubagentFollowup: vi.fn().mockReturnValue(false),
  isLikelyInterimCronMessage: vi.fn().mockReturnValue(false),
  readDescendantSubagentFallbackReply: vi.fn().mockResolvedValue(undefined),
  waitForDescendantSubagentSummary: vi.fn().mockResolvedValue(undefined),
}));

import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { dispatchCronDelivery } from "./isolated-agent/delivery-dispatch.js";
import type { DeliveryTargetResolution } from "./isolated-agent/delivery-target.js";
import type { RunCronAgentTurnResult } from "./isolated-agent/run.js";
import { CronService } from "./service.js";
import {
  createFinishedBarrier,
  createCronStoreHarness,
  createNoopLogger,
  installCronTestHooks,
} from "./service.test-harness.js";

const noopLogger = createNoopLogger();
const { makeStorePath } = createCronStoreHarness();
installCronTestHooks({ logger: noopLogger });

function makeResolvedDelivery(): Extract<DeliveryTargetResolution, { ok: true }> {
  return {
    ok: true,
    channel: "slack",
    to: "channel:C-P2H",
    accountId: undefined,
    threadId: undefined,
    mode: "explicit",
  };
}

function makeDispatchParams() {
  const resolvedDelivery = makeResolvedDelivery();
  return {
    cfg: {} as never,
    cfgWithAgentDefaults: {} as never,
    deps: {} as never,
    job: {
      id: "p2h-job",
      name: "P2-H Evidence",
      deleteAfterRun: false,
      payload: { kind: "agentTurn", message: "deliver me" },
      delivery: { mode: "announce", channel: "slack", to: "channel:C-P2H" },
    } as never,
    agentId: "main",
    agentSessionKey: "agent:main",
    runSessionId: "run-p2h",
    runStartedAt: Date.now(),
    runEndedAt: Date.now(),
    timeoutMs: 30_000,
    resolvedDelivery,
    deliveryRequested: true,
    skipHeartbeatDelivery: false,
    deliveryBestEffort: false,
    deliveryPayloadHasStructuredContent: false,
    deliveryPayloads: [{ text: "cron delivery evidence" }],
    synthesizedText: "cron delivery evidence",
    summary: "cron delivery evidence",
    outputText: "cron delivery evidence",
    telemetry: undefined,
    abortSignal: undefined,
    isAborted: () => false,
    abortReason: () => "aborted",
    withRunSession: (
      result: Omit<RunCronAgentTurnResult, "sessionId" | "sessionKey">,
    ): RunCronAgentTurnResult => ({
      ...result,
      sessionId: "sess-p2h",
      sessionKey: "agent:main",
    }),
  };
}

describe("P2-H delivery adapter evidence (no live HTTP)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENCLAW_TEST_FAST", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("dispatchCronDelivery marks delivered only after deliverOutboundPayloads returns results", async () => {
    vi.mocked(deliverOutboundPayloads).mockResolvedValueOnce([{ ok: true, messageId: "m1" }]);
    const state = await dispatchCronDelivery(makeDispatchParams());
    expect(deliverOutboundPayloads).toHaveBeenCalledTimes(1);
    const call = vi.mocked(deliverOutboundPayloads).mock.calls[0]?.[0];
    expect(call).toMatchObject({
      channel: "slack",
      to: "channel:C-P2H",
    });
    expect(state.delivered).toBe(true);
    expect(state.deliveryAttempted).toBe(true);

    vi.mocked(deliverOutboundPayloads).mockResolvedValueOnce([]);
    const empty = await dispatchCronDelivery(makeDispatchParams());
    expect(empty.delivered).toBe(false);
    expect(empty.deliveryAttempted).toBe(true);
  });

  it("CronService persists lastDeliveryStatus from adapter-derived delivered flag", async () => {
    vi.mocked(deliverOutboundPayloads).mockResolvedValueOnce([{ ok: true }]);
    const dispatchState = await dispatchCronDelivery(makeDispatchParams());
    expect(dispatchState.delivered).toBe(true);

    const store = await makeStorePath();
    const finished = createFinishedBarrier();
    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      // Isolated runner returns the adapter-derived delivered flag (not a hardcoded true).
      runIsolatedAgentJob: vi.fn(async () => ({
        status: "ok" as const,
        summary: "done",
        delivered: dispatchState.delivered,
      })),
      onEvent: finished.onEvent,
    });

    await cron.start();
    try {
      const job = await cron.add({
        name: "p2h-adapter-persist",
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        payload: { kind: "agentTurn", message: "test" },
        delivery: { mode: "announce", channel: "slack", to: "channel:C-P2H" },
      });
      vi.setSystemTime(new Date(job.state.nextRunAtMs! + 5));
      await vi.runOnlyPendingTimersAsync();
      await finished.waitForOk(job.id);
      const jobs = await cron.list({ includeDisabled: true });
      const updated = jobs.find((entry) => entry.id === job.id);
      expect(updated?.state.lastDelivered).toBe(true);
      expect(updated?.state.lastDeliveryStatus).toBe("delivered");
    } finally {
      cron.stop();
    }
  });
});

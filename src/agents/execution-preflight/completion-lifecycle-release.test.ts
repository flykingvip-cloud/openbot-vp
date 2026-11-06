import "../pi-embedded-runner/run.overflow-compaction.mocks.shared.js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { surfaceCronJobResult } from "../../cron/isolated-agent/result-surfacing.js";
import type { CronJob } from "../../cron/types.js";
import { createGatewayCloseHandler } from "../../gateway/server-close.js";
import { deliverOutboundPayloads } from "../../infra/outbound/deliver.js";
import { resolveAuthProfileOrder } from "../model-auth.js";
import { classifyFailoverReason, isFailoverErrorMessage } from "../pi-embedded-helpers.js";
import { runEmbeddedPiAgent } from "../pi-embedded-runner/run.js";
import { runEmbeddedAttempt } from "../pi-embedded-runner/run/attempt.js";
import { runSubagentAnnounceDispatch } from "../subagent-announce-dispatch.js";
import { deliverSubagentAnnouncement } from "../subagent-announce.js";
import {
  armCompletionHold,
  buildExecutionPreflight,
  finalizeDeliveryContext,
  hasDeliveryContext,
  issueValidationReceipt,
  judgeSessionOutbound,
  noteDeliveryArtifactPath,
  readDeliveryContextMetrics,
  readDeliveryContextSweepActive,
  registerTrustedValidator,
  resetCompletionHoldsForTest,
  resetDeliveryArtifactsForTest,
  resetValidationStateForTest,
  resolveAttemptDelivery,
  startDeliveryContextSweep,
  stopDeliveryContextSweep,
} from "./index.js";

vi.mock("../runtime-plugins.js", () => ({
  ensureRuntimePluginsLoaded: vi.fn(),
}));

vi.mock("../subagent-announce-dispatch.js", () => ({
  runSubagentAnnounceDispatch: vi.fn(async () => ({
    delivered: true,
    path: "direct",
    phases: [],
  })),
}));

vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn(async () => ({ ok: true })),
}));

const { callGateway } = await import("../../gateway/call.js");
const mockedAttempt = vi.mocked(runEmbeddedAttempt);
const sessionKey = "agent:bot-release:main";

function cronJob(agentId = "bot-release"): CronJob {
  return {
    id: "job-release",
    name: "release",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    state: {},
    schedule: { kind: "cron", expr: "15 16 * * *" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "analyze" },
    agentId,
    delivery: { mode: "none", surfaces: ["workbench-agent-main"] },
  };
}

function heldPreflight(taskId: string, sessionId = sessionKey) {
  return buildExecutionPreflight({
    taskId,
    sessionId,
    message: "run sample-task",
    skills: [
      {
        name: "sample-primary",
        frontmatter: {
          "primary-engine": "sample-engine",
          "required-artifacts": "output.bin",
          "required-validators": "sample-validator",
          "delivery-blocked-until": "validator_passed",
          triggers: "sample-task",
          "allowed-tools": "read,write,message",
        },
      },
    ],
    policyToolNames: ["read", "write", "message"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

function armHeld(taskId: string, workspace: string, key = sessionKey) {
  const preflight = heldPreflight(taskId, key);
  noteDeliveryArtifactPath(preflight.taskId, preflight.attemptNumber, "out/output.bin");
  armCompletionHold({
    keys: [key],
    preflight,
    workspaceDir: workspace,
    ttlMs: 15 * 60 * 1000,
    now: Date.now(),
  });
  return preflight;
}

function allowReceipt(taskId: string) {
  issueValidationReceipt({
    result: "passed",
    validatorId: "sample-validator",
    taskId,
    artifactPath: "out/output.bin",
    artifactBytes: "v1",
  });
}

async function sendFinalReply(
  key: string,
  taskId: string | undefined,
  sendTelegram: (to: string, text: string) => Promise<{ messageId: string; chatId: string }>,
) {
  return deliverOutboundPayloads({
    cfg: { channels: { telegram: { botToken: "tok-1" } } },
    channel: "telegram",
    to: "123",
    skipQueue: true,
    payloads: [{ text: "任务已完成" }],
    session: { key },
    ...(taskId ? { taskId } : {}),
    deps: { sendTelegram: async (to, text) => await sendTelegram(to, text) },
  });
}

describe("production delivery context release", () => {
  let workspace = "";

  beforeEach(() => {
    resetCompletionHoldsForTest();
    resetDeliveryArtifactsForTest();
    resetValidationStateForTest();
    vi.mocked(callGateway).mockReset();
    vi.mocked(callGateway).mockResolvedValue({ ok: true });
    vi.mocked(runSubagentAnnounceDispatch).mockReset();
    vi.mocked(runSubagentAnnounceDispatch).mockResolvedValue({
      delivered: true,
      path: "direct",
      phases: [],
    });
    mockedAttempt.mockReset();
    registerTrustedValidator({ id: "sample-validator", version: "1" });
    workspace = mkdtempSync(path.join(tmpdir(), "openbot-release-"));
    mkdirSync(path.join(workspace, "out"), { recursive: true });
    writeFileSync(path.join(workspace, "out/output.bin"), "v1");
  });

  afterEach(() => {
    stopDeliveryContextSweep();
    vi.useRealTimers();
  });

  it("clears context after the final reply transport succeeds", async () => {
    const preflight = armHeld("task-reply", workspace);
    allowReceipt(preflight.taskId);
    const sendTelegram = vi.fn(async () => ({ messageId: "m1", chatId: "123" }));
    await sendFinalReply(sessionKey, preflight.taskId, sendTelegram);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(preflight.taskId)).toBe(false);
    expect(readDeliveryContextMetrics()).toMatchObject({
      retained: 0,
      cleaned: { delivered: 1, failed: 0, cancelled: 0, timeout: 0 },
    });
  });

  it("keeps context when the final reply transport fails", async () => {
    const preflight = armHeld("task-reply-fail", workspace);
    allowReceipt(preflight.taskId);
    const sendTelegram = vi.fn(async () => {
      throw new Error("transport down");
    });
    await expect(sendFinalReply(sessionKey, preflight.taskId, sendTelegram)).rejects.toThrow(
      /transport down/,
    );
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(preflight.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(0);
  });

  it("keeps context when the completion claim is blocked", async () => {
    const preflight = armHeld("task-blocked", workspace);
    const sendTelegram = vi.fn(async () => ({ messageId: "m1", chatId: "123" }));
    await sendFinalReply(sessionKey, preflight.taskId, sendTelegram);
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(hasDeliveryContext(preflight.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(0);
  });

  it("clears context after a cron completion transport succeeds", async () => {
    const preflight = armHeld("task-cron", workspace);
    allowReceipt(preflight.taskId);
    const surfaced = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-release",
      runId: preflight.taskId,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(surfaced).toEqual([sessionKey]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(preflight.taskId)).toBe(false);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(1);
    expect(finalizeDeliveryContext({ taskId: preflight.taskId, outcome: "delivered" })).toBe(false);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(1);
  });

  it("keeps context when cron transport fails and when the claim is blocked", async () => {
    const blocked = armHeld("task-cron-block", workspace);
    const blockedSurface = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-release",
      runId: blocked.taskId,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(blockedSurface).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
    expect(hasDeliveryContext(blocked.taskId)).toBe(true);

    allowReceipt(blocked.taskId);
    vi.mocked(callGateway).mockRejectedValueOnce(new Error("inject failed"));
    const failedSurface = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-release",
      runId: blocked.taskId,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(failedSurface).toEqual([]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(blocked.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(0);
  });

  it("clears context after a subagent announcement transport succeeds", async () => {
    const preflight = armHeld("task-subagent", workspace);
    allowReceipt(preflight.taskId);
    const result = await deliverSubagentAnnouncement({
      requesterSessionKey: sessionKey,
      triggerMessage: "子代理已完成",
      steerMessage: "子代理已完成",
      targetRequesterSessionKey: sessionKey,
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
      directIdempotencyKey: "idem-release",
      taskId: preflight.taskId,
    });
    expect(result.delivered).toBe(true);
    expect(runSubagentAnnounceDispatch).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(preflight.taskId)).toBe(false);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(1);
  });

  it("keeps context when the subagent transport does not deliver", async () => {
    const preflight = armHeld("task-subagent-fail", workspace);
    allowReceipt(preflight.taskId);
    vi.mocked(runSubagentAnnounceDispatch).mockResolvedValueOnce({
      delivered: false,
      path: "direct",
      phases: [],
    });
    const result = await deliverSubagentAnnouncement({
      requesterSessionKey: sessionKey,
      triggerMessage: "子代理已完成",
      steerMessage: "子代理已完成",
      targetRequesterSessionKey: sessionKey,
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
      directIdempotencyKey: "idem-release-fail",
      taskId: preflight.taskId,
    });
    expect(result.delivered).toBe(false);
    expect(runSubagentAnnounceDispatch).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(preflight.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(0);
  });

  it("clears a non-retryable embedded failure as failed", async () => {
    const preflight = armHeld("task-failed", workspace);
    mockedAttempt.mockResolvedValue({
      aborted: false,
      promptError: new Error("incorrect role information"),
      timedOut: false,
      sessionIdUsed: sessionKey,
      assistantTexts: [],
      taskId: preflight.taskId,
    } as unknown as Awaited<ReturnType<typeof runEmbeddedAttempt>>);
    await runEmbeddedPiAgent({
      sessionId: sessionKey,
      sessionKey,
      sessionFile: path.join(workspace, "session.json"),
      workspaceDir: workspace,
      prompt: "run sample-task",
      timeoutMs: 30_000,
      runId: "run-failed",
    });
    expect(mockedAttempt).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(preflight.taskId)).toBe(false);
    expect(readDeliveryContextMetrics().cleaned.failed).toBe(1);
  });

  it("clears a user abort as cancelled", async () => {
    const preflight = armHeld("task-cancelled", workspace);
    mockedAttempt.mockResolvedValue({
      aborted: true,
      promptError: null,
      timedOut: false,
      sessionIdUsed: sessionKey,
      assistantTexts: [],
      taskId: preflight.taskId,
    } as unknown as Awaited<ReturnType<typeof runEmbeddedAttempt>>);
    await runEmbeddedPiAgent({
      sessionId: sessionKey,
      sessionKey,
      sessionFile: path.join(workspace, "session.json"),
      workspaceDir: workspace,
      prompt: "run sample-task",
      timeoutMs: 30_000,
      runId: "run-abort",
    });
    expect(hasDeliveryContext(preflight.taskId)).toBe(false);
    expect(readDeliveryContextMetrics().cleaned.cancelled).toBe(1);
    expect(readDeliveryContextMetrics().cleaned.failed).toBe(0);
  });

  it("keeps context across a provider profile retry", async () => {
    const preflight = armHeld("task-provider-retry", workspace);
    vi.mocked(isFailoverErrorMessage).mockImplementation((text?: string) =>
      String(text ?? "").includes("rate limit"),
    );
    vi.mocked(classifyFailoverReason).mockReturnValue("rate_limit");
    vi.mocked(resolveAuthProfileOrder).mockReturnValue(["profile-a", "profile-b"]);
    let providerCalls = 0;
    mockedAttempt.mockImplementation(async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        return {
          aborted: false,
          promptError: new Error("rate limit"),
          timedOut: false,
          sessionIdUsed: sessionKey,
          assistantTexts: [],
        } as unknown as Awaited<ReturnType<typeof runEmbeddedAttempt>>;
      }
      return {
        aborted: false,
        promptError: null,
        timedOut: false,
        sessionIdUsed: sessionKey,
        assistantTexts: ["still working"],
      } as unknown as Awaited<ReturnType<typeof runEmbeddedAttempt>>;
    });
    try {
      await runEmbeddedPiAgent({
        sessionId: sessionKey,
        sessionKey,
        sessionFile: path.join(workspace, "session.json"),
        workspaceDir: workspace,
        prompt: "run sample-task",
        timeoutMs: 30_000,
        runId: "run-provider-retry",
      });
    } finally {
      vi.mocked(isFailoverErrorMessage).mockReturnValue(false);
      vi.mocked(classifyFailoverReason).mockReturnValue(null);
      vi.mocked(resolveAuthProfileOrder).mockReturnValue([]);
    }
    expect(providerCalls).toBeGreaterThan(1);
    expect(hasDeliveryContext(preflight.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().cleaned).toMatchObject({
      delivered: 0,
      failed: 0,
      cancelled: 0,
      timeout: 0,
    });
  });

  it("keeps context across a compaction retry", async () => {
    const preflight = armHeld("task-compact-retry", workspace);
    let compactionCalls = 0;
    mockedAttempt.mockImplementation(async () => {
      compactionCalls += 1;
      if (compactionCalls === 1) {
        return {
          aborted: false,
          promptError: new Error("context window exceeded"),
          compactionCount: 1,
          timedOut: false,
          sessionIdUsed: sessionKey,
          assistantTexts: [],
        } as unknown as Awaited<ReturnType<typeof runEmbeddedAttempt>>;
      }
      return {
        aborted: false,
        promptError: null,
        timedOut: false,
        sessionIdUsed: sessionKey,
        assistantTexts: ["still working"],
      } as unknown as Awaited<ReturnType<typeof runEmbeddedAttempt>>;
    });
    await runEmbeddedPiAgent({
      sessionId: sessionKey,
      sessionKey,
      sessionFile: path.join(workspace, "session.json"),
      workspaceDir: workspace,
      prompt: "run sample-task",
      timeoutMs: 30_000,
      runId: "run-compact-retry",
    });
    expect(compactionCalls).toBeGreaterThan(1);
    expect(hasDeliveryContext(preflight.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().cleaned.failed).toBe(0);
  });

  it("expires retained context on the sweep timer when no later task starts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const preflight = armHeld("task-timeout", workspace);
    expect(hasDeliveryContext(preflight.taskId)).toBe(true);
    startDeliveryContextSweep({ intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(hasDeliveryContext(preflight.taskId)).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hasDeliveryContext(preflight.taskId)).toBe(false);
    expect(readDeliveryContextMetrics().cleaned.timeout).toBe(1);
  });

  it("stops sweeping when the gateway close handler runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const preflight = armHeld("task-shutdown", workspace);
    startDeliveryContextSweep({ intervalMs: 60_000 });
    expect(readDeliveryContextSweepActive()).toBe(true);
    const close = createGatewayCloseHandler({
      bonjourStop: null,
      tailscaleCleanup: null,
      canvasHost: null,
      canvasHostServer: null,
      stopChannel: async () => {},
      pluginServices: null,
      cron: { stop: () => {} },
      heartbeatRunner: { stop: () => {} } as never,
      nodePresenceTimers: new Map(),
      broadcast: () => {},
      tickInterval: setInterval(() => {}, 60_000),
      healthInterval: setInterval(() => {}, 60_000),
      dedupeCleanup: setInterval(() => {}, 60_000),
      mediaCleanup: null,
      agentUnsub: null,
      heartbeatUnsub: null,
      chatRunState: { clear: () => {} },
      clients: new Set(),
      configReloader: { stop: async () => {} },
      browserControl: null,
      wss: { close: (cb: () => void) => cb() } as never,
      httpServer: {
        close: (cb: () => void) => cb(),
        closeIdleConnections: () => {},
      } as never,
    });
    await close({ reason: "test" });
    expect(readDeliveryContextSweepActive()).toBe(false);
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(hasDeliveryContext(preflight.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().cleaned.timeout).toBe(0);
  });

  it("does not create a second sweep timer", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    startDeliveryContextSweep({ intervalMs: 60_000 });
    startDeliveryContextSweep({ intervalMs: 60_000 });
    const sweepCalls = spy.mock.calls.filter((call) => call[1] === 60_000);
    expect(sweepCalls.length).toBe(1);
    expect(readDeliveryContextSweepActive()).toBe(true);
    spy.mockRestore();
    stopDeliveryContextSweep();
  });

  it("does not let one task release another, and a new task does not inherit the old receipt", async () => {
    const otherKey = "agent:bot-other:main";
    const first = armHeld("task-a", workspace, sessionKey);
    const second = armHeld("task-b", workspace, otherKey);
    allowReceipt(first.taskId);
    const sendTelegram = vi.fn(async () => ({ messageId: "m1", chatId: "123" }));
    await sendFinalReply(sessionKey, first.taskId, sendTelegram);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(first.taskId)).toBe(false);
    expect(hasDeliveryContext(second.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(1);

    const replacement = heldPreflight("task-c", sessionKey);
    noteDeliveryArtifactPath(replacement.taskId, replacement.attemptNumber, "out/output.bin");
    armCompletionHold({
      keys: [sessionKey],
      preflight: replacement,
      workspaceDir: workspace,
      ttlMs: 15 * 60 * 1000,
      now: Date.now(),
    });
    const judged = judgeSessionOutbound(
      sessionKey,
      "任务已完成",
      "channel_send",
      replacement.taskId,
    );
    expect(judged?.outcome).toBe("completion_blocked");
    expect(
      resolveAttemptDelivery({ preflight: replacement, workspaceDir: workspace }).allowedToDeliver,
    ).toBe(false);
    expect(hasDeliveryContext(second.taskId)).toBe(true);
    expect(hasDeliveryContext(replacement.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().retained).toBe(2);
  });

  it("judges and releases only the named task when two tasks share a session", async () => {
    const older = armHeld("task-older", workspace, sessionKey);
    const newer = armHeld("task-newer", workspace, sessionKey);
    allowReceipt(older.taskId);

    const olderCron = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-release",
      runId: older.taskId,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(olderCron).toEqual([sessionKey]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(older.taskId)).toBe(false);
    expect(hasDeliveryContext(newer.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(1);

    const newerBlocked = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-release",
      runId: newer.taskId,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(newerBlocked).toEqual([]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(hasDeliveryContext(newer.taskId)).toBe(true);

    const waiting = armHeld("task-waiting", workspace, sessionKey);
    const ready = armHeld("task-ready", workspace, sessionKey);
    allowReceipt(ready.taskId);
    const readyCron = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-release",
      runId: ready.taskId,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(readyCron).toEqual([sessionKey]);
    expect(hasDeliveryContext(ready.taskId)).toBe(false);
    expect(hasDeliveryContext(waiting.taskId)).toBe(true);
    expect(hasDeliveryContext(newer.taskId)).toBe(true);
    const waitingBlocked = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-release",
      runId: waiting.taskId,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(waitingBlocked).toEqual([]);
    expect(hasDeliveryContext(waiting.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(2);
  });

  it("does not release either task when the caller omits the task id", async () => {
    const older = armHeld("task-omit-a", workspace, sessionKey);
    const newer = armHeld("task-omit-b", workspace, sessionKey);
    allowReceipt(older.taskId);
    const surfaced = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-release",
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(surfaced).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
    expect(hasDeliveryContext(older.taskId)).toBe(true);
    expect(hasDeliveryContext(newer.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(0);
  });

  it("does not let a sweep exception escape", async () => {
    vi.useFakeTimers();
    startDeliveryContextSweep({
      intervalMs: 1_000,
      now: () => {
        throw new Error("sweep failed");
      },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(readDeliveryContextSweepActive()).toBe(true);
  });
});

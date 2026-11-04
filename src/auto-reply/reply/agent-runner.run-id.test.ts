/**
 * P3-2 rework regression for runReplyAgent's outer runId.
 *
 * The turn must reach runAgentTurnWithFallback and the model without a TDZ
 * `ReferenceError` (a block-scoped `runId` later in the same `try` used to shadow the
 * outer one), and the id handed over as `opts.runId` must be the same outer id the
 * memory flush received as `parentRunId`.
 *
 * runAgentTurnWithFallback and runMemoryFlushIfNeeded keep their real implementations;
 * they are only wrapped so the test can read the ids they were called with.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

type TurnFn = (typeof import("../../agent-runtime/execution/index.js"))["runAdmittedTurn"];
type FlushFn = (typeof import("./agent-runner-memory.js"))["runMemoryFlushIfNeeded"];

const mocks = vi.hoisted(() => ({
  runEmbeddedPiAgent: vi.fn(),
  runWithModelFallback: vi.fn(),
  runAgentTurnWithFallback: vi.fn<TurnFn>(),
  runMemoryFlushIfNeeded: vi.fn<FlushFn>(),
}));

vi.mock("../../agents/model-fallback.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/model-fallback.js")>();
  return { ...actual, runWithModelFallback: mocks.runWithModelFallback };
});

vi.mock("../../agents/pi-embedded.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/pi-embedded.js")>();
  return {
    ...actual,
    queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
    runEmbeddedPiAgent: mocks.runEmbeddedPiAgent,
  };
});

vi.mock("./queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./queue.js")>();
  return { ...actual, enqueueFollowupRun: vi.fn(), scheduleFollowupDrain: vi.fn() };
});

vi.mock("../../agent-runtime/execution/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agent-runtime/execution/index.js")>();
  mocks.runAgentTurnWithFallback.mockImplementation(actual.runAdmittedTurn);
  return { ...actual, runAdmittedTurn: mocks.runAgentTurnWithFallback };
});

vi.mock("./agent-runner-memory.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-runner-memory.js")>();
  mocks.runMemoryFlushIfNeeded.mockImplementation(actual.runMemoryFlushIfNeeded);
  return { ...actual, runMemoryFlushIfNeeded: mocks.runMemoryFlushIfNeeded };
});

import { runReplyAgent } from "./agent-runner.js";

function buildParams(opts?: { runId?: string }): Parameters<typeof runReplyAgent>[0] {
  return {
    commandBody: "hello",
    followupRun: {
      prompt: "hello",
      enqueuedAt: Date.now(),
      run: {
        agentId: "main",
        agentDir: "/tmp/agent",
        sessionId: "session",
        sessionKey: "main",
        messageProvider: "telegram",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp/workspace",
        config: {},
        provider: "anthropic",
        model: "claude",
        thinkLevel: "low",
        verboseLevel: "off",
        elevatedLevel: "off",
        bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
        timeoutMs: 1_000,
        blockReplyBreak: "message_end",
      },
    } as unknown as FollowupRun,
    queueKey: "main",
    resolvedQueue: { mode: "interrupt" } as QueueSettings,
    shouldSteer: false,
    shouldFollowup: false,
    isActive: false,
    isStreaming: false,
    ...(opts ? { opts } : {}),
    typing: createMockTypingController(),
    sessionCtx: {
      Provider: "telegram",
      Surface: "telegram",
      To: "chat-1",
      OriginatingTo: "chat-1",
      AccountId: "default",
      MessageSid: "msg-1",
    } as unknown as TemplateContext,
    defaultModel: "anthropic/claude",
    resolvedVerboseLevel: "off",
    isNewSession: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    shouldInjectGroupIntro: false,
    typingMode: "instant",
  };
}

function turnCall(): Parameters<TurnFn>[0] {
  const call = mocks.runAgentTurnWithFallback.mock.calls[0];
  expect(call, "runAgentTurnWithFallback was not called").toBeDefined();
  return call[0];
}

function flushCall(): Parameters<FlushFn>[0] {
  const call = mocks.runMemoryFlushIfNeeded.mock.calls[0];
  expect(call, "runMemoryFlushIfNeeded was not called").toBeDefined();
  return call[0];
}

describe("runReplyAgent outer runId (P3-2 rework)", () => {
  beforeEach(() => {
    mocks.runAgentTurnWithFallback.mockClear();
    mocks.runMemoryFlushIfNeeded.mockClear();
    mocks.runEmbeddedPiAgent.mockReset();
    mocks.runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { agentMeta: { sessionId: "session", provider: "anthropic", model: "claude" } },
    });
    mocks.runWithModelFallback.mockReset();
    mocks.runWithModelFallback.mockImplementation(
      async (params: {
        provider: string;
        model: string;
        run: (provider: string, model: string) => Promise<unknown>;
      }) => ({
        result: await params.run(params.provider, params.model),
        provider: params.provider,
        model: params.model,
      }),
    );
  });

  it("reaches the model without a ReferenceError and hands the outer runId to the turn", async () => {
    const result = await runReplyAgent(buildParams({ runId: "run-outer-1" }));

    expect(result).toMatchObject({ text: "ok" });
    expect(mocks.runAgentTurnWithFallback).toHaveBeenCalledTimes(1);
    expect(turnCall().opts?.runId).toBe("run-outer-1");
    expect(flushCall().parentRunId).toBe("run-outer-1");
    expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    expect(mocks.runEmbeddedPiAgent.mock.calls[0]?.[0]).toMatchObject({ runId: "run-outer-1" });
  });

  it("generates one outer runId and uses it for both the flush parent and the turn", async () => {
    const result = await runReplyAgent(buildParams());

    expect(result).toMatchObject({ text: "ok" });
    const parentRunId = flushCall().parentRunId;
    expect(typeof parentRunId).toBe("string");
    expect(parentRunId).not.toBe("");
    expect(turnCall().opts?.runId).toBe(parentRunId);
    expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    expect(mocks.runEmbeddedPiAgent.mock.calls[0]?.[0]).toMatchObject({ runId: parentRunId });
  });
});

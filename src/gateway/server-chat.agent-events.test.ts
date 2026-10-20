import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/config.js";
import { registerAgentRunContext, resetAgentRunContextForTest } from "../infra/agent-events.js";
import { resolveHeartbeatVisibility } from "../infra/heartbeat-visibility.js";
import {
  registerRunReplyLanguage,
  resetRunReplyLanguageForTest,
} from "../shared/text/run-reply-language.js";
import {
  createAgentEventHandler,
  createChatRunState,
  createToolEventRecipientRegistry,
} from "./server-chat.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../infra/heartbeat-visibility.js", () => ({
  resolveHeartbeatVisibility: vi.fn(() => ({
    showOk: false,
    showAlerts: true,
    useIndicator: true,
  })),
}));

const serverChatLogWarn = vi.hoisted(() => vi.fn());
vi.mock("../logging/subsystem.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../logging/subsystem.js")>();
  return {
    ...actual,
    createSubsystemLogger: (subsystem: string) => {
      const logger = actual.createSubsystemLogger(subsystem);
      if (subsystem !== "gateway/server-chat") {
        return logger;
      }
      return {
        ...logger,
        warn: ((message: string, meta?: Record<string, unknown>) => {
          serverChatLogWarn(message, meta);
          logger.warn(message, meta);
        }) as typeof logger.warn,
      };
    },
  };
});

describe("agent event handler", () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({});
    vi.mocked(resolveHeartbeatVisibility).mockReturnValue({
      showOk: false,
      showAlerts: true,
      useIndicator: true,
    });
    resetAgentRunContextForTest();
    resetRunReplyLanguageForTest();
  });

  afterEach(() => {
    resetAgentRunContextForTest();
    resetRunReplyLanguageForTest();
  });

  function createHarness(params?: {
    now?: number;
    resolveSessionKeyForRun?: (runId: string) => string | undefined;
  }) {
    const nowSpy =
      params?.now === undefined ? undefined : vi.spyOn(Date, "now").mockReturnValue(params.now);
    const broadcast = vi.fn();
    const broadcastChat = vi.fn();
    const broadcastToConnIds = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    const chatAbortControllers = new Map();
    const toolEventRecipients = createToolEventRecipientRegistry();

    const handler = createAgentEventHandler({
      broadcast,
      broadcastChat,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      chatAbortControllers,
      resolveSessionKeyForRun: params?.resolveSessionKeyForRun ?? (() => undefined),
      clearAgentRunContext: vi.fn(),
      toolEventRecipients,
    });

    return {
      nowSpy,
      broadcast,
      broadcastChat,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      chatAbortControllers,
      toolEventRecipients,
      handler,
    };
  }

  function emitRun1AssistantText(
    harness: ReturnType<typeof createHarness>,
    text: string,
  ): ReturnType<typeof createHarness> {
    harness.chatRunState.registry.add("run-1", {
      sessionKey: "session-1",
      clientRunId: "client-1",
    });
    harness.handler({
      runId: "run-1",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text },
    });
    return harness;
  }

  function chatBroadcastCalls(broadcastChat: ReturnType<typeof vi.fn>) {
    // broadcastChat(sessionKey, payload) — isolated steward fan-out entry.
    return broadcastChat.mock.calls;
  }

  function sessionChatCalls(nodeSendToSession: ReturnType<typeof vi.fn>) {
    return nodeSendToSession.mock.calls.filter(([, event]) => event === "chat");
  }

  const FALLBACK_LIFECYCLE_DATA = {
    phase: "fallback",
    selectedProvider: "fireworks",
    selectedModel: "fireworks/minimax-m2p5",
    activeProvider: "deepinfra",
    activeModel: "moonshotai/Kimi-K2.5",
  } as const;

  function emitLifecycleEnd(
    handler: ReturnType<typeof createHarness>["handler"],
    runId: string,
    seq = 2,
  ) {
    handler({
      runId,
      seq,
      stream: "lifecycle",
      ts: Date.now(),
      data: { phase: "end" },
    });
  }

  function emitFallbackLifecycle(params: {
    handler: ReturnType<typeof createHarness>["handler"];
    runId: string;
    seq?: number;
    sessionKey?: string;
  }) {
    params.handler({
      runId: params.runId,
      seq: params.seq ?? 1,
      stream: "lifecycle",
      ts: Date.now(),
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      data: { ...FALLBACK_LIFECYCLE_DATA },
    });
  }

  function expectSingleAgentBroadcastPayload(broadcast: ReturnType<typeof vi.fn>) {
    const broadcastAgentCalls = broadcast.mock.calls.filter(([event]) => event === "agent");
    expect(broadcastAgentCalls).toHaveLength(1);
    return broadcastAgentCalls[0]?.[1] as {
      runId?: string;
      sessionKey?: string;
      stream?: string;
      data?: Record<string, unknown>;
    };
  }

  function expectSingleFinalChatPayload(broadcastChat: ReturnType<typeof vi.fn>) {
    const chatCalls = chatBroadcastCalls(broadcastChat);
    expect(chatCalls).toHaveLength(1);
    const payload = chatCalls[0]?.[1] as {
      state?: string;
      message?: unknown;
    };
    expect(payload.state).toBe("final");
    return payload;
  }

  it("emits chat delta for assistant text-only events", () => {
    const { broadcastChat, nodeSendToSession, nowSpy } = emitRun1AssistantText(
      createHarness({ now: 1_000 }),
      "Hello world",
    );
    const chatCalls = chatBroadcastCalls(broadcastChat);
    expect(chatCalls).toHaveLength(1);
    const payload = chatCalls[0]?.[1] as {
      state?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    expect(payload.state).toBe("delta");
    expect(payload.message?.content?.[0]?.text).toBe("Hello world");
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(1);
    nowSpy?.mockRestore();
  });

  it("strips inline directives from assistant chat events", () => {
    const { broadcastChat, nodeSendToSession, nowSpy } = emitRun1AssistantText(
      createHarness({ now: 1_000 }),
      "Hello [[reply_to_current]] world [[audio_as_voice]]",
    );
    const chatCalls = chatBroadcastCalls(broadcastChat);
    expect(chatCalls).toHaveLength(1);
    const payload = chatCalls[0]?.[1] as {
      message?: { content?: Array<{ text?: string }> };
    };
    expect(payload.message?.content?.[0]?.text).toBe("world");
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(1);
    nowSpy?.mockRestore();
  });

  it("does not emit chat delta for NO_REPLY streaming text", () => {
    const { broadcastChat, nodeSendToSession, nowSpy } = emitRun1AssistantText(
      createHarness({ now: 1_000 }),
      " NO_REPLY  ",
    );
    expect(chatBroadcastCalls(broadcastChat)).toHaveLength(0);
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(0);
    nowSpy?.mockRestore();
  });

  it("does not include NO_REPLY text in chat final message", () => {
    const { broadcastChat, nodeSendToSession, chatRunState, handler, nowSpy } = createHarness({
      now: 2_000,
    });
    chatRunState.registry.add("run-2", { sessionKey: "session-2", clientRunId: "client-2" });

    handler({
      runId: "run-2",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "NO_REPLY" },
    });
    emitLifecycleEnd(handler, "run-2");

    const payload = expectSingleFinalChatPayload(broadcastChat) as { message?: unknown };
    expect(payload.message).toBeUndefined();
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(1);
    nowSpy?.mockRestore();
  });

  it("suppresses NO_REPLY lead fragments and does not leak NO in final chat message", () => {
    const { broadcastChat, nodeSendToSession, chatRunState, handler, nowSpy } = createHarness({
      now: 2_100,
    });
    chatRunState.registry.add("run-3", { sessionKey: "session-3", clientRunId: "client-3" });

    for (const text of ["NO", "NO_", "NO_RE", "NO_REPLY"]) {
      handler({
        runId: "run-3",
        seq: 1,
        stream: "assistant",
        ts: Date.now(),
        data: { text },
      });
    }
    emitLifecycleEnd(handler, "run-3");

    const payload = expectSingleFinalChatPayload(broadcastChat) as { message?: unknown };
    expect(payload.message).toBeUndefined();
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(1);
    nowSpy?.mockRestore();
  });

  it("keeps final short replies like 'No' even when lead-fragment deltas are suppressed", () => {
    const { broadcastChat, nodeSendToSession, chatRunState, handler, nowSpy } = createHarness({
      now: 2_200,
    });
    chatRunState.registry.add("run-4", { sessionKey: "session-4", clientRunId: "client-4" });

    handler({
      runId: "run-4",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "No" },
    });
    emitLifecycleEnd(handler, "run-4");

    const payload = expectSingleFinalChatPayload(broadcastChat) as {
      message?: { content?: Array<{ text?: string }> };
    };
    expect(payload.message?.content?.[0]?.text).toBe("No");
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(1);
    nowSpy?.mockRestore();
  });

  it("flushes buffered text as delta before final when throttle suppresses the latest chunk", () => {
    let now = 10_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const { broadcastChat, nodeSendToSession, chatRunState, handler } = createHarness();
    chatRunState.registry.add("run-flush", {
      sessionKey: "session-flush",
      clientRunId: "client-flush",
    });

    handler({
      runId: "run-flush",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Hello" },
    });

    now = 10_100;
    handler({
      runId: "run-flush",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Hello world" },
    });

    emitLifecycleEnd(handler, "run-flush");

    const chatCalls = chatBroadcastCalls(broadcastChat);
    expect(chatCalls).toHaveLength(3);
    const firstPayload = chatCalls[0]?.[1] as { state?: string };
    const secondPayload = chatCalls[1]?.[1] as {
      state?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    const thirdPayload = chatCalls[2]?.[1] as { state?: string };
    expect(firstPayload.state).toBe("delta");
    expect(secondPayload.state).toBe("delta");
    expect(secondPayload.message?.content?.[0]?.text).toBe("Hello world");
    expect(thirdPayload.state).toBe("final");
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(3);
    nowSpy.mockRestore();
  });

  it("preserves pre-tool assistant text when later segments stream as non-prefix snapshots", () => {
    let now = 10_500;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const { broadcastChat, nodeSendToSession, chatRunState, handler } = createHarness();
    chatRunState.registry.add("run-segmented", {
      sessionKey: "session-segmented",
      clientRunId: "client-segmented",
    });

    handler({
      runId: "run-segmented",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Before tool call", delta: "Before tool call" },
    });

    now = 10_700;
    handler({
      runId: "run-segmented",
      seq: 2,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "After tool call", delta: "\nAfter tool call" },
    });

    emitLifecycleEnd(handler, "run-segmented", 3);

    const chatCalls = chatBroadcastCalls(broadcastChat);
    expect(chatCalls).toHaveLength(3);
    const secondPayload = chatCalls[1]?.[1] as {
      state?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    const finalPayload = chatCalls[2]?.[1] as {
      state?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    expect(secondPayload.state).toBe("delta");
    expect(secondPayload.message?.content?.[0]?.text).toBe("Before tool call\nAfter tool call");
    expect(finalPayload.state).toBe("final");
    expect(finalPayload.message?.content?.[0]?.text).toBe("Before tool call\nAfter tool call");
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(3);
    nowSpy.mockRestore();
  });

  it("flushes merged segmented text before final when latest segment is throttled", () => {
    let now = 10_800;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const { broadcastChat, nodeSendToSession, chatRunState, handler } = createHarness();
    chatRunState.registry.add("run-segmented-flush", {
      sessionKey: "session-segmented-flush",
      clientRunId: "client-segmented-flush",
    });

    handler({
      runId: "run-segmented-flush",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Before tool call", delta: "Before tool call" },
    });

    now = 10_860;
    handler({
      runId: "run-segmented-flush",
      seq: 2,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "After tool call", delta: "\nAfter tool call" },
    });

    emitLifecycleEnd(handler, "run-segmented-flush", 3);

    const chatCalls = chatBroadcastCalls(broadcastChat);
    expect(chatCalls).toHaveLength(3);
    const flushPayload = chatCalls[1]?.[1] as {
      state?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    const finalPayload = chatCalls[2]?.[1] as {
      state?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    expect(flushPayload.state).toBe("delta");
    expect(flushPayload.message?.content?.[0]?.text).toBe("Before tool call\nAfter tool call");
    expect(finalPayload.state).toBe("final");
    expect(finalPayload.message?.content?.[0]?.text).toBe("Before tool call\nAfter tool call");
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(3);
    nowSpy.mockRestore();
  });

  it("does not flush an extra delta when the latest text already broadcast", () => {
    let now = 11_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const { broadcastChat, nodeSendToSession, chatRunState, handler } = createHarness();
    chatRunState.registry.add("run-no-dup-flush", {
      sessionKey: "session-no-dup-flush",
      clientRunId: "client-no-dup-flush",
    });

    handler({
      runId: "run-no-dup-flush",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Hello" },
    });

    now = 11_200;
    handler({
      runId: "run-no-dup-flush",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Hello world" },
    });

    emitLifecycleEnd(handler, "run-no-dup-flush");

    const chatCalls = chatBroadcastCalls(broadcastChat);
    expect(chatCalls).toHaveLength(3);
    expect(chatCalls.map(([, payload]) => (payload as { state?: string }).state)).toEqual([
      "delta",
      "delta",
      "final",
    ]);
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(3);
    nowSpy.mockRestore();
  });

  it("cleans up agent run sequence tracking when lifecycle completes", () => {
    const { agentRunSeq, chatRunState, handler, nowSpy } = createHarness({ now: 2_500 });
    chatRunState.registry.add("run-cleanup", {
      sessionKey: "session-cleanup",
      clientRunId: "client-cleanup",
    });

    handler({
      runId: "run-cleanup",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "done" },
    });
    expect(agentRunSeq.get("run-cleanup")).toBe(1);

    handler({
      runId: "run-cleanup",
      seq: 2,
      stream: "lifecycle",
      ts: Date.now(),
      data: { phase: "end" },
    });

    expect(agentRunSeq.has("run-cleanup")).toBe(false);
    expect(agentRunSeq.has("client-cleanup")).toBe(false);
    nowSpy?.mockRestore();
  });

  it("flushes buffered chat delta before tool start events", () => {
    let now = 12_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const {
      broadcast,
      broadcastChat,
      broadcastToConnIds,
      nodeSendToSession,
      chatRunState,
      toolEventRecipients,
      handler,
    } = createHarness({
      resolveSessionKeyForRun: () => "session-tool-flush",
    });

    chatRunState.registry.add("run-tool-flush", {
      sessionKey: "session-tool-flush",
      clientRunId: "client-tool-flush",
    });
    registerAgentRunContext("run-tool-flush", {
      sessionKey: "session-tool-flush",
      verboseLevel: "off",
    });
    toolEventRecipients.add("run-tool-flush", "conn-1");

    handler({
      runId: "run-tool-flush",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Before tool" },
    });

    // Throttled assistant update (within 150ms window).
    now = 12_050;
    handler({
      runId: "run-tool-flush",
      seq: 2,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Before tool expanded" },
    });

    handler({
      runId: "run-tool-flush",
      seq: 3,
      stream: "tool",
      ts: Date.now(),
      data: { phase: "start", name: "read", toolCallId: "tool-flush-1" },
    });

    const chatCalls = chatBroadcastCalls(broadcastChat);
    expect(chatCalls).toHaveLength(2);
    const flushedPayload = chatCalls[1]?.[1] as {
      state?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    expect(flushedPayload.state).toBe("delta");
    expect(flushedPayload.message?.content?.[0]?.text).toBe("Before tool expanded");
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(2);

    expect(broadcastToConnIds).toHaveBeenCalledTimes(1);
    const flushCallOrder = broadcast.mock.invocationCallOrder[1] ?? 0;
    const toolCallOrder = broadcastToConnIds.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
    expect(flushCallOrder).toBeLessThan(toolCallOrder);
    nowSpy.mockRestore();
    resetAgentRunContextForTest();
  });

  it("drops pre-tool narration from the reply buffer after a tool starts", () => {
    let now = 13_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const { broadcastChat, chatRunState, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-tool-narration",
    });
    chatRunState.registry.add("run-tool-narration", {
      sessionKey: "session-tool-narration",
      clientRunId: "client-tool-narration",
    });
    registerAgentRunContext("run-tool-narration", {
      sessionKey: "session-tool-narration",
      verboseLevel: "off",
    });

    handler({
      runId: "run-tool-narration",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "好，那我先打开云电脑浏览器看看有什么待支付的订单。" },
    });
    handler({
      runId: "run-tool-narration",
      seq: 2,
      stream: "tool",
      ts: Date.now(),
      data: { phase: "start", name: "browser", toolCallId: "browser-status" },
    });
    expect(chatRunState.buffers.get("client-tool-narration")).toBe("");

    now = 13_400;
    handler({
      runId: "run-tool-narration",
      seq: 3,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "浏览器环境已就绪。不过我还需要知道具体买什么。" },
    });
    emitLifecycleEnd(handler, "run-tool-narration", 4);

    const finals = chatBroadcastCalls(broadcastChat)
      .map(
        (call) => call[1] as { state?: string; message?: { content?: Array<{ text?: string }> } },
      )
      .filter((payload) => payload.state === "final" || payload.state === "delta");
    const last = finals.at(-1);
    expect(last?.message?.content?.[0]?.text).toBe(
      "浏览器环境已就绪。不过我还需要知道具体买什么。",
    );
    expect(last?.message?.content?.[0]?.text).not.toContain("好，那我先打开");
    nowSpy.mockRestore();
    resetAgentRunContextForTest();
  });

  it("routes tool events only to registered recipients when verbose is enabled", () => {
    const { broadcast, broadcastToConnIds, toolEventRecipients, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-1",
    });

    registerAgentRunContext("run-tool", { sessionKey: "session-1", verboseLevel: "on" });
    toolEventRecipients.add("run-tool", "conn-1");

    handler({
      runId: "run-tool",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: { phase: "start", name: "read", toolCallId: "t1" },
    });

    expect(broadcast).not.toHaveBeenCalled();
    expect(broadcastToConnIds).toHaveBeenCalledTimes(1);
    resetAgentRunContextForTest();
  });

  it("broadcasts tool events to WS recipients even when verbose is off, but skips node send", () => {
    const { broadcastToConnIds, nodeSendToSession, toolEventRecipients, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-1",
    });

    registerAgentRunContext("run-tool-off", { sessionKey: "session-1", verboseLevel: "off" });
    toolEventRecipients.add("run-tool-off", "conn-1");

    handler({
      runId: "run-tool-off",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: { phase: "start", name: "read", toolCallId: "t2" },
    });

    // Tool events always broadcast to registered WS recipients
    expect(broadcastToConnIds).toHaveBeenCalledTimes(1);
    // But node/channel subscribers should NOT receive when verbose is off
    const nodeToolCalls = nodeSendToSession.mock.calls.filter(([, event]) => event === "agent");
    expect(nodeToolCalls).toHaveLength(0);
    resetAgentRunContextForTest();
  });

  it("strips tool output when verbose is on", () => {
    const { broadcastToConnIds, toolEventRecipients, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-1",
    });

    registerAgentRunContext("run-tool-on", { sessionKey: "session-1", verboseLevel: "on" });
    toolEventRecipients.add("run-tool-on", "conn-1");

    handler({
      runId: "run-tool-on",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: {
        phase: "result",
        name: "exec",
        toolCallId: "t3",
        result: { content: [{ type: "text", text: "secret" }] },
        partialResult: { content: [{ type: "text", text: "partial" }] },
      },
    });

    expect(broadcastToConnIds).toHaveBeenCalledTimes(1);
    const payload = broadcastToConnIds.mock.calls[0]?.[1] as { data?: Record<string, unknown> };
    expect(payload.data?.result).toBeUndefined();
    expect(payload.data?.partialResult).toBeUndefined();
    resetAgentRunContextForTest();
  });

  it("keeps tool output when verbose is full", () => {
    const { broadcastToConnIds, toolEventRecipients, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-1",
    });

    registerAgentRunContext("run-tool-full", { sessionKey: "session-1", verboseLevel: "full" });
    toolEventRecipients.add("run-tool-full", "conn-1");

    const result = { content: [{ type: "text", text: "secret" }] };
    handler({
      runId: "run-tool-full",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: {
        phase: "result",
        name: "exec",
        toolCallId: "t4",
        result,
      },
    });

    expect(broadcastToConnIds).toHaveBeenCalledTimes(1);
    const payload = broadcastToConnIds.mock.calls[0]?.[1] as { data?: Record<string, unknown> };
    expect(payload.data?.result).toEqual(result);
    resetAgentRunContextForTest();
  });

  it("broadcasts fallback events to agent subscribers and node session", () => {
    const { broadcast, broadcastToConnIds, nodeSendToSession, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-fallback",
    });

    emitFallbackLifecycle({ handler, runId: "run-fallback" });

    expect(broadcastToConnIds).not.toHaveBeenCalled();
    const payload = expectSingleAgentBroadcastPayload(broadcast);
    expect(payload.stream).toBe("lifecycle");
    expect(payload.data?.phase).toBe("fallback");
    expect(payload.sessionKey).toBe("session-fallback");
    expect(payload.data?.activeProvider).toBe("deepinfra");

    const nodeCalls = nodeSendToSession.mock.calls.filter(([, event]) => event === "agent");
    expect(nodeCalls).toHaveLength(1);
  });

  it("remaps chat-linked lifecycle runId to client runId", () => {
    const { broadcast, nodeSendToSession, chatRunState, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-fallback",
    });
    chatRunState.registry.add("run-fallback-internal", {
      sessionKey: "session-fallback",
      clientRunId: "run-fallback-client",
    });

    emitFallbackLifecycle({ handler, runId: "run-fallback-internal" });

    const payload = expectSingleAgentBroadcastPayload(broadcast);
    expect(payload.runId).toBe("run-fallback-client");
    expect(payload.stream).toBe("lifecycle");
    expect(payload.data?.phase).toBe("fallback");

    const nodeCalls = nodeSendToSession.mock.calls.filter(([, event]) => event === "agent");
    expect(nodeCalls).toHaveLength(1);
    const nodePayload = nodeCalls[0]?.[2] as { runId?: string };
    expect(nodePayload.runId).toBe("run-fallback-client");
  });

  it("suppresses chat and node session events for non-control-UI-visible runs", () => {
    serverChatLogWarn.mockClear();
    const { broadcastChat, nodeSendToSession, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-hidden",
    });
    registerAgentRunContext("run-hidden", {
      sessionKey: "session-hidden",
      isControlUiVisible: false,
      verboseLevel: "off",
    });

    handler({
      runId: "run-hidden",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Reply from imessage" },
    });
    emitLifecycleEnd(handler, "run-hidden", 2);

    expect(chatBroadcastCalls(broadcastChat)).toHaveLength(0);
    expect(nodeSendToSession).not.toHaveBeenCalled();
    expect(serverChatLogWarn).toHaveBeenCalledWith(
      "chat.final broadcast",
      expect.objectContaining({
        runId: "run-hidden",
        sessionKey: "session-hidden",
        visibility: "skipped",
        suppressReason: "control_ui_invisible",
      }),
    );
  });

  it("uses agent event sessionKey when run-context lookup cannot resolve", () => {
    const { broadcast, handler } = createHarness({
      resolveSessionKeyForRun: () => undefined,
    });

    emitFallbackLifecycle({
      handler,
      runId: "run-fallback-session-key",
      sessionKey: "session-from-event",
    });

    const payload = expectSingleAgentBroadcastPayload(broadcast);
    expect(payload.sessionKey).toBe("session-from-event");
  });

  it("remaps chat-linked tool runId for non-full verbose payloads", () => {
    const { broadcastToConnIds, chatRunState, toolEventRecipients, handler } = createHarness({
      resolveSessionKeyForRun: () => "session-tool-remap",
    });

    chatRunState.registry.add("run-tool-internal", {
      sessionKey: "session-tool-remap",
      clientRunId: "run-tool-client",
    });
    registerAgentRunContext("run-tool-internal", {
      sessionKey: "session-tool-remap",
      verboseLevel: "on",
    });
    toolEventRecipients.add("run-tool-internal", "conn-1");

    handler({
      runId: "run-tool-internal",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      data: {
        phase: "result",
        name: "exec",
        toolCallId: "tool-remap-1",
        result: { content: [{ type: "text", text: "secret" }] },
      },
    });

    expect(broadcastToConnIds).toHaveBeenCalledTimes(1);
    const payload = broadcastToConnIds.mock.calls[0]?.[1] as { runId?: string };
    expect(payload.runId).toBe("run-tool-client");
    resetAgentRunContextForTest();
  });

  it("suppresses heartbeat ack-like chat output when showOk is false", () => {
    const { broadcastChat, nodeSendToSession, chatRunState, handler } = createHarness({
      now: 2_000,
    });
    chatRunState.registry.add("run-heartbeat", {
      sessionKey: "session-heartbeat",
      clientRunId: "client-heartbeat",
    });
    registerAgentRunContext("run-heartbeat", {
      sessionKey: "session-heartbeat",
      isHeartbeat: true,
      verboseLevel: "off",
    });

    handler({
      runId: "run-heartbeat",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: {
        text: "HEARTBEAT_OK Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.",
      },
    });

    expect(chatBroadcastCalls(broadcastChat)).toHaveLength(0);
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(0);

    emitLifecycleEnd(handler, "run-heartbeat");

    const finalPayload = expectSingleFinalChatPayload(broadcastChat) as { message?: unknown };
    expect(finalPayload.message).toBeUndefined();
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(1);
  });

  it("keeps heartbeat alert text in final chat output when remainder exceeds ackMaxChars", () => {
    vi.mocked(loadConfig).mockReturnValue({
      agents: { defaults: { heartbeat: { ackMaxChars: 10 } } },
    });

    const { broadcastChat, chatRunState, handler } = createHarness({ now: 3_000 });
    chatRunState.registry.add("run-heartbeat-alert", {
      sessionKey: "session-heartbeat-alert",
      clientRunId: "client-heartbeat-alert",
    });
    registerAgentRunContext("run-heartbeat-alert", {
      sessionKey: "session-heartbeat-alert",
      isHeartbeat: true,
      verboseLevel: "off",
    });

    handler({
      runId: "run-heartbeat-alert",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: {
        text: "HEARTBEAT_OK Disk usage crossed 95 percent on /data and needs cleanup now.",
      },
    });

    emitLifecycleEnd(handler, "run-heartbeat-alert");

    const payload = expectSingleFinalChatPayload(broadcastChat) as {
      message?: { content?: Array<{ text?: string }> };
    };
    expect(payload.message?.content?.[0]?.text).toBe(
      "Disk usage crossed 95 percent on /data and needs cleanup now.",
    );
  });

  it("does not emit visible chat.final on collaboration space child sessions", () => {
    const { broadcastChat, nodeSendToSession, chatRunState, handler } = createHarness({
      now: 3_500,
    });
    chatRunState.registry.add("run-space-child", {
      sessionKey: "agent:ceo:main:space:grp-test",
      clientRunId: "client-parent:ceo",
    });
    chatRunState.buffers.set("client-parent:ceo", "CEO上午好！我在线待命。");
    chatRunState.deltaLastBroadcastLen.set("client-parent:ceo", "CEO上午好！我在线待命。".length);
    chatRunState.deltaLastBroadcastText.set("client-parent:ceo", "CEO上午好！我在线待命。");

    emitLifecycleEnd(handler, "run-space-child");

    const finals = chatBroadcastCalls(broadcastChat).filter(
      (call) => (call[1] as { state?: string } | undefined)?.state === "final",
    );
    expect(finals).toHaveLength(0);
    const sessionFinals = sessionChatCalls(nodeSendToSession).filter(
      (call) => (call[2] as { state?: string } | undefined)?.state === "final",
    );
    expect(sessionFinals).toHaveLength(0);
  });

  it("still emits chat.final on the parent space session", () => {
    const { broadcastChat, chatRunState, handler } = createHarness({ now: 3_600 });
    chatRunState.registry.add("run-space-parent", {
      sessionKey: "space:grp-test",
      clientRunId: "client-parent",
    });
    chatRunState.buffers.set("client-parent", "CEO上午好！我在线待命。");
    chatRunState.deltaLastBroadcastLen.set("client-parent", "CEO上午好！我在线待命。".length);
    chatRunState.deltaLastBroadcastText.set("client-parent", "CEO上午好！我在线待命。");

    emitLifecycleEnd(handler, "run-space-parent");

    const payload = expectSingleFinalChatPayload(broadcastChat) as {
      message?: { content?: Array<{ text?: string }> };
    };
    expect(payload.message?.content?.[0]?.text).toBe("CEO上午好！我在线待命。");
  });

  it("still emits chat.final when registry shift misses after peek", () => {
    const { broadcastChat, nodeSendToSession, chatRunState, handler } = createHarness({
      now: 4_000,
    });
    chatRunState.registry.add("run-shift-miss", {
      sessionKey: "session-shift-miss",
      clientRunId: "client-shift-miss",
    });
    chatRunState.buffers.set("client-shift-miss", "Recovered final text");
    // Avoid an extra delta flush so we assert a single chat.final broadcast.
    chatRunState.deltaLastBroadcastLen.set("client-shift-miss", "Recovered final text".length);
    chatRunState.deltaLastBroadcastText.set("client-shift-miss", "Recovered final text");
    vi.spyOn(chatRunState.registry, "shift").mockReturnValueOnce(undefined);

    emitLifecycleEnd(handler, "run-shift-miss");

    const payload = expectSingleFinalChatPayload(broadcastChat) as {
      runId?: string;
      sessionKey?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    expect(payload.runId).toBe("client-shift-miss");
    expect(payload.sessionKey).toBe("session-shift-miss");
    expect(payload.message?.content?.[0]?.text).toBe("Recovered final text");
    expect(sessionChatCalls(nodeSendToSession)).toHaveLength(1);
  });

  it("emits process-channel thinking progress for scratchpad-only assistant text", () => {
    let now = 20_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const { broadcastChat, nodeSendToSession, chatRunState, handler } = createHarness();
    chatRunState.registry.add("run-think", {
      sessionKey: "session-think",
      clientRunId: "client-think",
    });
    registerAgentRunContext("run-think", {
      sessionKey: "session-think",
      verboseLevel: "off",
    });

    handler({
      runId: "run-think",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: {
        text: "Let me understand the request first.\n\nI need to search local paths.\n\nActually, I will organize a Chinese reply.",
      },
    });

    const chatCalls = chatBroadcastCalls(broadcastChat);
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    const thinkingPayload = chatCalls[0]?.[1] as {
      state?: string;
      thinking?: {
        placeholder?: string;
        steps?: Array<{ label?: string }>;
        percent?: number;
      };
      message?: unknown;
    };
    expect(thinkingPayload.state).toBe("thinking");
    expect(thinkingPayload.message).toBeUndefined();
    expect(thinkingPayload.thinking?.placeholder).toMatch(/梳理|思考/);
    expect(JSON.stringify(thinkingPayload.thinking)).not.toMatch(/Let me|I need to|Actually/i);
    expect(thinkingPayload.thinking?.steps?.length).toBeGreaterThan(0);
    expect(sessionChatCalls(nodeSendToSession).some((call) => call?.[1] === "chat")).toBe(true);

    now = 20_400;
    handler({
      runId: "run-think",
      seq: 2,
      stream: "assistant",
      ts: Date.now(),
      data: {
        text: "Let me understand the request first.\n\nI need to search local paths.\n\nActually, I will organize a Chinese reply.\n\n本机微信客户端数据在容器目录里，不能直接当知识库。",
      },
    });

    const later = chatBroadcastCalls(broadcastChat).map((call) => call[1] as { state?: string });
    expect(later.some((p) => p.state === "delta")).toBe(true);
    nowSpy.mockRestore();
  });

  it("emits early process-channel thinking on lifecycle start before assistant tokens", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(40_000);
    const { broadcastChat, nodeSendToSession, chatRunState, handler } = createHarness();
    chatRunState.registry.add("run-early-ack", {
      sessionKey: "session-early-ack",
      clientRunId: "client-early-ack",
    });
    registerAgentRunContext("run-early-ack", {
      sessionKey: "session-early-ack",
      verboseLevel: "off",
    });

    handler({
      runId: "run-early-ack",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      data: { phase: "start", startedAt: Date.now() },
    });

    const chatCalls = chatBroadcastCalls(broadcastChat);
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    const thinkingPayload = chatCalls[0]?.[1] as {
      state?: string;
      thinking?: { placeholder?: string; steps?: Array<{ label?: string }> };
      message?: unknown;
    };
    expect(thinkingPayload.state).toBe("thinking");
    expect(thinkingPayload.message).toBeUndefined();
    expect(thinkingPayload.thinking?.placeholder).toMatch(/梳理|思考|Thinking/i);
    expect(thinkingPayload.thinking?.steps?.length).toBeGreaterThan(0);
    expect(sessionChatCalls(nodeSendToSession).some((call) => call?.[1] === "chat")).toBe(true);
    nowSpy.mockRestore();
  });

  it("keeps English thinking visible when the run language is English", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(30_000);
    const { broadcastChat, chatRunState, handler } = createHarness();
    chatRunState.registry.add("run-think-en", {
      sessionKey: "session-think-en",
      clientRunId: "client-think-en",
    });
    registerAgentRunContext("run-think-en", {
      sessionKey: "session-think-en",
      verboseLevel: "off",
    });
    registerRunReplyLanguage("run-think-en", "en");

    handler({
      runId: "run-think-en",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: {
        text: "I'll start by looking at my workspace to see what's there.",
      },
    });

    const payload = chatBroadcastCalls(broadcastChat)[0]?.[1] as {
      state?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    expect(payload.state).toBe("delta");
    expect(payload.message?.content?.[0]?.text).toContain("I'll start");
    expect(payload.message?.content?.[0]?.text).not.toMatch(/[\u4e00-\u9fff]/);
    nowSpy.mockRestore();
  });
});

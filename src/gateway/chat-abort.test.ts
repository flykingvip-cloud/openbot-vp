import { describe, expect, it, vi } from "vitest";
import {
  abortChatRunById,
  findActiveDuplicateChatSend,
  isChatStopCommandText,
  type ChatAbortOps,
  type ChatAbortControllerEntry,
} from "./chat-abort.js";

function createActiveEntry(sessionKey: string): ChatAbortControllerEntry {
  const now = Date.now();
  return {
    controller: new AbortController(),
    sessionId: "sess-1",
    sessionKey,
    startedAtMs: now,
    expiresAtMs: now + 10_000,
  };
}

function createOps(params: {
  runId: string;
  entry: ChatAbortControllerEntry;
  buffer?: string;
}): ChatAbortOps & {
  broadcastChat: ReturnType<typeof vi.fn>;
  nodeSendToSession: ReturnType<typeof vi.fn>;
  removeChatRun: ReturnType<typeof vi.fn>;
} {
  const { runId, entry, buffer } = params;
  const broadcastChat = vi.fn();
  const nodeSendToSession = vi.fn();
  const removeChatRun = vi.fn();

  return {
    chatAbortControllers: new Map([[runId, entry]]),
    chatRunBuffers: new Map(buffer !== undefined ? [[runId, buffer]] : []),
    chatDeltaSentAt: new Map([[runId, Date.now()]]),
    chatAbortedRuns: new Map(),
    removeChatRun,
    agentRunSeq: new Map(),
    broadcastChat,
    nodeSendToSession,
  };
}

describe("findActiveDuplicateChatSend", () => {
  it("matches same session and same body while the run is active", () => {
    const controllers = new Map<string, ChatAbortControllerEntry>([
      [
        "run-1",
        {
          ...createActiveEntry("agent:bot-2:main"),
          userMessageText: "  帮我查一下会议  ",
        },
      ],
    ]);

    const found = findActiveDuplicateChatSend(controllers, {
      sessionKey: "agent:bot-2:main",
      userMessageText: "帮我查一下会议",
    });

    expect(found?.runId).toBe("run-1");
  });

  it("fails open when the active run has no captured body", () => {
    const controllers = new Map<string, ChatAbortControllerEntry>([
      ["run-legacy", createActiveEntry("agent:bot-2:main")],
    ]);

    expect(
      findActiveDuplicateChatSend(controllers, {
        sessionKey: "agent:bot-2:main",
        userMessageText: "帮我查一下会议",
      }),
    ).toBeUndefined();
  });

  it("does not match a different session or a different body", () => {
    const controllers = new Map<string, ChatAbortControllerEntry>([
      [
        "run-1",
        {
          ...createActiveEntry("agent:bot-2:main"),
          userMessageText: "帮我查一下会议",
        },
      ],
    ]);

    expect(
      findActiveDuplicateChatSend(controllers, {
        sessionKey: "agent:bot-skill:main",
        userMessageText: "帮我查一下会议",
      }),
    ).toBeUndefined();
    expect(
      findActiveDuplicateChatSend(controllers, {
        sessionKey: "agent:bot-2:main",
        userMessageText: "换一个问题",
      }),
    ).toBeUndefined();
  });
});

describe("isChatStopCommandText", () => {
  it("matches slash and standalone multilingual stop forms", () => {
    expect(isChatStopCommandText(" /STOP!!! ")).toBe(true);
    expect(isChatStopCommandText("stop please")).toBe(true);
    expect(isChatStopCommandText("do not do that")).toBe(true);
    expect(isChatStopCommandText("停止")).toBe(true);
    expect(isChatStopCommandText("やめて")).toBe(true);
    expect(isChatStopCommandText("توقف")).toBe(true);
    expect(isChatStopCommandText("остановись")).toBe(true);
    expect(isChatStopCommandText("halt")).toBe(true);
    expect(isChatStopCommandText("stopp")).toBe(true);
    expect(isChatStopCommandText("pare")).toBe(true);
    expect(isChatStopCommandText("/status")).toBe(false);
    expect(isChatStopCommandText("please do not do that")).toBe(false);
    expect(isChatStopCommandText("keep going")).toBe(false);
  });
});

describe("abortChatRunById", () => {
  it("broadcasts aborted payload with partial message when buffered text exists", () => {
    const runId = "run-1";
    const sessionKey = "main";
    const entry = createActiveEntry(sessionKey);
    const ops = createOps({ runId, entry, buffer: "  Partial reply  " });
    ops.agentRunSeq.set(runId, 2);
    ops.agentRunSeq.set("client-run-1", 4);
    ops.removeChatRun.mockReturnValue({ sessionKey, clientRunId: "client-run-1" });

    const result = abortChatRunById(ops, { runId, sessionKey, stopReason: "user" });

    expect(result).toMatchObject({ aborted: true });
    expect(entry.controller.signal.aborted).toBe(true);
    expect(ops.chatAbortControllers.has(runId)).toBe(false);
    expect(ops.chatRunBuffers.has(runId)).toBe(false);
    expect(ops.chatDeltaSentAt.has(runId)).toBe(false);
    expect(ops.removeChatRun).toHaveBeenCalledWith(runId, runId, sessionKey);
    expect(ops.agentRunSeq.has(runId)).toBe(false);
    expect(ops.agentRunSeq.has("client-run-1")).toBe(false);

    expect(ops.broadcastChat).toHaveBeenCalledTimes(1);
    const payload = ops.broadcastChat.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({
        runId,
        sessionKey,
        seq: 3,
        state: "aborted",
        stopReason: "user",
      }),
    );
    expect(payload.message).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "  Partial reply  " }],
      }),
    );
    expect((payload.message as { timestamp?: unknown }).timestamp).toEqual(expect.any(Number));
    expect(ops.nodeSendToSession).toHaveBeenCalledWith(sessionKey, "chat", payload);
  });

  it("omits aborted message when buffered text is empty", () => {
    const runId = "run-1";
    const sessionKey = "main";
    const entry = createActiveEntry(sessionKey);
    const ops = createOps({ runId, entry, buffer: "   " });

    const result = abortChatRunById(ops, { runId, sessionKey });

    expect(result).toMatchObject({ aborted: true });
    const payload = ops.broadcastChat.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.message).toBeUndefined();
  });

  it("preserves partial message even when abort listeners clear buffers synchronously", () => {
    const runId = "run-1";
    const sessionKey = "main";
    const entry = createActiveEntry(sessionKey);
    const ops = createOps({ runId, entry, buffer: "streamed text" });

    // Simulate synchronous cleanup triggered by AbortController listeners.
    entry.controller.signal.addEventListener("abort", () => {
      ops.chatRunBuffers.delete(runId);
    });

    const result = abortChatRunById(ops, { runId, sessionKey });

    expect(result).toMatchObject({ aborted: true });
    const payload = ops.broadcastChat.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.message).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "streamed text" }],
      }),
    );
  });
});

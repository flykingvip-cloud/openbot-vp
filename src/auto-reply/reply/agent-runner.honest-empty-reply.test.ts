import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listEvolutionLoopLogsForTests,
  resetEvolutionLoopLogsForTests,
} from "../../gateway/evolution-control/evolution-loop-log.js";
import type { TemplateContext } from "../templating.js";
import type { GetReplyOptions } from "../types.js";
import { HONEST_EMPTY_REPLY_EN, HONEST_EMPTY_REPLY_ZH } from "./honest-empty-reply.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const replyFilter = vi.hoisted(() => ({ enabled: false }));
vi.mock("./turn-reply-language.js", async () => {
  const actual = await vi.importActual<typeof import("./turn-reply-language.js")>(
    "./turn-reply-language.js",
  );
  return {
    ...actual,
    sanitizeTurnVisibleReply: (params: Parameters<typeof actual.sanitizeTurnVisibleReply>[0]) =>
      replyFilter.enabled
        ? { ok: false, reason: "wrong_language_planning" }
        : actual.sanitizeTurnVisibleReply(params),
  };
});

const runEmbeddedPiAgentMock = vi.fn();
const runWithModelFallbackMock = vi.fn();

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: (params: unknown) => runWithModelFallbackMock(params),
}));

vi.mock("../../agents/pi-embedded.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/pi-embedded.js")>(
    "../../agents/pi-embedded.js",
  );
  return {
    ...actual,
    queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
    runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
  };
});

vi.mock("./queue.js", async () => {
  const actual = await vi.importActual<typeof import("./queue.js")>("./queue.js");
  return { ...actual, enqueueFollowupRun: vi.fn(), scheduleFollowupDrain: vi.fn() };
});

import { runReplyAgent } from "./agent-runner.js";

const meta = { agentMeta: { sessionId: "session", provider: "anthropic", model: "claude" } };

function followupRun(): FollowupRun {
  return {
    prompt: "hi",
    enqueuedAt: Date.now(),
    run: {
      agentId: "bot-2",
      agentDir: "/tmp/agent",
      sessionId: "session",
      sessionKey: "main",
      messageProvider: "webchat",
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
  } as unknown as FollowupRun;
}

async function run(params: {
  ctx?: Partial<TemplateContext>;
  opts?: GetReplyOptions;
  blockStreamingEnabled?: boolean;
}) {
  return await runReplyAgent({
    commandBody: "hi",
    followupRun: followupRun(),
    queueKey: "main",
    resolvedQueue: { mode: "interrupt" } as QueueSettings,
    shouldSteer: false,
    shouldFollowup: false,
    isActive: false,
    isStreaming: false,
    opts: params.opts,
    typing: createMockTypingController(),
    sessionCtx: {
      Provider: "webchat",
      Surface: "webchat",
      ChatType: "direct",
      MessageSid: "msg-1",
      ...params.ctx,
    } as unknown as TemplateContext,
    defaultModel: "anthropic/claude",
    resolvedVerboseLevel: "off",
    isNewSession: false,
    blockStreamingEnabled: params.blockStreamingEnabled ?? false,
    resolvedBlockStreamingBreak: "message_end",
    shouldInjectGroupIntro: false,
    typingMode: "instant",
  });
}

function gapEvents() {
  return listEvolutionLoopLogsForTests().filter(
    (r) => r.event === "evolution.capability.gap_recorded",
  );
}

describe("runReplyAgent honest empty reply (private chat only)", () => {
  beforeEach(() => {
    resetEvolutionLoopLogsForTests();
    replyFilter.enabled = false;
    runEmbeddedPiAgentMock.mockReset();
    runWithModelFallbackMock.mockReset();
    runWithModelFallbackMock.mockImplementation(
      async ({
        provider,
        model,
        run: runFn,
      }: {
        provider: string;
        model: string;
        run: (...args: unknown[]) => Promise<unknown>;
      }) => ({ result: await runFn(provider, model), provider, model }),
    );
  });
  afterEach(() => {
    resetEvolutionLoopLogsForTests();
  });

  it("private chat NO_REPLY → honest zh fallback + gap event", async () => {
    runEmbeddedPiAgentMock.mockResolvedValue({ payloads: [{ text: "NO_REPLY" }], meta });
    const result = await run({});
    expect(result).toEqual({ text: HONEST_EMPTY_REPLY_ZH });
    expect(gapEvents()).toHaveLength(1);
    expect(gapEvents()[0]).toMatchObject({
      agentId: "bot-2",
      reason: "direct_chat_silent_or_empty_reply",
    });
  });

  it("private chat empty payloads → honest en fallback when expected language is en", async () => {
    runEmbeddedPiAgentMock.mockResolvedValue({ payloads: [], meta });
    const result = await run({ opts: { expectedReplyLanguage: "en" } });
    expect(result).toEqual({ text: HONEST_EMPTY_REPLY_EN });
  });

  it("group chat NO_REPLY ('nothing to say') stays silent", async () => {
    runEmbeddedPiAgentMock.mockResolvedValue({ payloads: [{ text: "NO_REPLY" }], meta });
    const result = await run({ ctx: { ChatType: "group", GroupSubject: "Market" } });
    expect(result).toBeUndefined();
    expect(gapEvents()).toHaveLength(0);
  });

  it("collaboration round NO_REPLY stays silent", async () => {
    runEmbeddedPiAgentMock.mockResolvedValue({ payloads: [{ text: "NO_REPLY" }], meta });
    const result = await run({
      ctx: { CollaborationGroupId: "space-1", CollaborationRoundInvoked: true },
    });
    expect(result).toBeUndefined();
    expect(gapEvents()).toHaveLength(0);
  });

  it("internal system event in a direct session stays silent", async () => {
    runEmbeddedPiAgentMock.mockResolvedValue({ payloads: [{ text: "NO_REPLY" }], meta });
    const result = await run({ ctx: { InputProvenance: { kind: "internal_system" } } });
    expect(result).toBeUndefined();
  });

  it("heartbeat stays silent", async () => {
    runEmbeddedPiAgentMock.mockResolvedValue({ payloads: [{ text: "NO_REPLY" }], meta });
    const result = await run({ opts: { isHeartbeat: true } });
    expect(result).toBeUndefined();
  });

  it("block streaming already delivered (shouldDropFinalPayloads) → no fallback", async () => {
    const onBlockReply = vi.fn();
    runEmbeddedPiAgentMock.mockImplementation(
      async (params: { onBlockReply?: (p: { text: string }) => Promise<void> | void }) => {
        await params.onBlockReply?.({ text: "streamed answer" });
        return { payloads: [{ text: "streamed answer" }], meta };
      },
    );
    const result = await run({ opts: { onBlockReply }, blockStreamingEnabled: true });
    expect(onBlockReply).toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(gapEvents()).toHaveLength(0);
  });

  it("TTS/image tool result already delivered → no fallback", async () => {
    const onToolResult = vi.fn();
    runEmbeddedPiAgentMock.mockImplementation(
      async (params: {
        onToolResult?: (p: { text?: string; mediaUrl?: string }) => Promise<void> | void;
      }) => {
        void params.onToolResult?.({ text: "voice reply", mediaUrl: "/tmp/tts.opus" });
        return { payloads: [{ text: "NO_REPLY" }], meta };
      },
    );
    const result = await run({ opts: { onToolResult } });
    expect(onToolResult).toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(gapEvents()).toHaveLength(0);
  });

  it("messaging tool already sent → no fallback", async () => {
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "NO_REPLY" }],
      meta,
      didSendViaMessagingTool: true,
      messagingToolSentTexts: ["sent via tool"],
    });
    const result = await run({});
    expect(result).toBeUndefined();
    expect(gapEvents()).toHaveLength(0);
  });

  it("private chat with a real reply is unchanged", async () => {
    runEmbeddedPiAgentMock.mockResolvedValue({ payloads: [{ text: "你好" }], meta });
    const result = await run({});
    expect(result).toMatchObject({ text: "你好" });
    expect(gapEvents()).toHaveLength(0);
  });

  it("user Stop / abort with empty payloads → no fallback and no gap", async () => {
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "NO_REPLY" }],
      meta: { ...meta, aborted: true },
    });
    const result = await run({});
    expect(result).toBeUndefined();
    expect(gapEvents()).toHaveLength(0);
  });

  it("emoji reaction delivered + NO_REPLY → no fallback (counts as delivery)", async () => {
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "NO_REPLY" }],
      meta,
      didSendViaMessagingTool: true,
    });
    const result = await run({});
    expect(result).toBeUndefined();
    expect(gapEvents()).toHaveLength(0);
  });

  it("filtered final without tools stays silent rather than emitting an empty-turn fallback", async () => {
    replyFilter.enabled = true;
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "Hello." }],
      meta,
    });
    const result = await run({ opts: { expectedReplyLanguage: "en" } });
    expect(result).toBeUndefined();
    expect(gapEvents()).toHaveLength(0);
  });

  it("filtered final after a tool result emits a process placeholder through the original entry", async () => {
    replyFilter.enabled = true;
    runEmbeddedPiAgentMock.mockImplementation(
      async (params: {
        onAgentEvent?: (event: { stream: string; data: Record<string, unknown> }) => Promise<void>;
      }) => {
        await params.onAgentEvent?.({
          stream: "tool",
          data: { phase: "result", name: "read", isError: false },
        });
        return { payloads: [{ text: "Hello." }], meta };
      },
    );
    const result = await run({ opts: { expectedReplyLanguage: "en" } });
    expect(result).toEqual({ text: "Looking this up." });
    expect(gapEvents()).toHaveLength(0);
  });

  it("evolution store EIO must not fail an ordinary hello reply", async () => {
    const { ensureEvolutionControlPlaneStarted } =
      await import("../../gateway/evolution-control/bootstrap.js");
    const plane = ensureEvolutionControlPlaneStarted();
    const original = plane.listProposals.bind(plane);
    plane.listProposals = () => {
      throw new Error("EIO proposals.json");
    };
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "hello" }],
      meta,
    });
    const result = await run({});
    expect(result).toMatchObject({ text: "hello" });
    plane.listProposals = original;
  });
});

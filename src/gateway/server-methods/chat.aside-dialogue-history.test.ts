/**
 * Real chat.history path must paint mid-task aside sidecar turns so refresh /
 * reconnect / A-ended follow-up can recover bubbles (without co-writing A's jsonl).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendAsideDialogueTurn,
  mergeChatHistoryWithAsideDialogue,
  stableDialogueMessageIdentity,
} from "../../auto-reply/reply/mid-task-aside-dialogue-history.js";
import { __setMaxChatHistoryMessagesBytesForTest } from "../server-constants.js";
import type { GatewayRequestContext } from "./types.js";

const mockState = vi.hoisted(() => ({
  transcriptPath: "",
  sessionId: "sess-aside-history",
}));

vi.mock("../tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...original,
    loadSessionEntryForClient: async (rawKey: string) => ({
      cfg: { session: { mainKey: "main" } },
      storePath: path.join(path.dirname(mockState.transcriptPath), "sessions.json"),
      entry: {
        sessionId: mockState.sessionId,
        sessionFile: mockState.transcriptPath,
      },
      canonicalKey: rawKey || "agent:main:main",
    }),
  };
});

const { chatHandlers, boundChatHistoryMessages } = await import("./chat.js");

const sessionKey = "agent:main:main";

function createTranscriptWithMainTurns() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-aside-history-"));
  const transcriptPath = path.join(dir, "sess.jsonl");
  const lines = [
    JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: mockState.sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: "/tmp",
    }),
    JSON.stringify({
      type: "message",
      id: "m-a-user",
      timestamp: new Date(1_000).toISOString(),
      message: {
        role: "user",
        content: [{ type: "text", text: "请继续调研手机市场" }],
        timestamp: 1_000,
      },
    }),
    JSON.stringify({
      type: "message",
      id: "m-a-asst",
      timestamp: new Date(2_000).toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "text", text: "A 进度：已收集三款机型" }],
        timestamp: 2_000,
      },
    }),
  ];
  fs.writeFileSync(transcriptPath, `${lines.join("\n")}\n`, "utf-8");
  mockState.transcriptPath = transcriptPath;
  return dir;
}

function context(): GatewayRequestContext {
  return {
    broadcast: vi.fn(),
    broadcastChat: vi.fn(),
    nodeSendToSession: vi.fn(),
    agentRunSeq: new Map(),
    chatAbortControllers: new Map(),
    chatRunBuffers: new Map(),
    chatDeltaSentAt: new Map(),
    chatAbortedRuns: new Map(),
    removeChatRun: vi.fn(),
    dedupe: new Map(),
    registerToolEventRecipient: vi.fn(),
    loadGatewayModelCatalog: vi.fn(async () => []),
    logGateway: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
  } as unknown as GatewayRequestContext;
}

function collectTexts(messages: unknown[]): string[] {
  const out: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      out.push(content);
      continue;
    }
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        out.push((block as { text: string }).text);
      }
    }
  }
  return out;
}

describe("chat.history aside dialogue recovery", () => {
  let dir = "";

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = "";
    }
    mockState.transcriptPath = "";
  });

  it("merge helper keeps A and B ordered by time", () => {
    dir = createTranscriptWithMainTurns();
    appendAsideDialogueTurn(mockState.transcriptPath, {
      atMs: 1_500,
      runId: "run-b1",
      role: "user",
      text: "今天北京天气怎么样",
    });
    appendAsideDialogueTurn(mockState.transcriptPath, {
      atMs: 1_600,
      runId: "run-b1",
      role: "assistant",
      text: "北京今天晴。",
    });
    const transcriptOnly = [
      {
        role: "user",
        timestamp: 1_000,
        content: [{ type: "text", text: "请继续调研手机市场" }],
      },
      {
        role: "assistant",
        timestamp: 2_000,
        content: [{ type: "text", text: "A 进度：已收集三款机型" }],
      },
    ];
    const merged = mergeChatHistoryWithAsideDialogue({
      messages: transcriptOnly,
      parentSessionFile: mockState.transcriptPath,
    });
    const texts = collectTexts(merged);
    expect(texts.indexOf("请继续调研手机市场")).toBeLessThan(texts.indexOf("今天北京天气怎么样"));
    expect(texts.indexOf("北京今天晴。")).toBeLessThan(texts.indexOf("A 进度：已收集三款机型"));
  });

  it("chat.history paints aside bubbles after refresh (and after A-ended)", async () => {
    dir = createTranscriptWithMainTurns();
    appendAsideDialogueTurn(mockState.transcriptPath, {
      atMs: 3_000,
      runId: "run-b-refresh",
      role: "user",
      text: "解释刚才那一点",
    });
    appendAsideDialogueTurn(mockState.transcriptPath, {
      atMs: 3_100,
      runId: "run-b-refresh",
      role: "assistant",
      text: "刚才是指三款机型的续航对比。",
    });

    // A ends: append a completion line on the main transcript.
    fs.appendFileSync(
      mockState.transcriptPath,
      `${JSON.stringify({
        type: "message",
        id: "m-a-done",
        timestamp: new Date(4_000).toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "text", text: "A 已完成调研报告。" }],
          timestamp: 4_000,
        },
      })}\n`,
      "utf-8",
    );

    const respond = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey },
      respond,
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: context(),
    });
    expect(respond.mock.calls.at(-1)?.[0]).toBe(true);
    const payload = respond.mock.calls.at(-1)?.[1] as { messages?: unknown[] };
    const texts = collectTexts(payload.messages ?? []);
    expect(texts.some((t) => t.includes("解释刚才那一点"))).toBe(true);
    expect(texts.some((t) => t.includes("三款机型的续航对比"))).toBe(true);
    expect(texts.some((t) => t.includes("A 已完成调研报告"))).toBe(true);
    expect(texts.some((t) => t.includes("已收集三款机型"))).toBe(true);
  });

  it("multi-round B then A new reply: history keeps both for follow-up", async () => {
    dir = createTranscriptWithMainTurns();
    for (let i = 0; i < 14; i += 1) {
      appendAsideDialogueTurn(mockState.transcriptPath, {
        atMs: 5_000 + i,
        runId: `b-round-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        text: `多轮B内容-${i}`,
      });
    }
    fs.appendFileSync(
      mockState.transcriptPath,
      `${JSON.stringify({
        type: "message",
        id: "m-a-new",
        timestamp: new Date(9_000).toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "text", text: "A 新回复：已加上欧洲市场" }],
          timestamp: 9_000,
        },
      })}\n`,
      "utf-8",
    );

    const respond = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey, limit: 50 },
      respond,
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: context(),
    });
    expect(respond.mock.calls.at(-1)?.[0]).toBe(true);
    const payload = respond.mock.calls.at(-1)?.[1] as { messages?: unknown[] };
    const texts = collectTexts(payload.messages ?? []);
    expect(texts.some((t) => t.includes("A 新回复：已加上欧洲市场"))).toBe(true);
    expect(texts.some((t) => t.includes("多轮B内容-"))).toBe(true);
  });

  it("merge then unified bound: sidecar cannot bypass history limit", async () => {
    dir = createTranscriptWithMainTurns();
    for (let i = 0; i < 40; i += 1) {
      appendAsideDialogueTurn(mockState.transcriptPath, {
        atMs: 10_000 + i,
        runId: `flood-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        text: `旁路洪水-${i}`,
      });
    }
    const respond = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey, limit: 8 },
      respond,
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: context(),
    });
    expect(respond.mock.calls.at(-1)?.[0]).toBe(true);
    const payload = respond.mock.calls.at(-1)?.[1] as { messages?: unknown[] };
    const messages = payload.messages ?? [];
    expect(messages.length).toBeLessThanOrEqual(8);
    // Pre-bound merge of 2 transcript + 40 aside would be >> 8 without re-bound.
    const mergedOnly = mergeChatHistoryWithAsideDialogue({
      messages: [
        {
          role: "user",
          timestamp: 1_000,
          content: [{ type: "text", text: "请继续调研手机市场" }],
        },
        {
          role: "assistant",
          timestamp: 2_000,
          content: [{ type: "text", text: "A 进度：已收集三款机型" }],
        },
      ],
      parentSessionFile: mockState.transcriptPath,
    });
    expect(mergedOnly.length).toBeGreaterThan(8);
    const rebounded = boundChatHistoryMessages({
      rawMessages: mergedOnly,
      limit: 8,
      includeTools: false,
      historyCursorEnabled: false,
    });
    expect(rebounded.messages.length).toBeLessThanOrEqual(8);
  });

  it("cross-source stable identity dedupes same user message in transcript and sidecar", () => {
    dir = createTranscriptWithMainTurns();
    appendAsideDialogueTurn(mockState.transcriptPath, {
      atMs: 1_000,
      runId: "run-b-dup",
      role: "user",
      text: "请继续调研手机市场",
      messageId: "m-a-user",
    });
    appendAsideDialogueTurn(mockState.transcriptPath, {
      atMs: 1_050,
      runId: "run-b-dup",
      role: "assistant",
      text: "这是旁路回答。",
    });
    const transcript = [
      {
        role: "user",
        id: "m-a-user",
        messageId: "m-a-user",
        timestamp: 1_000,
        content: [{ type: "text", text: "请继续调研手机市场" }],
      },
      {
        role: "assistant",
        id: "m-a-asst",
        timestamp: 2_000,
        content: [{ type: "text", text: "A 进度：已收集三款机型" }],
      },
    ];
    const merged = mergeChatHistoryWithAsideDialogue({
      messages: transcript,
      parentSessionFile: mockState.transcriptPath,
    });
    const texts = collectTexts(merged);
    expect(texts.filter((t) => t === "请继续调研手机市场")).toHaveLength(1);
    expect(texts.some((t) => t.includes("这是旁路回答"))).toBe(true);
    // Identity must not rely on transcript:/aside: source prefixes.
    expect(
      stableDialogueMessageIdentity({
        messageId: "m-a-user",
        role: "user",
        text: "请继续调研手机市场",
      }),
    ).toBe("mid:m-a-user");
    expect(
      stableDialogueMessageIdentity({
        messageId: "aside:run-b-dup:user:1000",
        role: "user",
        text: "请继续调研手机市场",
      }),
    ).toBeNull();
  });

  it("does not fold repeated short asks that lack a shared stable identity", () => {
    dir = createTranscriptWithMainTurns();
    appendAsideDialogueTurn(mockState.transcriptPath, {
      atMs: 10_000,
      runId: "run-b-why-1",
      role: "user",
      text: "为什么",
    });
    appendAsideDialogueTurn(mockState.transcriptPath, {
      atMs: 10_100,
      runId: "run-b-why-1",
      role: "assistant",
      text: "因为样本不同。",
    });
    appendAsideDialogueTurn(mockState.transcriptPath, {
      atMs: 20_000,
      runId: "run-b-why-2",
      role: "user",
      text: "为什么",
    });
    appendAsideDialogueTurn(mockState.transcriptPath, {
      atMs: 20_100,
      runId: "run-b-why-2",
      role: "assistant",
      text: "因为口径不同。",
    });
    const transcript = [
      {
        role: "user",
        id: "m-why-main",
        messageId: "m-why-main",
        timestamp: 15_000,
        content: [{ type: "text", text: "为什么" }],
      },
      {
        role: "user",
        timestamp: 25_000,
        content: [{ type: "text", text: "继续" }],
      },
      {
        role: "user",
        timestamp: 26_000,
        content: [{ type: "text", text: "继续" }],
      },
    ];
    const merged = mergeChatHistoryWithAsideDialogue({
      messages: transcript,
      parentSessionFile: mockState.transcriptPath,
    });
    const texts = collectTexts(merged);
    expect(texts.filter((t) => t === "为什么")).toHaveLength(3);
    expect(texts.filter((t) => t === "继续")).toHaveLength(2);
  });

  it("chat.history byte budget still applies after aside merge", async () => {
    dir = createTranscriptWithMainTurns();
    const previous = undefined;
    __setMaxChatHistoryMessagesBytesForTest(2_500);
    try {
      for (let i = 0; i < 30; i += 1) {
        appendAsideDialogueTurn(mockState.transcriptPath, {
          atMs: 20_000 + i,
          runId: `bytes-${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          text: `旁路大段内容-${i}-` + "x".repeat(200),
        });
      }
      const respond = vi.fn();
      await chatHandlers["chat.history"]({
        params: { sessionKey, limit: 200 },
        respond,
        req: {} as never,
        client: null as never,
        isWebchatConnect: () => false,
        context: context(),
      });
      expect(respond.mock.calls.at(-1)?.[0]).toBe(true);
      const payload = respond.mock.calls.at(-1)?.[1] as { messages?: unknown[] };
      const bytes = Buffer.byteLength(JSON.stringify(payload.messages ?? []), "utf8");
      expect(bytes).toBeLessThanOrEqual(2_500);
    } finally {
      __setMaxChatHistoryMessagesBytesForTest(previous);
    }
  });
});

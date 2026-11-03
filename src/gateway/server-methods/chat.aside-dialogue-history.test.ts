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
} from "../../auto-reply/reply/mid-task-aside-reply-lane.js";
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

const { chatHandlers } = await import("./chat.js");

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
});

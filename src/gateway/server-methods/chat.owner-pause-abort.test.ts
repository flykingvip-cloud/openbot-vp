/**
 * Gateway chat.send owner pause/cancel: real entry must abort the active run,
 * not start a new business turn, clear the followup queue, and leave stop state.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../../auto-reply/templating.js";
import {
  emptySessionTaskBoard,
  readSessionTaskBoard,
  writeSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import { claimTaskBoardContinue } from "../../conversation-task/task-board-continue.js";
import type { GatewayRequestContext } from "./types.js";

const mockState = vi.hoisted(() => ({
  transcriptPath: "",
  sessionId: "sess-owner-pause",
  mainSessionKey: "main",
  sessionEntry: {} as Record<string, unknown>,
  lastDispatchCtx: undefined as MsgContext | undefined,
  dispatchCount: 0,
}));

const clearSessionQueuesMock = vi.hoisted(() =>
  vi.fn(() => ({ followupCleared: 1, laneCleared: 0, keys: ["main"] })),
);
const abortEmbeddedPiRunMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    loadSessionEntry: (rawKey: string) => ({
      cfg: {
        session: {
          mainKey: mockState.mainSessionKey,
        },
      },
      storePath: path.join(path.dirname(mockState.transcriptPath), "sessions.json"),
      entry: {
        sessionId: mockState.sessionId,
        sessionFile: mockState.transcriptPath,
        ...mockState.sessionEntry,
      },
      canonicalKey: rawKey || "main",
    }),
  };
});

vi.mock("../tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...original,
    loadSessionEntryForClient: async (rawKey: string) => ({
      cfg: {
        session: {
          mainKey: mockState.mainSessionKey,
        },
      },
      storePath: path.join(path.dirname(mockState.transcriptPath), "sessions.json"),
      entry: {
        sessionId: mockState.sessionId,
        sessionFile: mockState.transcriptPath,
        ...mockState.sessionEntry,
      },
      canonicalKey: rawKey || "main",
      resolveAgentStorePath: (agentId: string) =>
        path.join(path.dirname(mockState.transcriptPath), agentId, "sessions", "sessions.json"),
    }),
  };
});

vi.mock("../../auto-reply/dispatch.js", () => ({
  dispatchInboundMessage: vi.fn(async (params: { ctx: MsgContext }) => {
    mockState.dispatchCount += 1;
    mockState.lastDispatchCtx = params.ctx;
    return { ok: true };
  }),
}));

vi.mock("../../auto-reply/reply/queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../auto-reply/reply/queue.js")>();
  return {
    ...actual,
    clearSessionQueues: (...args: unknown[]) => clearSessionQueuesMock(...args),
  };
});

vi.mock("../../agents/pi-embedded.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/pi-embedded.js")>();
  return {
    ...actual,
    abortEmbeddedPiRun: (...args: unknown[]) => abortEmbeddedPiRunMock(...args),
  };
});

const { chatHandlers } = await import("./chat.js");
const { dispatchInboundMessage } = await import("../../auto-reply/dispatch.js");

function createTranscriptWithBoard(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const transcriptPath = path.join(dir, "sess.jsonl");
  fs.writeFileSync(
    transcriptPath,
    `${JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: mockState.sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: "/tmp",
    })}\n`,
    "utf-8",
  );
  mockState.transcriptPath = transcriptPath;
  const board = emptySessionTaskBoard();
  board.focusRevision = 4;
  board.current = {
    taskId: "task-a",
    title: "手机调研",
    goalText: "调研国内手机市场并写报告",
    unfinished: true,
    stop: { summary: "正在抓取评测站点", workspacePaths: [] },
    createdAtMs: Date.now(),
  };
  writeSessionTaskBoard(transcriptPath, board);
  return { dir, transcriptPath };
}

function createChatContext(): Pick<
  GatewayRequestContext,
  | "broadcast"
  | "broadcastChat"
  | "nodeSendToSession"
  | "agentRunSeq"
  | "chatAbortControllers"
  | "chatRunBuffers"
  | "chatDeltaSentAt"
  | "chatAbortedRuns"
  | "removeChatRun"
  | "dedupe"
  | "registerToolEventRecipient"
  | "logGateway"
> {
  return {
    broadcast: vi.fn() as unknown as GatewayRequestContext["broadcast"],
    broadcastChat: vi.fn() as unknown as GatewayRequestContext["broadcastChat"],
    nodeSendToSession: vi.fn() as unknown as GatewayRequestContext["nodeSendToSession"],
    agentRunSeq: new Map<string, number>(),
    chatAbortControllers: new Map(),
    chatRunBuffers: new Map(),
    chatDeltaSentAt: new Map(),
    chatAbortedRuns: new Map(),
    removeChatRun: vi
      .fn()
      .mockImplementation((runId: string) => ({ sessionKey: "main", clientRunId: runId })),
    dedupe: new Map(),
    registerToolEventRecipient: vi.fn(),
    logGateway: {
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as GatewayRequestContext["logGateway"],
  };
}

afterEach(() => {
  mockState.dispatchCount = 0;
  mockState.lastDispatchCtx = undefined;
  mockState.sessionEntry = {};
  clearSessionQueuesMock.mockClear();
  abortEmbeddedPiRunMock.mockClear();
  vi.mocked(dispatchInboundMessage).mockClear();
});

describe("gateway chat.send owner pause/cancel stop sequence", () => {
  it("暂停 via chat.send aborts active run, skips dispatch, clears queue, keeps stop state", async () => {
    const { dir, transcriptPath } = createTranscriptWithBoard("openclaw-owner-pause-");
    try {
      const activeRunId = "run-a-active";
      const active = {
        controller: new AbortController(),
        sessionId: mockState.sessionId,
        sessionKey: "main",
        startedAtMs: Date.now(),
        expiresAtMs: Date.now() + 30_000,
        userMessageText: "调研国内手机",
      };
      const context = createChatContext();
      context.chatAbortControllers.set(activeRunId, active);
      context.chatRunBuffers.set(activeRunId, "正在检索评测…");
      context.chatDeltaSentAt.set(activeRunId, Date.now());
      context.agentRunSeq.set(activeRunId, 2);

      const respond = vi.fn();
      const pauseIdem = "idem-owner-pause-1";

      await chatHandlers["chat.send"]({
        params: {
          sessionKey: "main",
          message: "暂停",
          idempotencyKey: pauseIdem,
        },
        respond: respond as never,
        req: {} as never,
        client: null,
        isWebchatConnect: () => false,
        context: context as GatewayRequestContext,
      });

      // Active business run aborted.
      expect(active.controller.signal.aborted).toBe(true);
      expect(context.chatAbortControllers.has(activeRunId)).toBe(false);
      expect(abortEmbeddedPiRunMock).toHaveBeenCalledWith(mockState.sessionId);
      expect(clearSessionQueuesMock).toHaveBeenCalled();

      // No new business turn / inbound dispatch for the control utterance.
      expect(mockState.dispatchCount).toBe(0);
      expect(dispatchInboundMessage).not.toHaveBeenCalled();

      // RPC ack + final stop status for the UI.
      expect(respond).toHaveBeenCalled();
      const ack = respond.mock.calls.find((call) => call[0] === true)?.[1] as
        | { status?: string; taskStatusLine?: string; runId?: string }
        | undefined;
      expect(ack?.status).toBe("started");
      expect(ack?.taskStatusLine).toMatch(/暂停|停止新增业务动作/);

      const finals = (context.broadcastChat as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => call[1])
        .filter(
          (payload) =>
            payload &&
            typeof payload === "object" &&
            (payload as { state?: string }).state === "final",
        );
      expect(finals.length).toBeGreaterThan(0);
      const finalText = JSON.stringify(finals);
      expect(finalText).toMatch(/暂停|停止新增业务动作/);

      // Board stop state: wakeSuppress + claim rejects stale wake.
      const board = readSessionTaskBoard(transcriptPath);
      expect(board.current?.wakeSuppress).toBe(true);
      expect(board.current?.taskId).toBe("task-a");
      expect(board.focusRevision).toBe(4);
      const claim = claimTaskBoardContinue({
        sessionFile: transcriptPath,
        taskId: "task-a",
        focusRevision: 4,
      });
      expect(claim.ok).toBe(false);
      if (!claim.ok) {
        expect(claim.reason).toBe("wake_suppress");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("取消当前 via chat.send aborts activity and does not dispatch a business turn", async () => {
    const { dir, transcriptPath } = createTranscriptWithBoard("openclaw-owner-cancel-");
    try {
      const activeRunId = "run-a-cancel";
      const active = {
        controller: new AbortController(),
        sessionId: mockState.sessionId,
        sessionKey: "main",
        startedAtMs: Date.now(),
        expiresAtMs: Date.now() + 30_000,
      };
      const context = createChatContext();
      context.chatAbortControllers.set(activeRunId, active);
      context.chatRunBuffers.set(activeRunId, "partial");

      const respond = vi.fn();
      await chatHandlers["chat.send"]({
        params: {
          sessionKey: "main",
          message: "取消当前",
          idempotencyKey: "idem-owner-cancel-1",
        },
        respond: respond as never,
        req: {} as never,
        client: null,
        isWebchatConnect: () => false,
        context: context as GatewayRequestContext,
      });

      expect(active.controller.signal.aborted).toBe(true);
      expect(dispatchInboundMessage).not.toHaveBeenCalled();
      expect(clearSessionQueuesMock).toHaveBeenCalled();
      const board = readSessionTaskBoard(transcriptPath);
      expect(board.current).toBeUndefined();
      expect(board.tombstones?.some((t) => t.taskId === "task-a")).toBe(true);
      const ack = respond.mock.calls.find((call) => call[0] === true)?.[1] as
        | { taskStatusLine?: string }
        | undefined;
      expect(ack?.taskStatusLine).toMatch(/取消/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

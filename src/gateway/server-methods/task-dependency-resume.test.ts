import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import type { MsgContext } from "../../auto-reply/templating.js";
import type { GatewayRequestContext } from "./types.js";

const mockState = vi.hoisted(() => ({
  transcriptPath: "",
  sessionId: "sess-1",
  mainSessionKey: "main",
  finalText: "[[reply_to_current]]",
  triggerAgentRunStart: false,
  agentRunId: "run-agent-1",
  sessionEntry: {} as Record<string, unknown>,
  lastDispatchCtx: undefined as MsgContext | undefined,
  replyOptions: undefined as Record<string, unknown> | undefined,
}));

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
  dispatchInboundMessage: vi.fn(
    async (params: {
      ctx: MsgContext;
      dispatcher: {
        sendFinalReply: (payload: { text: string }) => boolean;
        markComplete: () => void;
        waitForIdle: () => Promise<void>;
      };
      replyOptions?: {
        onAgentRunStart?: (runId: string) => void;
      };
    }) => {
      mockState.lastDispatchCtx = params.ctx;
      mockState.replyOptions = params.replyOptions as Record<string, unknown>;
      if (mockState.triggerAgentRunStart) {
        params.replyOptions?.onAgentRunStart?.(mockState.agentRunId);
      }
      params.dispatcher.sendFinalReply({ text: mockState.finalText });
      params.dispatcher.markComplete();
      await params.dispatcher.waitForIdle();
      return { ok: true };
    },
  ),
}));

vi.mock("../../conversation-task/private-dependency-runtime.js", async (original) => ({
  ...(await original<typeof import("../../conversation-task/private-dependency-runtime.js")>()),
  authorizePrivateDependency: vi.fn(async () => true),
}));
vi.mock("../employee-workbench-scope.js", async (original) => ({
  ...(await original<typeof import("../employee-workbench-scope.js")>()),
  requiresEmployeeAssetScope: () => false,
}));
vi.mock("../employee-steward-session.js", async (original) => ({
  ...(await original<typeof import("../employee-steward-session.js")>()),
  resolveEmployeeScopedChatSessionKey: async (_client: unknown, key: string) => key,
  employeeGlobalStewardTranscriptBlocked: () => false,
}));
vi.mock("../employee-workbench-actor-restore.js", async (original) => ({
  ...(await original<typeof import("../employee-workbench-actor-restore.js")>()),
  restorePersonalWorkbenchActor: async () => ({ ok: true }),
}));
const { chatHandlers } = await import("./chat.js");
const { reservePrivateDependency, updatePrivateDependency } =
  await import("../../conversation-task/private-dependency-store.js");
const { seedSessionTaskBoard, readSessionTaskBoard } =
  await import("../../agent-runtime/state/repository/task-board-file.js");
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
    removeChatRun: vi.fn(),
    dedupe: new Map(),
    registerToolEventRecipient: vi.fn(),
    logGateway: {
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as GatewayRequestContext["logGateway"],
  };
}

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  mockState.replyOptions = undefined;
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-resume-rpc-"));
  dirs.push(dir);
  vi.stubEnv("OPENBOT_STATE_DIR", dir);
  mockState.transcriptPath = path.join(dir, "sess.jsonl");
  fs.writeFileSync(
    mockState.transcriptPath,
    JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: mockState.sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: dir,
    }) + "\n",
  );
  seedSessionTaskBoard(mockState.transcriptPath, {
    focusRevision: 1,
    parked: [],
    current: {
      taskId: "parent",
      title: "Report",
      goalText: "Report",
      createdAtMs: 1,
      unfinished: true,
      executionAttempt: "parent-run",
      stop: { summary: "", workspacePaths: [] },
    },
  });
  const { row } = await reservePrivateDependency({
    toolCallId: "call",
    ownerId: "owner",
    tenantId: "tenant",
    parent: {
      sessionKey: "agent:report:main",
      sessionFile: mockState.transcriptPath,
      taskId: "parent",
      executionAttempt: "parent-run",
      focusRevision: 1,
    },
    child: { agentId: "child", sessionKey: "agent:child:main", runId: "" },
    successCriteria: "Verified report",
    deadlineAtMs: Date.now() + 1000,
  });
  await updatePrivateDependency(row.id, (r) => ({
    ...r,
    state: "completed",
    wakeState: "sending",
  }));
  return row;
}
async function send(row: Awaited<ReturnType<typeof fixture>>, capability: string) {
  const respond = vi.fn();
  const context = createChatContext();
  await chatHandlers["chat.send"]({
    params: {
      sessionKey: row.parent.sessionKey,
      message: "Review verified child result in original scope",
      idempotencyKey: row.wakeRunId,
      dependencyResumeId: row.id,
      dependencyResumeCapability: capability,
      deliver: false,
    },
    respond: respond as never,
    req: {} as never,
    client: null,
    isWebchatConnect: () => false,
    context: context as GatewayRequestContext,
  });
  return { respond, context };
}
it("a guessed capability cannot enter interaction-bypass execution", async () => {
  const row = await fixture();
  const { respond } = await send(row, "f".repeat(64));
  expect(respond.mock.calls[0]?.[0]).toBe(false);
  expect(mockState.replyOptions).toBeUndefined();
  expect(readSessionTaskBoard(mockState.transcriptPath).current?.executionAttempt).toBe(
    "parent-run",
  );
});
it("a host capability enters the real chat.send dispatch with the original task and no fresh admission", async () => {
  const row = await fixture();
  const { respond } = await send(row, row.capability);
  await vi.waitFor(() => expect(mockState.replyOptions).toBeDefined(), { timeout: 2000 });
  expect(respond.mock.calls.some((call) => call[0] === true)).toBe(true);
  expect(mockState.replyOptions?.resumedTaskBinding).toMatchObject({
    taskId: "parent",
    executionAttempt: row.wakeRunId,
  });
  expect(mockState.replyOptions?.interactionIngress).toBeUndefined();
  expect(readSessionTaskBoard(mockState.transcriptPath).parked).toEqual([]);
});

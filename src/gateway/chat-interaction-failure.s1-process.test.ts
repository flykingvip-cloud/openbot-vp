/**
 * Checkpoint A process-level consumer: isolated Gateway chat.send → actual
 * interaction host (runGovernedInteraction) → terminal persist → chat.history.
 * Model/billing adapters are stubbed and labeled; no fake final is written
 * without going through the host, and handleChatEvent is not used.
 */
import fs from "node:fs";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { makeZeroUsageSnapshot } from "../agents/usage.js";
import { runGovernedInteraction } from "../agent-runtime/command/index.js";
import {
  CHAT_TURN_ERROR_UNCONFIRMED_TEXT,
  INTERACTION_RECORD_UNAVAILABLE_TEXT,
  INTERACTION_TIMEOUT_TEXT,
} from "../agent-runtime/model/interaction-resource-wait.js";
import { bindAdmittedTurnHost } from "../agent-runtime/wiring/admitted-turn-host.js";
import { CONFIG_DIR } from "../utils.js";
import {
  readChatTurnTerminal,
  resolveChatTurnTerminalDir,
} from "./chat-interaction-failure.js";

const completeMock = vi.hoisted(() => vi.fn());
const dispatchInboundMessageMock = vi.hoisted(() => vi.fn());
const sessionEntryState = vi.hoisted(() => ({
  transcriptPath: "",
  sessionId: "",
  storePath: "",
  sessionKey: "agent:main:main",
}));

vi.mock("@earendil-works/pi-ai/compat", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-ai/compat")>()),
  complete: completeMock,
}));

vi.mock("../auto-reply/dispatch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auto-reply/dispatch.js")>();
  return {
    ...actual,
    dispatchInboundMessage: dispatchInboundMessageMock,
  };
});

vi.mock("./session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./session-utils.js")>();
  return {
    ...original,
    loadSessionEntry: () => ({
      cfg: {},
      storePath: sessionEntryState.storePath,
      entry: {
        sessionId: sessionEntryState.sessionId,
        sessionFile: sessionEntryState.transcriptPath,
      },
      canonicalKey: sessionEntryState.sessionKey,
    }),
  };
});

vi.mock("./tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./tenant-context.js")>();
  return {
    ...original,
    loadSessionEntryForClient: async () => ({
      cfg: {},
      storePath: sessionEntryState.storePath,
      entry: {
        sessionId: sessionEntryState.sessionId,
        sessionFile: sessionEntryState.transcriptPath,
      },
      canonicalKey: sessionEntryState.sessionKey,
      resolveAgentStorePath: (agentId: string) =>
        path.join(path.dirname(sessionEntryState.storePath), agentId, "sessions", "sessions.json"),
    }),
  };
});

vi.mock("./employee-workbench-scope.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./employee-workbench-scope.js")>();
  return {
    ...original,
    requiresEmployeeAssetScope: () => false,
  };
});

vi.mock("./employee-steward-session.js", () => ({
  resolveEmployeeScopedChatSessionKey: vi.fn(async (_client: unknown, raw: string) => raw.trim()),
  resolveEmployeeWorkbenchActorForClient: vi.fn(async () => null),
  applyEmployeeStewardSessionDefaults: vi.fn(),
  employeeGlobalStewardTranscriptBlocked: () => false,
}));

vi.mock("./webchat-client-platform-identity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./webchat-client-platform-identity.js")>();
  return {
    ...original,
    hydrateWebchatGatewayClientPlatformIdentity: vi.fn(
      async (params: { client: unknown }) => params.client,
    ),
    ensureGatewayClientUserFromPlatformIdentity: vi.fn(
      async (params: { client: unknown }) => params.client,
    ),
  };
});

const { chatHandlers } = await import("./server-methods/chat.js");

const model = {
  id: "test",
  provider: "test",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  contextWindow: 8192,
  maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<Api>;

const dirs: string[] = [];
const sidecarRunIds: Array<{ runId: string; sessionKey: string }> = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const { runId, sessionKey } of sidecarRunIds.splice(0)) {
    const dest = path.join(
      resolveChatTurnTerminalDir(),
      encodeURIComponent(sessionKey),
      `${encodeURIComponent(runId)}.json`,
    );
    fs.rmSync(dest, { force: true });
  }
  dispatchInboundMessageMock.mockReset();
  completeMock.mockReset();
});

function createChatContext() {
  return {
    broadcast: vi.fn(),
    broadcastChat: vi.fn(),
    nodeSendToSession: vi.fn(),
    chatAbortControllers: new Map(),
    chatRunBuffers: new Map(),
    chatDeltaSentAt: new Map(),
    agentRunSeq: new Map<string, number>(),
    removeChatRun: vi.fn(),
    registerToolEventRecipient: vi.fn(),
    loadGatewayModelCatalog: vi.fn(async () => []),
    logGateway: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    dedupe: new Map(),
  };
}

async function createFixture(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  const sessionId = "sess-s1-process";
  const sessionKey = "main";
  const transcriptPath = path.join(dir, `${sessionId}.jsonl`);
  const storePath = path.join(dir, "sessions.json");
  fs.writeFileSync(
    transcriptPath,
    `${JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: dir,
    })}\n`,
  );
  sessionEntryState.transcriptPath = transcriptPath;
  sessionEntryState.sessionId = sessionId;
  sessionEntryState.storePath = storePath;
  sessionEntryState.sessionKey = sessionKey;
  return { dir, sessionId, sessionKey, transcriptPath, storePath };
}

async function runActualInteractionHost(params: { runId: string; message: string; timeoutMs: number }) {
  const host = bindAdmittedTurnHost();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: true as const,
    skipped: false as const,
    enterpriseId: "tenant",
  }));
  host.model.runWithModelFallback = vi.fn(async (p) => ({
    result: await p.run("test", "test"),
    provider: "test",
    model: "test",
    attempts: [],
  }));
  host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {});
  host.model.forgetRunModelSet = vi.fn();
  host.task.ensureChatTurnTaskOutcome = vi.fn();
  const result = await runGovernedInteraction(
    {
      input: { message: params.message, context: [] },
      runId: params.runId,
      agentId: "bot",
      agentDir: "/tmp/agent",
      sessionFile: sessionEntryState.transcriptPath || "/tmp/missing-session.jsonl",
      requestId: params.runId,
      captured: { expectedFocusRevision: 0, expectedWriteEpoch: 0 },
      identity: {},
      authorized: true,
      config: {},
      provider: "test",
      model: "test",
      timeoutMs: params.timeoutMs,
    },
    {
      modelSession: host,
      model: host.model,
      resolveFallbacks: () => undefined,
      candidate: async () => ({ model }),
      commit: vi.fn(() => {
        throw new Error("process-level ordinary reply must not commit");
      }),
    },
  );
  return { result, host };
}

async function sendAndWait(params: {
  sessionKey: string;
  runId: string;
  message: string;
  context: ReturnType<typeof createChatContext>;
}) {
  const respond = vi.fn();
  await chatHandlers["chat.send"]({
    params: {
      sessionKey: params.sessionKey,
      message: params.message,
      idempotencyKey: params.runId,
    },
    respond: respond as never,
    context: params.context as never,
    req: {} as never,
    client: null as never,
    isWebchatConnect: () => false,
  });
  await vi.waitFor(
    () => {
      const errorForRun = params.context.broadcastChat.mock.calls
        .map((call) => call[1])
        .some(
          (payload) =>
            payload &&
            typeof payload === "object" &&
            payload.state === "error" &&
            (payload.runId === params.runId || String(payload.runId ?? "").startsWith(`${params.runId}:`)),
        );
      expect(errorForRun || params.context.dedupe.has(`chat:${params.runId}`)).toBe(true);
    },
    { timeout: 8_000 },
  );
  return respond;
}

async function readHistory(params: {
  sessionKey: string;
  context: ReturnType<typeof createChatContext>;
}) {
  const respond = vi.fn();
  await chatHandlers["chat.history"]({
    params: { sessionKey: params.sessionKey },
    respond: respond as never,
    context: params.context as never,
    req: {} as never,
    client: null as never,
    isWebchatConnect: () => false,
  });
  return respond;
}

describe("checkpoint A process-level chat.send → interaction host → chat.history", () => {
  it("keeps a live timeout receipt distinct from recovered history when persist fails, and seals none vs unknown", async () => {
    // Persist failure uses a real missing transcript file (createIfMissing=false),
    // not a fake final. Sidecars use the production CONFIG_DIR layout and are cleaned up.
    const missing = await createFixture("s1-process-missing-");
    const timeoutRunId = `run-timeout-${path.basename(missing.dir)}`;
    const unknownRunId = `run-unknown-${path.basename(missing.dir)}`;
    sidecarRunIds.push(
      { runId: timeoutRunId, sessionKey: missing.sessionKey },
      { runId: unknownRunId, sessionKey: missing.sessionKey },
    );
    expect(resolveChatTurnTerminalDir()).toBe(path.join(CONFIG_DIR, "openbot-chat-turn-terminals"));

    completeMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        role: "assistant",
        content: [{ type: "text", text: JSON.stringify({ kind: "reply", text: "迟到成功" }) }],
        usage: makeZeroUsageSnapshot(),
        stopReason: "stop",
      };
    });

    dispatchInboundMessageMock.mockImplementation(async () => {
      const { result, host } = await runActualInteractionHost({
        runId: timeoutRunId,
        message: "你好",
        timeoutMs: 30,
      });
      expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
      if (result.kind === "respond" && result.text === INTERACTION_TIMEOUT_TEXT) {
        // Real temp-file persist failure: freeze the transcript after the host
        // has already produced the timeout terminal, so the Gateway catch cannot write it.
        fs.chmodSync(missing.transcriptPath, 0o444);
        throw Object.assign(new Error("timeout"), {
          interactionPhase: "interpretation",
          reason: "timeout",
        });
      }
      throw new Error(`unexpected host result: ${JSON.stringify(result)}`);
    });

    const context = createChatContext();
    const started = Date.now();
    await sendAndWait({
      sessionKey: missing.sessionKey,
      runId: timeoutRunId,
      message: "你好",
      context,
    });
    expect(Date.now() - started).toBeLessThan(30 + 400);

    const errorPayloads = context.broadcastChat.mock.calls
      .map((call) => call[1])
      .filter((payload) => payload && typeof payload === "object" && payload.state === "error");
    expect(errorPayloads.length).toBeGreaterThan(0);
    const liveText = String(errorPayloads.at(-1)?.errorMessage ?? "");
    expect(liveText).toContain(INTERACTION_TIMEOUT_TEXT);
    expect(liveText).toContain(INTERACTION_RECORD_UNAVAILABLE_TEXT);

    const liveReceipt = readChatTurnTerminal(timeoutRunId, undefined, missing.sessionKey);
    expect(liveReceipt).toMatchObject({
      runId: timeoutRunId,
      persistedToTranscript: false,
      businessExecution: "none",
      recordTemporarilyUnavailable: true,
    });
    expect(liveReceipt?.recordTemporarilyUnavailable).toBe(true);

    // Recover: make the real transcript writable, then chat.history reconciles the same fact.
    fs.chmodSync(missing.transcriptPath, 0o644);
    const historyRespond = await readHistory({ sessionKey: missing.sessionKey, context });
    expect(historyRespond.mock.calls[0]?.[0]).toBe(true);
    const recovered = readChatTurnTerminal(timeoutRunId, undefined, missing.sessionKey);
    expect(recovered).toMatchObject({
      persistedToTranscript: true,
      businessExecution: "none",
      recordTemporarilyUnavailable: false,
    });
    const transcript = fs.readFileSync(missing.transcriptPath, "utf8");
    expect(transcript).toContain(INTERACTION_TIMEOUT_TEXT);
    expect(transcript).not.toContain("迟到成功");

    // Post-admission / unknown remains distinct and does not overwrite the timeout fact.
    dispatchInboundMessageMock.mockImplementation(async () => {
      throw new Error("tool failed after send");
    });
    await sendAndWait({
      sessionKey: missing.sessionKey,
      runId: unknownRunId,
      message: "再问一句",
      context,
    });
    expect(readChatTurnTerminal(unknownRunId, undefined, missing.sessionKey)).toMatchObject({
      businessExecution: "unknown",
      text: expect.stringContaining(CHAT_TURN_ERROR_UNCONFIRMED_TEXT),
    });
    expect(readChatTurnTerminal(timeoutRunId, undefined, missing.sessionKey)).toMatchObject({
      businessExecution: "none",
      text: expect.stringContaining(INTERACTION_TIMEOUT_TEXT),
    });
  });
});

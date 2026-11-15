import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/**
 * Isolated-Gateway consumer for checkpoint A remediations (A2).
 *
 * Shape honesty: this test invokes the in-process chat.send / chat.history
 * handlers. It does not start a child Gateway process and does not open a
 * real WebSocket. It is therefore not "process-level". What it does cover
 * is the real inbound chain: chat.send → actual dispatchInboundMessage
 * (not replaced) → get-reply-run → governed interaction → the production
 * terminal persist and chat.history reconcile consumers.
 *
 * Model `complete` and other external effects may be stubbed. Identity uses
 * an isolated trusted platform-auth fixture; client identity is not skipped.
 * Sidecars are forced under an isolated OPENBOT_STATE_DIR via live
 * resolveConfigDir(); they must not land in the user's real CONFIG_DIR.
 */
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as commandFacade from "../agent-runtime/command/index.js";
import {
  INTERACTION_RECORD_UNAVAILABLE_TEXT,
  INTERACTION_TIMEOUT_TEXT,
} from "../agent-runtime/model/interaction-resource-wait.js";
import { replyTurnRuntime } from "../agent-runtime/wiring/reply-turn.js";
import { makeZeroUsageSnapshot } from "../agents/usage.js";
import * as dispatchModule from "../auto-reply/dispatch.js";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/config.js";
import { updateSessionStore } from "../config/sessions/store.js";
import type { OpenBotConfig } from "../config/types.js";
import { resolveConfigDir } from "../utils.js";
import { readChatTurnTerminal, resolveChatTurnTerminalDir } from "./chat-interaction-failure.js";
import { resolvePlatformAuthConfig } from "./platform-auth/config.js";
import type { PlatformAuthStore } from "./platform-auth/store-types.js";
import { saveStore } from "./platform-auth/store.js";

const completeMock = vi.hoisted(() => vi.fn());

vi.mock("@earendil-works/pi-ai/compat", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-ai/compat")>()),
  complete: completeMock,
}));

const { chatHandlers } = await import("./server-methods/chat.js");

const savedEnv: Record<string, string | undefined> = {
  OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
  OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
  OPENBOT_CONFIG_PATH: process.env.OPENBOT_CONFIG_PATH,
  OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
  OPENBOT_INTERACTION_RESOURCE_WAIT_MS: process.env.OPENBOT_INTERACTION_RESOURCE_WAIT_MS,
};

const dirs: string[] = [];

afterEach(() => {
  completeMock.mockReset();
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

function payloadText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const row = payload as {
    errorMessage?: unknown;
    message?: { content?: Array<{ text?: string }> };
  };
  if (typeof row.errorMessage === "string" && row.errorMessage.trim()) {
    return row.errorMessage;
  }
  return row.message?.content?.[0]?.text ?? "";
}

async function isolateTrustedGateway() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s1a-dispatch-chain-"));
  dirs.push(root);
  process.env.OPENBOT_STATE_DIR = root;
  process.env.OPENCLAW_STATE_DIR = root;
  const configPath = path.join(root, "openbot.json");
  const platformAuthPath = path.join(root, "platform-auth.json");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;

  const now = new Date().toISOString();
  const userId = "u-s1a";
  const email = "s1a-tester@example.com";
  const enterpriseId = "ent-s1a";
  const trustedProxy = {
    userHeader: "x-forwarded-user",
    platformAuth: {
      enabled: true,
      requireMfaForPlatformAdmins: false,
      store: platformAuthPath,
    },
  };
  const cfg = {
    gateway: { auth: { trustedProxy } },
    models: {
      providers: {
        testdemo: {
          baseUrl: "http://127.0.0.1:9",
          api: "openai-completions",
          apiKey: "sk-s1a-r3-not-real",
          models: [{ id: "s1a-test", name: "s1a-test" }],
        },
      },
    },
    agents: {
      defaults: { model: { primary: "testdemo/s1a-test" } },
      list: [{ id: "main", model: { primary: "testdemo/s1a-test" } }],
    },
  } as unknown as OpenBotConfig;
  fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
  setRuntimeConfigSnapshot(cfg);
  clearConfigCache();

  const authConfig = resolvePlatformAuthConfig(trustedProxy);
  if (!authConfig) {
    throw new Error("isolated trusted platform-auth fixture failed to resolve");
  }
  const store: PlatformAuthStore = {
    version: 5,
    secret: "s1a-dispatch-chain-secret",
    policy: {
      defaultTrialDays: 14,
      allowedTrialDays: [14],
      defaultTrialSeatCount: 5,
      trialSeatOptions: [5],
      allowCustomTrialSeatCount: false,
      trialExpiryPolicy: "choose",
      trialExpiryHandling: "auto_stop",
      trialGraceDays: 0,
      updatedAt: now,
    },
    enterprises: {
      [enterpriseId]: {
        id: enterpriseId,
        name: "S1A Isolated",
        slug: "s1a",
        status: "paid",
        plan: "paid",
        billingStatus: "active",
        createdSource: "self-service",
        createdAt: now,
        updatedAt: now,
        seatQuota: 5,
        seatUsed: 1,
      },
    },
    users: {
      [userId]: {
        id: userId,
        email,
        normalizedEmail: email,
        displayName: "S1A Tester",
        passwordHash: "not-used-in-this-fixture",
        passwordUpdatedAt: now,
        loginFailedCount: 0,
        status: "active",
        source: "employee-activated",
        role: "operator",
        scopes: [],
        createdAt: now,
        updatedAt: now,
      },
    },
    sessions: {},
    memberships: {
      "m-s1a": {
        id: "m-s1a",
        userId,
        enterpriseId,
        membershipRole: "member",
        createdAt: now,
        updatedAt: now,
      },
    },
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
  };
  await saveStore(authConfig, store);

  const sessionId = "sess-s1a-dispatch";
  const sessionKey = "agent:main:main";
  const storePath = path.join(root, "agents", "main", "sessions", "sessions.json");
  const transcriptPath = path.join(root, "agents", "main", "sessions", `${sessionId}.jsonl`);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(
    transcriptPath,
    `${JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: root,
    })}\n`,
  );
  await updateSessionStore(storePath, (sessions) => {
    sessions[sessionKey] = {
      sessionId,
      sessionFile: transcriptPath,
      updatedAt: Date.now(),
    };
  });

  const client = {
    user: email,
    sessionDomain: "enterprise" as const,
    platformUserId: userId,
    sessionEnterpriseId: enterpriseId,
    sessionMembershipId: "m-s1a",
    connect: { scopes: ["operator.read", "operator.write"] },
  };

  return { root, sessionId, sessionKey, storePath, transcriptPath, client };
}

function collectJsonl(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

function turnJsonlIntoDirectories(files: string[]): void {
  for (const file of files) {
    fs.rmSync(file, { force: true });
    fs.mkdirSync(file);
  }
}

function findTerminal(context: { broadcastChat: { mock: { calls: unknown[][] } } }, runId: string) {
  return context.broadcastChat.mock.calls
    .map((call) => call[1] as { state?: string; runId?: string; sessionKey?: string } | undefined)
    .filter(
      (payload) =>
        payload &&
        typeof payload === "object" &&
        (payload.state === "error" || payload.state === "final") &&
        !String(payload.runId ?? "").endsWith(":user"),
    )
    .find(
      (payload) => payload?.runId === runId || String(payload?.runId ?? "").startsWith(`${runId}:`),
    );
}

function collectTranscriptText(root: string): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        parts.push(`${full}\n${fs.readFileSync(full, "utf8")}`);
      }
    }
  };
  walk(root);
  return parts.join("\n");
}

function sessionHeader(sessionId: string, cwd: string): string {
  return `${JSON.stringify({
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: sessionId,
    timestamp: new Date(0).toISOString(),
    cwd,
  })}\n`;
}

describe("checkpoint A isolated Gateway dispatch chain (in-process handlers, real dispatch)", () => {
  beforeEach(() => {
    completeMock.mockReset();
  });

  it("R3: an ordinary model reply has zero business execution and zero task-board writes", async () => {
    const fixture = await isolateTrustedGateway();
    const governedSpy = vi.spyOn(commandFacade, "runGovernedInteraction");
    const interactionSpy = vi.spyOn(replyTurnRuntime, "interaction");
    completeMock.mockImplementation(async () => ({
      role: "assistant",
      content: [{ type: "text", text: JSON.stringify({ kind: "reply", text: "你好，我在。" }) }],
      usage: makeZeroUsageSnapshot(),
      stopReason: "stop",
    }));
    const context = createChatContext();
    const runId = `run-s1a-reply-${path.basename(fixture.root)}`;
    const respond = vi.fn();
    await chatHandlers["chat.send"]({
      params: {
        sessionKey: fixture.sessionKey,
        message: "你好",
        idempotencyKey: runId,
        timeoutMs: 15_000,
      },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: fixture.client as never,
      isWebchatConnect: () => false,
    });
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    await vi.waitFor(
      () => {
        expect(completeMock, "model complete was not reached").toHaveBeenCalled();
        expect(findTerminal(context, runId)).toBeTruthy();
      },
      { timeout: 15_000 },
    );
    expect(
      interactionSpy,
      "get-reply-run did not reach replyTurnRuntime.interaction",
    ).toHaveBeenCalled();
    expect(governedSpy, "governed interaction was not reached").toHaveBeenCalled();
    expect(completeMock, "model complete was not reached").toHaveBeenCalledTimes(1);
    const terminal = findTerminal(context, runId);
    expect(payloadText(terminal)).toContain("你好，我在。");
    expect(payloadText(terminal)).not.toMatch(/没有启动或修改任务/);
    const combined = collectTranscriptText(fixture.root);
    expect(combined).toContain("你好，我在。");
    const taskBoards: string[] = [];
    const walkBoard = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkBoard(full);
        } else if (entry.name.endsWith(".task-board.json")) {
          taskBoards.push(full);
        }
      }
    };
    walkBoard(fixture.root);
    expect(taskBoards, `unexpected task-board writes: ${taskBoards.join(",")}`).toEqual([]);
  }, 30_000);

  it("R3: a controlled pending model trips the original timeout terminal and history", async () => {
    const fixture = await isolateTrustedGateway();
    const governedSpy = vi.spyOn(commandFacade, "runGovernedInteraction");
    const interactionSpy = vi.spyOn(replyTurnRuntime, "interaction");
    let release!: (value: unknown) => void;
    completeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const context = createChatContext();
    const runId = `run-s1a-timeout-${path.basename(fixture.root)}`;
    const respond = vi.fn();
    const timeoutMs = 800;
    const previousWait = process.env.OPENBOT_INTERACTION_RESOURCE_WAIT_MS;
    process.env.OPENBOT_INTERACTION_RESOURCE_WAIT_MS = String(timeoutMs);
    const started = Date.now();
    const sendDone = chatHandlers["chat.send"]({
      params: {
        sessionKey: fixture.sessionKey,
        message: "你好",
        idempotencyKey: runId,
        timeoutMs: 15_000,
      },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: fixture.client as never,
      isWebchatConnect: () => false,
    });
    await vi.waitFor(
      () => {
        expect(completeMock, "in-model path never reached complete").toHaveBeenCalled();
      },
      { timeout: 15_000 },
    );
    await sendDone;
    const elapsed = Date.now() - started;
    expect(interactionSpy).toHaveBeenCalled();
    expect(governedSpy).toHaveBeenCalled();
    expect(completeMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(
      () => {
        expect(findTerminal(context, runId)).toBeTruthy();
      },
      { timeout: 15_000 },
    );
    expect(elapsed, `in-model timeout visible elapsed ${elapsed}ms`).toBeLessThan(timeoutMs + 400);
    const terminal = findTerminal(context, runId);
    const resolvedSessionKey = String(terminal?.sessionKey ?? fixture.sessionKey);
    const liveText = payloadText(terminal);
    expect(liveText).toContain(INTERACTION_TIMEOUT_TEXT);
    const sidecar =
      readChatTurnTerminal(runId, undefined, resolvedSessionKey) ??
      readChatTurnTerminal(runId, undefined, fixture.sessionKey) ??
      readChatTurnTerminal(runId, undefined, "main");
    if (sidecar) {
      expect(sidecar).toMatchObject({
        text: expect.stringContaining(INTERACTION_TIMEOUT_TEXT),
        businessExecution: "none",
      });
    }
    const historyRespond = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey: resolvedSessionKey },
      respond: historyRespond as never,
      context: context as never,
      req: {} as never,
      client: fixture.client as never,
      isWebchatConnect: () => false,
    });
    expect(historyRespond.mock.calls[0]?.[0]).toBe(true);
    const combined = collectTranscriptText(fixture.root);
    expect(combined).toContain(INTERACTION_TIMEOUT_TEXT);
    release({
      role: "assistant",
      content: [{ type: "text", text: JSON.stringify({ kind: "reply", text: "迟到模型结果" }) }],
      usage: makeZeroUsageSnapshot(),
      stopReason: "stop",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(collectTranscriptText(fixture.root)).not.toContain("迟到模型结果");
    if (previousWait === undefined) {
      delete process.env.OPENBOT_INTERACTION_RESOURCE_WAIT_MS;
    } else {
      process.env.OPENBOT_INTERACTION_RESOURCE_WAIT_MS = previousWait;
    }
  }, 30_000);

  it("sends through real dispatchInboundMessage, records an actual append failure, and recovers via chat.history", async () => {
    const fixture = await isolateTrustedGateway();
    expect(resolveConfigDir()).toBe(fixture.root);
    expect(resolveChatTurnTerminalDir()).toBe(
      path.join(fixture.root, "openbot-chat-turn-terminals"),
    );
    expect(resolveChatTurnTerminalDir()).not.toContain(`${os.homedir()}/.openbot`);
    expect(resolveChatTurnTerminalDir()).not.toContain(`${os.homedir()}/.openclaw`);

    const dispatchSpy = vi.spyOn(dispatchModule, "dispatchInboundMessage");
    const governedSpy = vi.spyOn(commandFacade, "runGovernedInteraction");
    const interactionSpy = vi.spyOn(replyTurnRuntime, "interaction");
    let releaseComplete!: (value: unknown) => void;
    let enteredComplete = false;
    completeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          enteredComplete = true;
          releaseComplete = resolve;
        }),
    );

    const context = createChatContext();
    const runId = `run-s1a-${path.basename(fixture.root)}`;
    const respond = vi.fn();
    const sendDone = chatHandlers["chat.send"]({
      params: {
        sessionKey: fixture.sessionKey,
        message: "你好",
        idempotencyKey: runId,
        timeoutMs: 15_000,
      },
      respond: respond as never,
      context: context as never,
      req: {} as never,
      client: fixture.client as never,
      isWebchatConnect: () => false,
    });

    await vi.waitFor(() => {
      expect(context.broadcastChat.mock.calls.some((call) => call[1]?.state === "user_echo")).toBe(
        true,
      );
    });
    await vi.waitFor(
      () => {
        expect(enteredComplete, "post-execution persist test never reached model complete").toBe(
          true,
        );
      },
      { timeout: 15_000 },
    );
    const jsonlFiles = collectJsonl(fixture.root);
    expect(
      jsonlFiles.length,
      `expected a persisted transcript under ${fixture.root}`,
    ).toBeGreaterThan(0);
    // Inject EISDIR only after the model path has been entered, so this is a
    // post-execution persist failure rather than a pre-entry read failure.
    turnJsonlIntoDirectories(jsonlFiles);
    fixture.transcriptPath = jsonlFiles[0] ?? fixture.transcriptPath;
    releaseComplete({
      role: "assistant",
      content: [{ type: "text", text: JSON.stringify({ kind: "reply", text: "你好，我在。" }) }],
      usage: makeZeroUsageSnapshot(),
      stopReason: "stop",
    });
    await sendDone;
    expect(
      respond.mock.calls[0]?.[0],
      `chat.send rejected: ${JSON.stringify(respond.mock.calls[0]?.[2] ?? respond.mock.calls[0])}`,
    ).toBe(true);
    expect(dispatchSpy).toHaveBeenCalled();
    expect(interactionSpy).toHaveBeenCalled();
    expect(governedSpy).toHaveBeenCalled();
    expect(completeMock).toHaveBeenCalledTimes(1);

    await vi.waitFor(
      () => {
        expect(findTerminal(context, runId)).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    const lastTerminal = findTerminal(context, runId);
    const resolvedSessionKey = String(lastTerminal?.sessionKey ?? fixture.sessionKey);
    const liveText = payloadText(lastTerminal);
    expect(
      liveText.includes("你好，我在。") || liveText.includes(INTERACTION_RECORD_UNAVAILABLE_TEXT),
      `post-model persist failure text unexpected: ${liveText}`,
    ).toBe(true);

    const sidecarDir = resolveChatTurnTerminalDir();
    const foundSidecars: string[] = [];
    if (fs.existsSync(sidecarDir)) {
      for (const sessionDir of fs.readdirSync(sidecarDir)) {
        const full = path.join(sidecarDir, sessionDir);
        if (!fs.statSync(full).isDirectory()) {
          continue;
        }
        for (const name of fs.readdirSync(full)) {
          foundSidecars.push(path.join(sessionDir, name));
        }
      }
    }
    const liveReceipt =
      readChatTurnTerminal(runId, undefined, resolvedSessionKey) ??
      readChatTurnTerminal(runId, undefined, fixture.sessionKey) ??
      readChatTurnTerminal(runId, undefined, "main");
    expect(
      liveReceipt,
      `missing sidecar for ${resolvedSessionKey}; found=${JSON.stringify(foundSidecars)}; lastTerminal=${JSON.stringify(lastTerminal)}`,
    ).toMatchObject({
      runId,
      persistedToTranscript: false,
      recordTemporarilyUnavailable: true,
    });

    const header = sessionHeader(fixture.sessionId, fixture.root);
    const restorePaths = new Set([fixture.transcriptPath, ...jsonlFiles]);
    for (const file of restorePaths) {
      fs.rmSync(file, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, header);
    }
    const historyRespond = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey: resolvedSessionKey },
      respond: historyRespond as never,
      context: context as never,
      req: {} as never,
      client: fixture.client as never,
      isWebchatConnect: () => false,
    });
    expect(historyRespond.mock.calls[0]?.[0]).toBe(true);
    const recovered = readChatTurnTerminal(runId, undefined, resolvedSessionKey);
    expect(recovered).toMatchObject({
      persistedToTranscript: true,
      recordTemporarilyUnavailable: false,
    });
    const combined = collectTranscriptText(fixture.root);
    const recoveredFact = (recovered?.text ?? "").split("\n\n")[0] ?? "";
    expect(
      combined.includes("你好，我在。") ||
        combined.includes(INTERACTION_RECORD_UNAVAILABLE_TEXT) ||
        Boolean(recoveredFact && combined.includes(recoveredFact)),
      `history recovered text missing from isolated transcripts; recovered=${JSON.stringify(recovered)}; combined=${combined.slice(0, 2000)}`,
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          os.homedir(),
          ".openbot",
          "openbot-chat-turn-terminals",
          encodeURIComponent(resolvedSessionKey),
          `${encodeURIComponent(runId)}.json`,
        ),
      ),
    ).toBe(false);
  }, 30_000);
});

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
import {
  INTERACTION_MODEL_FAILURE_TEXT,
  INTERACTION_RECORD_UNAVAILABLE_TEXT,
  INTERACTION_TIMEOUT_TEXT,
} from "../agent-runtime/model/interaction-resource-wait.js";
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
import { saveStore, type PlatformAuthStore } from "./platform-auth/store.js";

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

function payloadText(
  payload: { errorMessage?: string; message?: { content?: Array<{ text?: string }> } } | undefined,
): string {
  if (!payload) {
    return "";
  }
  if (typeof payload.errorMessage === "string" && payload.errorMessage.trim()) {
    return payload.errorMessage;
  }
  return payload.message?.content?.[0]?.text ?? "";
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
    agents: { list: [{ id: "main" }] },
  } as OpenBotConfig;
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

describe("checkpoint A isolated Gateway dispatch chain (in-process handlers, real dispatch)", () => {
  beforeEach(() => {
    completeMock.mockReset();
  });

  it("sends through real dispatchInboundMessage, records an actual append failure, and recovers via chat.history", async () => {
    const fixture = await isolateTrustedGateway();
    expect(resolveConfigDir()).toBe(fixture.root);
    expect(resolveChatTurnTerminalDir()).toBe(
      path.join(fixture.root, "openbot-chat-turn-terminals"),
    );
    expect(resolveChatTurnTerminalDir()).not.toContain(`${os.homedir()}/.openbot`);
    expect(resolveChatTurnTerminalDir()).not.toContain(`${os.homedir()}/.openclaw`);

    const dispatchSpy = vi.spyOn(dispatchModule, "dispatchInboundMessage");
    completeMock.mockImplementation(async () => {
      throw Object.assign(new Error("timeout"), {
        interactionPhase: "interpretation",
        reason: "timeout",
      });
    });

    const context = createChatContext();
    const runId = `run-s1a-${path.basename(fixture.root)}`;
    const respond = vi.fn();
    const sendDone = chatHandlers["chat.send"]({
      params: {
        sessionKey: fixture.sessionKey,
        message: "你好",
        idempotencyKey: runId,
        timeoutMs: 1,
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
    // User echo may have been persisted on a remapped employee session file.
    // Turn every transcript jsonl under the isolated root into a directory so
    // the production append hits a real EISDIR write failure (not chmod).
    const jsonlFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          jsonlFiles.push(full);
        }
      }
    };
    walk(fixture.root);
    expect(
      jsonlFiles.length,
      `expected a persisted transcript under ${fixture.root}`,
    ).toBeGreaterThan(0);
    for (const file of jsonlFiles) {
      fs.rmSync(file, { force: true });
      fs.mkdirSync(file);
    }
    fixture.transcriptPath = jsonlFiles[0] ?? fixture.transcriptPath;
    await sendDone;
    expect(
      respond.mock.calls[0]?.[0],
      `chat.send rejected: ${JSON.stringify(respond.mock.calls[0]?.[2] ?? respond.mock.calls[0])}`,
    ).toBe(true);
    expect(dispatchSpy).toHaveBeenCalled();

    await vi.waitFor(
      () => {
        const terminal = context.broadcastChat.mock.calls
          .map((call) => call[1])
          .find(
            (payload) =>
              payload &&
              typeof payload === "object" &&
              (payload.state === "error" || payload.state === "final") &&
              (payload.runId === runId || String(payload.runId ?? "").startsWith(`${runId}:`)),
          );
        expect(terminal).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    const lastTerminal = context.broadcastChat.mock.calls
      .map((call) => call[1])
      .filter(
        (payload) =>
          payload &&
          typeof payload === "object" &&
          (payload.state === "error" || payload.state === "final") &&
          !String(payload.runId ?? "").endsWith(":user"),
      )
      .at(-1);
    const resolvedSessionKey = String(lastTerminal?.sessionKey ?? fixture.sessionKey);
    const liveText = payloadText(lastTerminal);
    expect(
      liveText.includes(INTERACTION_TIMEOUT_TEXT) ||
        liveText.includes(INTERACTION_MODEL_FAILURE_TEXT) ||
        liveText.includes(INTERACTION_RECORD_UNAVAILABLE_TEXT),
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

    const sessionHeader = `${JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: fixture.sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: fixture.root,
    })}\n`;
    const restorePaths = new Set([fixture.transcriptPath, ...jsonlFiles]);
    for (const file of restorePaths) {
      fs.rmSync(file, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, sessionHeader);
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
    const transcripts: string[] = [];
    const collect = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collect(full);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          transcripts.push(`${full}\n${fs.readFileSync(full, "utf8")}`);
        }
      }
    };
    collect(fixture.root);
    const combined = transcripts.join("\n");
    const recoveredFact = (recovered?.text ?? "").split("\n\n")[0] ?? "";
    expect(
      combined.includes(INTERACTION_TIMEOUT_TEXT) ||
        combined.includes(INTERACTION_MODEL_FAILURE_TEXT) ||
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

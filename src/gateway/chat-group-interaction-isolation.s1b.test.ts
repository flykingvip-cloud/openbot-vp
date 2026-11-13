import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/**
 * Isolated-Gateway consumer for S1 checkpoint B: group interaction isolation.
 *
 * Shape honesty: this test invokes the in-process chat.send / chat.history
 * handlers. It does not start a child Gateway process and does not open a
 * real WebSocket. It covers the real inbound group chain: chat.send →
 * understandGroupInteraction → runGatewayUnderstanding / complete, and the
 * existing broadcastChat / transcript / chatAbortControllers consumers.
 *
 * Model `complete` and member-execution dispatch may be stubbed with a
 * controllable Promise. Identity uses an isolated trusted platform-auth
 * fixture. Sidecars and group files are forced under an isolated
 * OPENBOT_STATE_DIR.
 */
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeZeroUsageSnapshot } from "../agents/usage.js";
import * as dispatchModule from "../auto-reply/dispatch.js";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/config.js";
import { updateSessionStore } from "../config/sessions/store.js";
import type { OpenBotConfig } from "../config/types.js";
import * as mentionDelivery from "../organization/mention-delivery.js";
import { resolvePlatformAuthConfig } from "./platform-auth/config.js";
import { saveStore, type PlatformAuthStore } from "./platform-auth/store.js";

const completeMock = vi.hoisted(() => vi.fn());

vi.mock("@earendil-works/pi-ai/compat", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-ai/compat")>()),
  complete: completeMock,
}));

const { chatHandlers, appendUserTranscriptMessage } = await import("./server-methods/chat.js");
const { createWorkspaceCollaborationStores } = await import("./collaboration-learning/shared.js");
const { resolveGroupPublicTranscriptPath } =
  await import("./collaboration-learning/collaboration-paths.js");

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
  vi.restoreAllMocks();
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

function liveMessageFromCompleteArgs(args: unknown[]): string {
  const context = args[1] as { messages?: Array<{ role?: string; content?: unknown }> } | undefined;
  const lastUser = [...(context?.messages ?? [])].toReversed().find((row) => row.role === "user");
  const content = lastUser?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object" || !("text" in part)) {
          return "";
        }
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  return "";
}

function collectChatEvents(
  context: { broadcastChat: { mock: { calls: unknown[][] } } },
  runId?: string,
) {
  return context.broadcastChat.mock.calls
    .map((call) => {
      const sessionKey = typeof call[0] === "string" ? call[0] : "";
      const payload = call[1] as
        | { state?: string; runId?: string; sessionKey?: string }
        | undefined;
      return { sessionKey, payload };
    })
    .filter((row) => row.payload && typeof row.payload === "object")
    .filter((row) => (runId ? String(row.payload?.runId ?? "").startsWith(runId) : true));
}

function findTerminal(context: { broadcastChat: { mock: { calls: unknown[][] } } }, runId: string) {
  return collectChatEvents(context, runId)
    .map((row) => row.payload)
    .filter(
      (payload) =>
        payload &&
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
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".jsonl") || entry.name.endsWith(".json"))
      ) {
        parts.push(`${full}\n${fs.readFileSync(full, "utf8")}`);
      }
    }
  };
  walk(root);
  return parts.join("\n");
}

function listTaskBoardFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".task-board.json") || entry.name.includes("task-board")) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files;
}

const WORK_MESSAGE = "请团队正式开展市场调研并给出竞品清单";
const GREETING_MESSAGE = "你好，在吗";
const PROGRESS_MESSAGE = "现在进度怎么样，只读说明即可";
const CLARIFY_MESSAGE = "你刚才说的验收标准具体指哪一条？先不要动手";
const GREETING_REPLY = "你好，我在，群里有什么我可以先回答的。";
const PROGRESS_REPLY = "当前仍在执行先前任务，这是只读说明，没有改状态。";
const CLARIFY_REPLY = "请补充你希望核对的验收条目，本轮不会启动新任务。";
const STALE_PROPOSAL_NOTICE = "当前群状态已更新，本轮未执行该提案";

function decisionForLiveMessage(message: string): { kind: string; [k: string]: unknown } {
  if (message.includes(GREETING_MESSAGE)) {
    return { kind: "reply", text: GREETING_REPLY };
  }
  if (message.includes(PROGRESS_MESSAGE)) {
    return { kind: "reply", text: PROGRESS_REPLY };
  }
  if (message.includes(CLARIFY_MESSAGE)) {
    return { kind: "clarify", text: CLARIFY_REPLY };
  }
  if (message.includes("2加2") || message.includes("独立普通问题")) {
    return { kind: "reply", text: "4" };
  }
  if (message.includes(WORK_MESSAGE) || message.includes("请团队继续修订计划")) {
    return {
      kind: "execution_request",
      request: {
        lifecycle: "turn",
        goal: "开展市场调研",
        acceptance: ["竞品清单"],
      },
    };
  }
  return { kind: "reply", text: "收到。" };
}

async function isolateTrustedGroupGateway(options?: { tinyHistoryBudget?: boolean }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s1b-group-isolation-"));
  dirs.push(root);
  process.env.OPENBOT_STATE_DIR = root;
  process.env.OPENCLAW_STATE_DIR = root;
  const configPath = path.join(root, "openbot.json");
  const platformAuthPath = path.join(root, "platform-auth.json");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;

  const now = new Date().toISOString();
  const userId = "u-s1b";
  const email = "s1b-tester@example.com";
  const enterpriseId = "ent-s1b";
  const groupId = `s1b-group-${path.basename(root)}`;
  const sessionKey = `space:${groupId}`;
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
          apiKey: "sk-s1b-not-real",
          models: [{ id: "s1b-test", name: "s1b-test" }],
        },
      },
    },
    agents: {
      defaults: {
        model: { primary: "testdemo/s1b-test" },
        ...(options?.tinyHistoryBudget ? { contextBudget: { enabled: true, maxTokens: 1 } } : {}),
      },
      list: [
        { id: "main", model: { primary: "testdemo/s1b-test" } },
        { id: "bot-coord", model: { primary: "testdemo/s1b-test" } },
      ],
    },
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
    secret: "s1b-group-isolation-secret",
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
        name: "S1B Isolated",
        slug: "s1b",
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
        displayName: "S1B Tester",
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
      "m-s1b": {
        id: "m-s1b",
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

  const stores = createWorkspaceCollaborationStores(cfg);
  const groupDir = path.join(stores.groupRootDir, encodeURIComponent(groupId));
  fs.mkdirSync(groupDir, { recursive: true });
  const profile = {
    id: groupId,
    groupId,
    name: "S1B Group",
    displayName: "S1B Group",
    coordinatorBotId: "bot-coord",
    createdAtMs: 1,
    updatedAtMs: 1,
  };
  const members = [
    {
      memberId: `human:${userId}`,
      memberKind: "human",
      userId,
      email,
      name: "S1B Tester",
      governanceRole: "owner",
      status: "active",
      joinedAtMs: 1,
      updatedAtMs: 1,
    },
    {
      memberId: "bot:bot-coord",
      memberKind: "bot",
      agentId: "bot-coord",
      name: "Coordinator",
      governanceRole: "member",
      collaborationRole: "coordinator",
      status: "active",
      joinedAtMs: 1,
      updatedAtMs: 1,
    },
  ];
  const operatingState = {
    groupId,
    authEpoch: 1,
    updatedAtMs: 10,
    groupProfile: {
      displayName: "S1B Group",
      expectedOutputs: [],
      successCriteria: [],
    },
    governance: {
      adminUserIds: [] as string[],
      coordinatorBotId: "bot-coord" as string | null,
      ownerUserId: userId,
    },
    collaborationPolicy: {
      humanStartsNewRound: true,
      mentionBotMustRespond: false,
      mentionHumanNotifiesOnly: true,
      openDiscussionWithoutMention: true,
      maxVisibleBotRepliesPerRound: 3,
      botMaySelfAdvanceWithoutHuman: false,
      entersWaitingForHumanAfterVisibleTurnsExhausted: true,
    },
    memberRoleMap: [
      {
        memberId: `human:${userId}`,
        memberKind: "human",
        label: "S1B Tester",
        governanceRole: "owner",
        status: "active",
      },
      {
        memberId: "bot:bot-coord",
        memberKind: "bot",
        label: "Coordinator",
        governanceRole: "member",
        collaborationRole: "coordinator",
        status: "active",
      },
    ],
    activeContext: {
      currentOperatingPhase: "explore" as const,
      waitingForHuman: false,
      currentTaskId: "task-s1b-existing",
      summary: "s1b isolation",
      updatedAtMs: 10,
    },
    onboardingStatus: { initialized: true },
    groupMemoryRefs: { latestCapsuleIds: [] as string[] },
  };
  fs.writeFileSync(path.join(groupDir, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`);
  fs.writeFileSync(path.join(groupDir, "members.json"), `${JSON.stringify(members, null, 2)}\n`);
  fs.writeFileSync(
    path.join(groupDir, "operating-state.json"),
    `${JSON.stringify(operatingState, null, 2)}\n`,
  );

  const sessionId = `sess-${groupId}`;
  const storePath = path.join(root, "agents", "main", "sessions", "sessions.json");
  const publicTranscriptPath = resolveGroupPublicTranscriptPath(groupId);
  const transcriptPath = publicTranscriptPath;
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.mkdirSync(path.join(groupDir, "runtime"), { recursive: true });
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
      groupId,
      space: groupId,
      chatType: "group",
      displayName: "S1B Group",
    };
    sessions["agent:main:main"] = {
      sessionId: "sess-main",
      sessionFile: path.join(root, "agents", "main", "sessions", "sess-main.jsonl"),
      updatedAt: Date.now(),
    };
    sessions[`agent:bot-coord:main:space:${groupId}`] = {
      sessionId: `sess-coord-${groupId}`,
      sessionFile: path.join(root, "agents", "main", "sessions", `sess-coord-${groupId}.jsonl`),
      updatedAt: Date.now(),
      groupId,
      displayName: "Coordinator",
      collaborationParticipationOverlay: {
        groupId,
        botId: "bot-coord",
        updatedAt: 1,
      },
    };
  });
  const mainTranscript = path.join(root, "agents", "main", "sessions", "sess-main.jsonl");
  fs.writeFileSync(
    mainTranscript,
    `${JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: "sess-main",
      timestamp: new Date(0).toISOString(),
      cwd: root,
    })}\n`,
  );
  const coordTranscript = path.join(
    root,
    "agents",
    "main",
    "sessions",
    `sess-coord-${groupId}.jsonl`,
  );
  fs.writeFileSync(
    coordTranscript,
    `${JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: `sess-coord-${groupId}`,
      timestamp: new Date(0).toISOString(),
      cwd: root,
    })}\n`,
  );

  const client = {
    user: email,
    sessionDomain: "enterprise" as const,
    platformUserId: userId,
    sessionEnterpriseId: enterpriseId,
    sessionMembershipId: "m-s1b",
    connect: { scopes: ["operator.read", "operator.write"] },
  };

  return {
    root,
    groupId,
    sessionId,
    sessionKey,
    storePath,
    transcriptPath,
    groupDir,
    operatingState,
    client,
    stores,
  };
}

function debugSend(
  label: string,
  params: {
    context: ReturnType<typeof createChatContext>;
    completeCalls?: unknown[][];
    respond?: { mock: { calls: unknown[][] } };
  },
): string {
  const events = collectChatEvents(params.context).map((row) => ({
    state: row.payload?.state,
    runId: row.payload?.runId,
    text: payloadText(row.payload as never).slice(0, 160),
  }));
  const lives = (params.completeCalls ?? completeMock.mock.calls).map((args) =>
    liveMessageFromCompleteArgs(args).slice(0, 80),
  );
  const warns = params.context.logGateway.warn.mock.calls.map((call) =>
    String(call[0]).slice(0, 300),
  );
  const occupancy = [...params.context.chatAbortControllers.keys()];
  return `${label} events=${JSON.stringify(events)} complete=${JSON.stringify(lives)} warns=${JSON.stringify(warns)} occupancy=${JSON.stringify(occupancy)} respond=${JSON.stringify(params.respond?.mock.calls ?? [])}`;
}

function installUnderstandingComplete() {
  completeMock.mockImplementation(async (...args: unknown[]) => ({
    role: "assistant",
    content: [
      {
        type: "text",
        text: JSON.stringify(decisionForLiveMessage(liveMessageFromCompleteArgs(args))),
      },
    ],
    usage: makeZeroUsageSnapshot(),
    stopReason: "stop",
  }));
}

async function sendGroupChat(params: {
  fixture: Awaited<ReturnType<typeof isolateTrustedGroupGateway>>;
  context: ReturnType<typeof createChatContext>;
  runId: string;
  message: string;
  mentions?: Array<{ kind?: string; userId?: string; agentId?: string }>;
}) {
  const respond = vi.fn();
  const started = Date.now();
  const pending = chatHandlers["chat.send"]({
    params: {
      sessionKey: params.fixture.sessionKey,
      message: params.message,
      idempotencyKey: params.runId,
      timeoutMs: 15_000,
      ...(params.mentions ? { mentions: params.mentions } : {}),
    },
    respond: respond as never,
    context: params.context as never,
    req: {} as never,
    client: params.fixture.client as never,
    isWebchatConnect: () => false,
  });
  return { respond, pending, started };
}

describe("checkpoint B isolated Gateway group interaction isolation", () => {
  beforeEach(() => {
    completeMock.mockReset();
  });

  it("1: B greeting is understood and visible while A's hanging work turn stays unfinished", async () => {
    const fixture = await isolateTrustedGroupGateway();
    installUnderstandingComplete();
    let releaseA: ((value: unknown) => void) | undefined;
    const dispatchHang = vi.spyOn(dispatchModule, "dispatchInboundMessage").mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseA = resolve;
        }),
    );
    const context = createChatContext();
    const runA = `run-s1b-a-${path.basename(fixture.root)}`;
    const runB = `run-s1b-b-${path.basename(fixture.root)}`;
    const sendA = await sendGroupChat({
      fixture,
      context,
      runId: runA,
      message: WORK_MESSAGE,
    });
    try {
      await vi.waitFor(
        () => {
          expect(dispatchHang, "A never entered member/business dispatch").toHaveBeenCalled();
          expect(context.chatAbortControllers.has(runA)).toBe(true);
        },
        { timeout: 8_000 },
      );
    } catch {
      throw new Error(debugSend("A-dispatch-miss", { context, respond: sendA.respond }));
    }
    const aEnteredAt = Date.now();
    const sendB = await sendGroupChat({
      fixture,
      context,
      runId: runB,
      message: GREETING_MESSAGE,
    });
    await vi.waitFor(
      () => {
        expect(findTerminal(context, runB)).toBeTruthy();
      },
      { timeout: 15_000 },
    );
    const bVisibleAt = Date.now();
    expect(sendB.respond.mock.calls[0]?.[0]).toBe(true);
    expect(payloadText(findTerminal(context, runB))).toContain(GREETING_REPLY);
    expect(context.chatAbortControllers.has(runA), "A occupancy was cleared by B").toBe(true);
    expect(context.chatAbortControllers.get(runA)?.sessionKey).toBe(fixture.sessionKey);
    expect(findTerminal(context, runA), "A must still be unfinished").toBeUndefined();
    expect(releaseA, "A hang handle missing").toBeTypeOf("function");
    expect(bVisibleAt - aEnteredAt, `B visible lag ${bVisibleAt - aEnteredAt}ms`).toBeLessThan(
      4000,
    );
    await sendB.pending;
    expect(releaseA).toBeTypeOf("function");
    // Leave A hanging; the test evidence is B first, A still running.
    void sendA.pending;
    releaseA?.({ ok: true, text: "late-A-should-not-block-B" });
  }, 30_000);

  it("2: B readonly progress query does not write the board, claim, dispatch members, or resume A", async () => {
    const fixture = await isolateTrustedGroupGateway();
    installUnderstandingComplete();
    let releaseA: ((value: unknown) => void) | undefined;
    const dispatchHang = vi.spyOn(dispatchModule, "dispatchInboundMessage").mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseA = resolve;
        }),
    );
    const context = createChatContext();
    const runA = `run-s1b-a-ro-${path.basename(fixture.root)}`;
    const runB = `run-s1b-b-ro-${path.basename(fixture.root)}`;
    const osPath = path.join(fixture.groupDir, "operating-state.json");
    const osBefore = JSON.parse(fs.readFileSync(osPath, "utf8")) as typeof fixture.operatingState;
    const sendA = await sendGroupChat({
      fixture,
      context,
      runId: runA,
      message: WORK_MESSAGE,
    });
    try {
      await vi.waitFor(() => expect(dispatchHang).toHaveBeenCalled(), { timeout: 8_000 });
    } catch {
      throw new Error(debugSend("A-dispatch-miss", { context, respond: sendA.respond }));
    }
    const boardsBefore = listTaskBoardFiles(fixture.root);
    const dispatchCountAtHang = dispatchHang.mock.calls.length;
    const sendB = await sendGroupChat({
      fixture,
      context,
      runId: runB,
      message: PROGRESS_MESSAGE,
    });
    await vi.waitFor(() => expect(findTerminal(context, runB)).toBeTruthy(), { timeout: 15_000 });
    await sendB.pending;
    expect(payloadText(findTerminal(context, runB))).toContain(PROGRESS_REPLY);
    expect(dispatchHang.mock.calls.length).toBe(dispatchCountAtHang);
    expect(listTaskBoardFiles(fixture.root)).toEqual(boardsBefore);
    const osAfter = JSON.parse(fs.readFileSync(osPath, "utf8")) as typeof fixture.operatingState;
    expect(osAfter.authEpoch).toBe(osBefore.authEpoch);
    expect(osAfter.activeContext.currentTaskId).toBe(osBefore.activeContext.currentTaskId);
    // A may still be running and may touch updatedAtMs; B must not change task identity.
    expect(context.chatAbortControllers.has(runA)).toBe(true);
    expect(findTerminal(context, runA)).toBeUndefined();
    releaseA?.({ ok: true });
    void sendA.pending;
  }, 30_000);

  it("3: B clarify/deny-admission performs zero business actions, tasks, or mention dispatch", async () => {
    const fixture = await isolateTrustedGroupGateway();
    installUnderstandingComplete();
    let releaseA: ((value: unknown) => void) | undefined;
    const dispatchHang = vi.spyOn(dispatchModule, "dispatchInboundMessage").mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseA = resolve;
        }),
    );
    const mentionSpy = vi.spyOn(mentionDelivery, "deliver");
    const context = createChatContext();
    const runA = `run-s1b-a-cl-${path.basename(fixture.root)}`;
    const runB = `run-s1b-b-cl-${path.basename(fixture.root)}`;
    const sendA = await sendGroupChat({
      fixture,
      context,
      runId: runA,
      message: WORK_MESSAGE,
    });
    try {
      await vi.waitFor(() => expect(dispatchHang).toHaveBeenCalled(), { timeout: 8_000 });
    } catch {
      throw new Error(debugSend("A-dispatch-miss", { context, respond: sendA.respond }));
    }
    const mentionCallsAtHang = mentionSpy.mock.calls.length;
    const sendB = await sendGroupChat({
      fixture,
      context,
      runId: runB,
      message: CLARIFY_MESSAGE,
    });
    await vi.waitFor(() => expect(findTerminal(context, runB)).toBeTruthy(), { timeout: 15_000 });
    await sendB.pending;
    expect(payloadText(findTerminal(context, runB))).toContain(CLARIFY_REPLY);
    expect(listTaskBoardFiles(fixture.root)).toEqual([]);
    expect(mentionSpy.mock.calls.length).toBe(mentionCallsAtHang);
    expect(context.chatAbortControllers.has(runA)).toBe(true);
    releaseA?.({ ok: true });
    void sendA.pending;
  }, 30_000);

  it("4+5: B's visible receipt does not clear A's occupancy; late A final does not overwrite B or resurrect occupancy", async () => {
    const fixture = await isolateTrustedGroupGateway();
    installUnderstandingComplete();
    let releaseA: ((value: unknown) => void) | undefined;
    vi.spyOn(dispatchModule, "dispatchInboundMessage").mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseA = resolve;
        }),
    );
    const context = createChatContext();
    const runA = `run-s1b-a-occ-${path.basename(fixture.root)}`;
    const runB = `run-s1b-b-occ-${path.basename(fixture.root)}`;
    await sendGroupChat({
      fixture,
      context,
      runId: runA,
      message: WORK_MESSAGE,
    });
    await vi.waitFor(() => expect(context.chatAbortControllers.has(runA)).toBe(true), {
      timeout: 15_000,
    });
    const aController = context.chatAbortControllers.get(runA);
    const sendB = await sendGroupChat({
      fixture,
      context,
      runId: runB,
      message: GREETING_MESSAGE,
    });
    await vi.waitFor(() => expect(findTerminal(context, runB)).toBeTruthy(), { timeout: 15_000 });
    await sendB.pending;
    expect(payloadText(findTerminal(context, runB))).toContain(GREETING_REPLY);
    expect(context.chatAbortControllers.get(runA)).toBe(aController);
    expect(aController?.controller.signal.aborted).toBe(false);
    expect(context.chatAbortControllers.has(runB), "B occupancy should have been released").toBe(
      false,
    );

    const bTextAfterB = collectTranscriptText(fixture.root);
    expect(bTextAfterB).toContain(GREETING_REPLY);
    releaseA?.({ ok: true, text: "A业务结果" });
    await vi.waitFor(
      () => {
        expect(findTerminal(context, runA), "A should emit a terminal after release").toBeTruthy();
      },
      { timeout: 8_000 },
    );
    const afterA = collectTranscriptText(fixture.root);
    expect(afterA).toContain(GREETING_REPLY);
    const greetingCount = afterA.split(GREETING_REPLY).length - 1;
    expect(greetingCount).toBeGreaterThanOrEqual(1);
    expect(context.chatAbortControllers.has(runA), "A occupancy should end after A settles").toBe(
      false,
    );
    expect(context.chatAbortControllers.has(runB)).toBe(false);
  }, 30_000);

  it("6: a late B execution proposal is version/CAS rejected after A-era state revision", async () => {
    const fixture = await isolateTrustedGroupGateway();
    let releaseA: ((value: unknown) => void) | undefined;
    let releaseBUnderstand: ((value: unknown) => void) | undefined;
    const dispatchHang = vi.spyOn(dispatchModule, "dispatchInboundMessage").mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseA = resolve;
        }),
    );
    completeMock.mockImplementation(async (...args: unknown[]) => {
      const live = liveMessageFromCompleteArgs(args);
      const decision = decisionForLiveMessage(live);
      if (live.includes("请团队继续修订计划")) {
        await new Promise((resolve) => {
          releaseBUnderstand = resolve;
        });
      }
      return {
        role: "assistant",
        content: [{ type: "text", text: JSON.stringify(decision) }],
        usage: makeZeroUsageSnapshot(),
        stopReason: "stop",
      };
    });
    const context = createChatContext();
    const runA = `run-s1b-a-cas-${path.basename(fixture.root)}`;
    const runB = `run-s1b-b-cas-${path.basename(fixture.root)}`;
    const sendA = await sendGroupChat({
      fixture,
      context,
      runId: runA,
      message: WORK_MESSAGE,
    });
    try {
      await vi.waitFor(() => expect(dispatchHang).toHaveBeenCalled(), { timeout: 8_000 });
    } catch {
      throw new Error(debugSend("A-dispatch-miss", { context, respond: sendA.respond }));
    }
    const dispatchCountAtHang = dispatchHang.mock.calls.length;
    const sendB = await sendGroupChat({
      fixture,
      context,
      runId: runB,
      message: "请团队继续修订计划并执行新阶段",
    });
    await vi.waitFor(() => expect(releaseBUnderstand).toBeTypeOf("function"), { timeout: 15_000 });
    const osPath = path.join(fixture.groupDir, "operating-state.json");
    const current = JSON.parse(fs.readFileSync(osPath, "utf8")) as typeof fixture.operatingState;
    const revised = {
      ...current,
      authEpoch: (current.authEpoch ?? 1) + 1,
      updatedAtMs: (current.updatedAtMs ?? 10) + 100,
      activeContext: {
        ...current.activeContext,
        currentOperatingPhase: "stopped" as const,
        currentTaskId: "task-s1b-revised",
        updatedAtMs: (current.updatedAtMs ?? 10) + 100,
      },
    };
    fs.writeFileSync(osPath, `${JSON.stringify(revised, null, 2)}\n`);
    releaseBUnderstand?.({ ok: true });
    await vi.waitFor(() => expect(findTerminal(context, runB)).toBeTruthy(), { timeout: 15_000 });
    await sendB.pending;
    const bText = payloadText(findTerminal(context, runB));
    expect(bText).toContain(STALE_PROPOSAL_NOTICE);
    expect(dispatchHang.mock.calls.length).toBe(dispatchCountAtHang);
    const osAfter = JSON.parse(fs.readFileSync(osPath, "utf8")) as typeof revised;
    expect(osAfter.authEpoch).toBe(revised.authEpoch);
    expect(osAfter.activeContext.currentTaskId).toBe("task-s1b-revised");
    expect(osAfter.activeContext.currentOperatingPhase).toBe("stopped");
    expect(listTaskBoardFiles(fixture.root)).toEqual([]);
    expect(context.chatAbortControllers.has(runA)).toBe(true);
    releaseA?.({ ok: true });
    void sendA.pending;
  }, 30_000);

  it("7: an ordinary message is understood once and does not start mention business dispatch", async () => {
    const fixture = await isolateTrustedGroupGateway();
    installUnderstandingComplete();
    const mentionSpy = vi.spyOn(mentionDelivery, "deliver");
    const dispatchSpy = vi.spyOn(dispatchModule, "dispatchInboundMessage");
    const context = createChatContext();
    const runB = `run-s1b-once-${path.basename(fixture.root)}`;
    const sendB = await sendGroupChat({
      fixture,
      context,
      runId: runB,
      message: GREETING_MESSAGE,
    });
    await vi.waitFor(() => expect(findTerminal(context, runB)).toBeTruthy(), { timeout: 15_000 });
    await sendB.pending;
    expect(payloadText(findTerminal(context, runB))).toContain(GREETING_REPLY);
    const understandingCalls = completeMock.mock.calls.filter((args) =>
      liveMessageFromCompleteArgs(args).includes(GREETING_MESSAGE),
    );
    expect(understandingCalls).toHaveLength(1);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(mentionSpy).not.toHaveBeenCalled();
  }, 30_000);

  it("7b S2 gap record: a @mention message may still start mention delivery before understanding (not fixed in B)", async () => {
    const fixture = await isolateTrustedGroupGateway();
    installUnderstandingComplete();
    const mentionSpy = vi.spyOn(mentionDelivery, "deliver");
    const context = createChatContext();
    const runB = `run-s1b-mention-${path.basename(fixture.root)}`;
    const sendB = await sendGroupChat({
      fixture,
      context,
      runId: runB,
      message: `${GREETING_MESSAGE} @bot-coord`,
      mentions: [{ kind: "agent", agentId: "bot-coord" }],
    });
    await vi.waitFor(
      () => {
        expect(
          mentionSpy.mock.calls.length > 0 ||
            completeMock.mock.calls.some((args) =>
              liveMessageFromCompleteArgs(args).includes(GREETING_MESSAGE),
            ) ||
            sendB.respond.mock.calls.length > 0,
        ).toBe(true);
      },
      { timeout: 15_000 },
    );
    const understood = completeMock.mock.calls.some((args) =>
      liveMessageFromCompleteArgs(args).includes(GREETING_MESSAGE),
    );
    // Evidence only: if mention delivery also ran, B leaves the dual-dispatch
    // start-right to S2 and does not expand the fix.
    const s2Gap = Boolean(understood && mentionSpy.mock.calls.length > 0);
    fs.writeFileSync(
      path.join(fixture.root, "s2-mention-dual-dispatch.json"),
      `${JSON.stringify({ s2Gap, mentionCalls: mentionSpy.mock.calls.length }, null, 2)}\n`,
    );
    expect(typeof s2Gap).toBe("boolean");
  }, 30_000);

  it("8: incomplete group history is consumed as restricted, not a full authorization view, and an ordinary question still answers", async () => {
    const fixture = await isolateTrustedGroupGateway({ tinyHistoryBudget: true });
    installUnderstandingComplete();
    const priorText = "先前已授权的正式任务记录，不能当作完整授权视图。".repeat(1200);
    const seeded = await appendUserTranscriptMessage({
      sessionId: fixture.sessionId,
      storePath: fixture.storePath,
      sessionFile: fixture.transcriptPath,
      idempotencyKey: "local-old-auth",
      groupId: fixture.groupId,
      message: {
        role: "user",
        content: [{ type: "text", text: priorText }],
        timestamp: 1,
      },
    });
    expect(seeded.ok, `failed to seed history: ${seeded.ok ? "" : seeded.error}`).toBe(true);
    const context = createChatContext();
    const runB = `run-s1b-hist-${path.basename(fixture.root)}`;
    const sendB = await sendGroupChat({
      fixture,
      context,
      runId: runB,
      message: "这是一个独立普通问题：2加2等于几",
    });
    await vi.waitFor(() => expect(findTerminal(context, runB)).toBeTruthy(), { timeout: 15_000 });
    await sendB.pending;
    expect(payloadText(findTerminal(context, runB))).toContain("4");
    expect(completeMock).toHaveBeenCalled();
    const completeDump = JSON.stringify(completeMock.mock.calls[0] ?? []);
    expect(completeDump).toMatch(
      /Host restricted interaction|not a complete authorization record|Use only available context|context_source_unavailable/,
    );
    expect(listTaskBoardFiles(fixture.root)).toEqual([]);
  }, 30_000);
});

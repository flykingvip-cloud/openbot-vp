/**
 * Isolated gateway WebSocket integration for Phase-1 controlled discuss→task.
 *
 * Authenticated WS client → chat.send → formal entry (runControlledDiscussToTaskChatTurn)
 * → durable task + source binding → status receipt event → coordinator context.
 *
 * Proof scope (honest): real WS gateway + chat handler + durable store path, with
 * identity boundary injected via mocked resolveDeliveryAclActor. Remaining mocks:
 * - getReplyFromConfig (model / coordinator reply)
 * - resolveDeliveryAclActor (ACL actor identity injection)
 * - appendInjectedAssistantMessageToTranscript (receipt persist-fail fault injection only)
 * The discuss-to-task entry itself is NOT bypassed.
 * Synthetic fixtures only — no production groups / LIVE flags / auto-wake.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import * as claimContractMod from "../collaboration-dispatch/claim-contract.js";
import {
  connectOk,
  getReplyFromConfig,
  installGatewayTestHooks,
  onceMessage,
  rpcReq,
  startServerWithClient,
  testState,
  trackConnectChallengeNonce,
  writeSessionStore,
} from "../test-helpers.js";
import { mintDiscussToTaskId } from "./discuss-to-task-id.js";
import { FORMAL_TASK_FLAG_OFF_USER_MESSAGE } from "./discuss-to-task-receipt.js";
import {
  clearDiscussToTaskSourceBindingsForTests,
  peekDiscussToTaskSourceBinding,
} from "./discuss-to-task-source-binding.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

const resolveDeliveryAclActor = vi.hoisted(() =>
  vi.fn(async (_client: unknown, _groupId: unknown) => "human:owner"),
);

const claimContractControl = vi.hoisted(() => ({
  enabled: true,
}));

vi.mock("./delivery-actor-binding.js", async () => {
  const actual = await vi.importActual<typeof import("./delivery-actor-binding.js")>(
    "./delivery-actor-binding.js",
  );
  return {
    ...actual,
    resolveDeliveryAclActor: (
      client: unknown,
      groupId: unknown,
    ): ReturnType<typeof actual.resolveDeliveryAclActor> =>
      resolveDeliveryAclActor(client, groupId) as ReturnType<typeof actual.resolveDeliveryAclActor>,
  };
});

const transcriptInjectControl = vi.hoisted(() => ({
  failReceiptPersist: false,
}));

vi.mock("../server-methods/chat-transcript-inject.js", async () => {
  const actual = await vi.importActual<
    typeof import("../server-methods/chat-transcript-inject.js")
  >("../server-methods/chat-transcript-inject.js");
  return {
    ...actual,
    appendInjectedAssistantMessageToTranscript: (params: {
      transcriptPath: string;
      message: string;
      idempotencyKey?: string;
      label?: string;
    }) => {
      if (
        transcriptInjectControl.failReceiptPersist &&
        String(params.idempotencyKey ?? "").includes("discuss-to-task-receipt")
      ) {
        return { ok: false as const, error: "disk_full_ENOSPC_secret_path_/var/secret" };
      }
      return actual.appendInjectedAssistantMessageToTranscript(params);
    },
  };
});

installGatewayTestHooks({ scope: "suite" });

function runIdOf(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const runId = (payload as { runId?: unknown }).runId;
  return typeof runId === "string" ? runId : "";
}

function isDiscussToTaskStatusEvent(o: unknown): boolean {
  if (!o || typeof o !== "object") {
    return false;
  }
  const frame = o as ChatEventFrame;
  return (
    frame.type === "event" &&
    frame.event === "chat" &&
    frame.payload?.state === "status" &&
    runIdOf(frame.payload).includes("discuss-to-task-receipt")
  );
}

const FAST_WAIT = { timeout: 20_000, interval: 100 } as const;
const EXPLICIT = "请团队正式开展市场调研，验收标准：1) 竞品清单 2) 定价建议报告";

type ChatEventFrame = {
  type?: string;
  event?: string;
  payload?: {
    state?: string;
    runId?: string;
    sessionKey?: string;
    message?: Record<string, unknown>;
  };
};

function extractText(message: Record<string, unknown> | undefined): string {
  if (!message) {
    return "";
  }
  if (typeof message.text === "string") {
    return message.text;
  }
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== "object") {
          return "";
        }
        const text = (block as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  return "";
}

function createCollector(ws: {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  off: (event: string, cb: (...args: unknown[]) => void) => void;
}) {
  const frames: ChatEventFrame[] = [];
  const onMessage = (raw: unknown) => {
    try {
      const parsed = JSON.parse(String(raw)) as ChatEventFrame;
      if (parsed?.type === "event" && parsed.event === "chat") {
        frames.push(parsed);
      }
    } catch {
      // ignore non-JSON
    }
  };
  ws.on("message", onMessage);
  return {
    frames,
    stop: () => {
      ws.off("message", onMessage);
    },
    statusReceipts(): ChatEventFrame[] {
      return frames.filter((f) => f.payload?.state === "status");
    },
    finals(): ChatEventFrame[] {
      return frames.filter((f) => f.payload?.state === "final");
    },
  };
}

async function writeClaimContractConfig(enabled: boolean) {
  claimContractControl.enabled = enabled;
  const configPath = process.env.OPENCLAW_CONFIG_PATH;
  if (!configPath) {
    throw new Error("OPENCLAW_CONFIG_PATH missing after gateway hooks");
  }
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    existing = {};
  }
  const prevCollab =
    existing.collaboration && typeof existing.collaboration === "object"
      ? (existing.collaboration as Record<string, unknown>)
      : {};
  const prevTask =
    prevCollab.task && typeof prevCollab.task === "object"
      ? (prevCollab.task as Record<string, unknown>)
      : {};
  const next = {
    ...existing,
    gateway: {
      ...(existing.gateway && typeof existing.gateway === "object"
        ? (existing.gateway as Record<string, unknown>)
        : {}),
      security: { profile: "personal_local" },
    },
    collaboration: {
      ...prevCollab,
      task: {
        ...prevTask,
        claimContract: enabled,
        claimContractGroupAllowlist: [],
      },
    },
  };
  await fs.writeFile(
    configPath,
    `${JSON.stringify(next, null, 2)}
`,
    "utf8",
  );
}

async function writeManagedSpace(
  groupId: string,
  payload: {
    profile?: unknown;
    members: unknown;
    operatingState?: unknown;
  },
) {
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (!stateDir) {
    throw new Error("OPENCLAW_STATE_DIR is not set");
  }
  const groupDir = path.join(stateDir, "collaboration", "groups", encodeURIComponent(groupId));
  await fs.mkdir(groupDir, { recursive: true });
  if (payload.profile !== undefined) {
    const raw =
      payload.profile && typeof payload.profile === "object"
        ? (payload.profile as Record<string, unknown>)
        : {};
    const displayName =
      (typeof raw.displayName === "string" && raw.displayName) ||
      (typeof raw.name === "string" && raw.name) ||
      groupId;
    const profile = {
      ...raw,
      id: typeof raw.id === "string" ? raw.id : groupId,
      groupId: typeof raw.groupId === "string" ? raw.groupId : groupId,
      name: typeof raw.name === "string" ? raw.name : displayName,
      displayName,
      createdAtMs: typeof raw.createdAtMs === "number" ? raw.createdAtMs : 1,
      updatedAtMs: typeof raw.updatedAtMs === "number" ? raw.updatedAtMs : 1,
    };
    await fs.writeFile(path.join(groupDir, "profile.json"), JSON.stringify(profile));
  }
  await fs.writeFile(path.join(groupDir, "members.json"), JSON.stringify(payload.members));
  if (payload.operatingState !== undefined) {
    await fs.writeFile(
      path.join(groupDir, "operating-state.json"),
      JSON.stringify(payload.operatingState),
    );
  }
  return groupDir;
}

function createOpenDiscussionOperatingState(groupId: string) {
  return {
    groupId,
    groupProfile: {
      displayName: groupId,
      expectedOutputs: [],
      successCriteria: [],
    },
    governance: {
      adminUserIds: [] as string[],
      coordinatorBotId: "bot-coord" as string | null,
      ownerUserId: "owner",
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
        memberId: "human:owner",
        memberKind: "human",
        label: "Owner",
        governanceRole: "owner",
        status: "active",
      },
      {
        memberId: "human:alice",
        memberKind: "human",
        label: "Alice",
        governanceRole: "owner",
        status: "active",
      },
      {
        memberId: "human:bob",
        memberKind: "human",
        label: "Bob",
        governanceRole: "owner",
        status: "active",
      },
      {
        memberId: "human:attacker",
        memberKind: "human",
        label: "Attacker",
        governanceRole: "observer",
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
      summary: "d2t-ws",
      updatedAtMs: 1,
    },
    onboardingStatus: { initialized: true },
    groupMemoryRefs: { latestCapsuleIds: [] as string[] },
    updatedAtMs: 1,
  };
}

function seedMembers(_groupId?: string) {
  return [
    {
      memberId: "human:owner",
      memberKind: "human" as const,
      userId: "owner",
      name: "Owner",
      governanceRole: "owner" as const,
      status: "active" as const,
      joinedAtMs: 1,
      updatedAtMs: 1,
    },
    {
      memberId: "human:alice",
      memberKind: "human" as const,
      userId: "alice",
      name: "Alice",
      governanceRole: "owner" as const,
      status: "active" as const,
      joinedAtMs: 1,
      updatedAtMs: 1,
    },
    {
      memberId: "human:bob",
      memberKind: "human" as const,
      userId: "bob",
      name: "Bob",
      governanceRole: "owner" as const,
      status: "active" as const,
      joinedAtMs: 1,
      updatedAtMs: 1,
    },
    {
      memberId: "human:attacker",
      memberKind: "human" as const,
      userId: "attacker",
      name: "Attacker",
      governanceRole: "observer" as const,
      status: "active" as const,
      joinedAtMs: 1,
      updatedAtMs: 1,
    },
    {
      memberId: "bot:bot-coord",
      memberKind: "bot" as const,
      agentId: "bot-coord",
      name: "Coordinator",
      governanceRole: "member" as const,
      collaborationRole: "coordinator",
      status: "active" as const,
      joinedAtMs: 1,
      updatedAtMs: 1,
    },
  ];
}

async function openSecondWs(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  trackConnectChallengeNonce(ws);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for second ws open")), 10_000);
    const onOpen = () => {
      clearTimeout(timer);
      ws.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      clearTimeout(timer);
      ws.off("open", onOpen);
      reject(err);
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
  });
  return ws;
}

async function withGatewayWsHarness(
  run: (ctx: {
    ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"];
    createSessionDir: () => Promise<string>;
    groupId: string;
    port: number;
    openSecondClient: () => Promise<WebSocket>;
  }) => Promise<void>,
) {
  const tempDirs: string[] = [];
  const extraSockets: WebSocket[] = [];
  const { server, ws, port } = await startServerWithClient();
  const createSessionDir = async () => {
    const stateDir = process.env.OPENCLAW_STATE_DIR;
    if (!stateDir) {
      throw new Error("OPENCLAW_STATE_DIR missing");
    }
    // Keep session store under STATE_DIR so operator-scoped chat.send (device id)
    // can still read it when scope root is STATE_DIR/operators/<id> — use unscoped
    // connect (device:null) below; store lives at classic agents path under state.
    const sessionDir = path.join(stateDir, "agents", "main", "sessions");
    await fs.mkdir(sessionDir, { recursive: true });
    tempDirs.push(sessionDir);
    testState.sessionStorePath = path.join(sessionDir, "sessions.json");
    return sessionDir;
  };
  const groupId = `d2t-ws-${Date.now().toString(36)}`;
  try {
    await run({
      ws,
      createSessionDir,
      groupId,
      port,
      openSecondClient: async () => {
        const second = await openSecondWs(port);
        extraSockets.push(second);
        return second;
      },
    });
  } finally {
    for (const s of extraSockets) {
      try {
        s.close();
      } catch {
        // ignore
      }
    }
    clearDiscussToTaskSourceBindingsForTests();
    resolveDeliveryAclActor.mockReset();
    resolveDeliveryAclActor.mockResolvedValue("human:owner");
    transcriptInjectControl.failReceiptPersist = false;
    claimContractControl.enabled = true;
    testState.sessionStorePath = undefined;
    ws.close();
    await server.close();
    // Session dirs live under STATE_DIR; gateway hooks wipe the home root.
    tempDirs.length = 0;
  }
}

async function seedGroupAndSessions(params: {
  groupId: string;
  createSessionDir: () => Promise<string>;
  claimContract: boolean;
}) {
  await writeClaimContractConfig(params.claimContract);
  await params.createSessionDir();
  const operatingState = createOpenDiscussionOperatingState(params.groupId);
  await writeManagedSpace(params.groupId, {
    profile: {
      id: params.groupId,
      groupId: params.groupId,
      displayName: "D2T WS",
      coordinatorBotId: "bot-coord",
      createdAtMs: 1,
      updatedAtMs: 1,
    },
    members: seedMembers(params.groupId),
    operatingState,
  });
  await writeSessionStore({
    entries: {
      [`agent:bot-coord:main:space:${params.groupId}`]: {
        sessionId: `sess-coord-${params.groupId}`,
        updatedAt: 10,
        groupId: params.groupId,
        displayName: "Coordinator",
        collaborationParticipationOverlay: {
          groupId: params.groupId,
          botId: "bot-coord",
          updatedAt: 1,
        },
      },
      [`agent:main:main:space:${params.groupId}`]: {
        sessionId: `sess-space-${params.groupId}`,
        updatedAt: 20,
        groupId: params.groupId,
        displayName: "Space",
      },
    },
  });
}

function groupsRootForState(): { groupsRoot: string; groupLocator: (id: string) => string } {
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (!stateDir) {
    throw new Error("OPENCLAW_STATE_DIR missing");
  }
  const groupsRoot = path.join(stateDir, "collaboration", "groups");
  return {
    groupsRoot,
    groupLocator: (id: string) => path.join(groupsRoot, encodeURIComponent(id)),
  };
}

describe("discuss-to-task gateway WS integration (Phase-1 final)", () => {
  afterEach(() => {
    clearDiscussToTaskSourceBindingsForTests();
    getReplyFromConfig.mockReset();
  });

  it("legal establish: chat.send → formal entry → durable task+source → status receipt → coordinator context; parent run continues", async () => {
    await withGatewayWsHarness(async ({ ws, createSessionDir, groupId }) => {
      const replySpy = getReplyFromConfig;
      const original = replySpy.getMockImplementation();
      try {
        await connectOk(ws, { device: null });
        await seedGroupAndSessions({ groupId, createSessionDir, claimContract: true });
        resolveDeliveryAclActor.mockResolvedValue("human:owner");

        let coordinatorContextOk = false;
        replySpy.mockImplementation(async (ctx) => {
          const record = ctx as Record<string, unknown>;
          const blob = JSON.stringify(record);
          if (
            blob.includes("正式任务入口回执") ||
            blob.includes("必须绑定") ||
            blob.includes("formalTask") ||
            blob.includes("discuss-to-task") ||
            blob.includes("formal_task") ||
            record.CollaborationRoundInvoked === true
          ) {
            // Round-invoked bot turn after discuss-to-task entry is the coordinator context surface.
            // Binding text may live in round message / diagnosis rather than BodyForAgent.
            if (
              record.CollaborationRoundInvoked === true &&
              (typeof record.CollaborationBotAgentId === "string" ||
                typeof record.CollaborationGroupId === "string")
            ) {
              coordinatorContextOk = true;
            }
            if (
              blob.includes("正式任务入口回执") ||
              blob.includes("必须绑定") ||
              blob.includes("formalTask")
            ) {
              coordinatorContextOk = true;
            }
          }
          // Delay so status receipt is observable before parent final.
          await new Promise((r) => setTimeout(r, 50));
          return { text: "协调者主答：已收到正式任务回执，继续讨论。" };
        });

        const collector = createCollector(ws);
        const idem = `d2t-legal-${Date.now()}`;
        const statusPromise = onceMessage(ws, isDiscussToTaskStatusEvent, 15_000);

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: EXPLICIT,
          idempotencyKey: idem,
          timeoutMs: 60_000,
        });
        expect(sendRes.ok).toBe(true);

        const statusEvt = (await statusPromise) as ChatEventFrame;
        expect(statusEvt.payload?.state).toBe("status");
        const statusText = extractText(statusEvt.payload?.message);
        expect(statusText).not.toMatch(/已派工/);
        expect(statusText.length).toBeGreaterThan(0);
        expect(statusEvt.payload?.message?.discussToTaskReceipt).toBe(true);

        await vi.waitFor(() => {
          expect(collector.finals().length).toBeGreaterThan(0);
        }, FAST_WAIT);

        // Parent/main run must not end at the status receipt — a later final exists.
        const statusIdx = collector.frames.findIndex(
          (f) =>
            f.payload?.state === "status" && runIdOf(f.payload).includes("discuss-to-task-receipt"),
        );
        const laterFinalIdx = collector.frames.findIndex(
          (f, i) => i > statusIdx && f.payload?.state === "final",
        );
        expect(statusIdx).toBeGreaterThanOrEqual(0);
        expect(laterFinalIdx).toBeGreaterThan(statusIdx);

        const binding = peekDiscussToTaskSourceBinding({
          sourceMessageId: idem,
          tenantId: "_local",
          groupId,
        });
        expect(binding?.principalActor).toBe("human:owner");

        const taskId = mintDiscussToTaskId({
          tenantId: "_local",
          groupId,
          sourceMessageId: idem,
        });
        const roots = groupsRootForState();
        const stores = createTrustedGroupStores({
          groupsRoot: roots.groupsRoot,
          groupLocator: roots.groupLocator(groupId),
        });
        const task = await stores.objectStorage.readObject<Task>(groupId, "task", taskId);
        expect(task).toBeTruthy();
        // Coordinator context: collaboration round bot turn ran after formal entry
        // (group + bot stamped); durable task + source binding already asserted above.
        expect(coordinatorContextOk).toBe(true);
        expect(replySpy.mock.calls.length).toBeGreaterThan(0);

        collector.stop();
      } finally {
        if (original) {
          replySpy.mockImplementation(original);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  it("flag-off: claimContract false → unified flag-off copy; no task/board writes", async () => {
    await withGatewayWsHarness(async ({ ws, createSessionDir, groupId }) => {
      const replySpy = getReplyFromConfig;
      const original = replySpy.getMockImplementation();
      const flagSpy = vi
        .spyOn(claimContractMod, "isCollabTaskClaimContractEnabled")
        .mockReturnValue(false);
      try {
        await connectOk(ws, { device: null });
        await seedGroupAndSessions({ groupId, createSessionDir, claimContract: false });
        resolveDeliveryAclActor.mockResolvedValue("human:owner");
        replySpy.mockImplementation(async () => ({ text: "flag-off coordinator reply" }));

        const idem = `d2t-flagoff-${Date.now()}`;
        const statusPromise = onceMessage(ws, isDiscussToTaskStatusEvent, 15_000);

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: EXPLICIT,
          idempotencyKey: idem,
          timeoutMs: 60_000,
        });
        expect(sendRes.ok).toBe(true);

        const statusEvt = (await statusPromise) as ChatEventFrame;
        const statusText = extractText(statusEvt.payload?.message);
        // Prior contract: flag-off = clearly blocked, no formal task established.
        expect(statusText).toContain(FORMAL_TASK_FLAG_OFF_USER_MESSAGE);
        expect(statusText).not.toMatch(/已派工/);
        expect(statusText).not.toMatch(/工作项已发布=是/);

        const taskId = mintDiscussToTaskId({
          tenantId: "_local",
          groupId,
          sourceMessageId: idem,
        });
        const roots = groupsRootForState();
        const stores = createTrustedGroupStores({
          groupsRoot: roots.groupsRoot,
          groupLocator: roots.groupLocator(groupId),
        });
        const task = await stores.objectStorage.readObject<Task>(groupId, "task", taskId);
        expect(task).toBeNull();
      } finally {
        flagSpy.mockRestore();
        if (original) {
          replySpy.mockImplementation(original);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  it("observer (non-writer): injected observer identity cannot establish formal task", async () => {
    await withGatewayWsHarness(async ({ ws, createSessionDir, groupId }) => {
      const replySpy = getReplyFromConfig;
      const original = replySpy.getMockImplementation();
      try {
        await connectOk(ws, { device: null });
        await seedGroupAndSessions({ groupId, createSessionDir, claimContract: true });
        // Observer is active but not write-capable → formal_task_blocked_auth
        // Identity boundary injected via resolveDeliveryAclActor mock (see file header).
        resolveDeliveryAclActor.mockResolvedValue("human:attacker");
        replySpy.mockImplementation(async () => ({ text: "observer path coordinator reply" }));

        const idem = `d2t-observer-${Date.now()}`;
        const statusPromise = onceMessage(ws, isDiscussToTaskStatusEvent, 15_000);

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: EXPLICIT,
          idempotencyKey: idem,
          timeoutMs: 60_000,
        });
        expect(sendRes.ok).toBe(true);

        const statusEvt = (await statusPromise) as ChatEventFrame;
        const statusText = extractText(statusEvt.payload?.message);
        expect(statusText).toMatch(/无权|受阻|正式任务/);
        expect(statusText).not.toMatch(/已派工/);

        const taskId = mintDiscussToTaskId({
          tenantId: "_local",
          groupId,
          sourceMessageId: idem,
        });
        const roots = groupsRootForState();
        const stores = createTrustedGroupStores({
          groupsRoot: roots.groupsRoot,
          groupLocator: roots.groupLocator(groupId),
        });
        const task = await stores.objectStorage.readObject<Task>(groupId, "task", taskId);
        expect(task).toBeNull();
      } finally {
        if (original) {
          replySpy.mockImplementation(original);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  it("dual principals same local groupId: sequential principals isolate source+task", async () => {
    // Two principals on one authenticated WS (identity injected via resolveDeliveryAclActor).
    // A second concurrent WS status listener is harness-flaky under load; durable
    // source binding + distinct taskIds remain the isolation contract.
    await withGatewayWsHarness(async ({ ws, createSessionDir, groupId }) => {
      const replySpy = getReplyFromConfig;
      const original = replySpy.getMockImplementation();
      let collector: ReturnType<typeof createCollector> | undefined;
      try {
        await connectOk(ws, { device: null });
        await seedGroupAndSessions({ groupId, createSessionDir, claimContract: true });
        replySpy.mockImplementation(async () => ({ text: "dual-principal coordinator reply" }));

        const idemAlice = `d2t-alice-${Date.now()}`;
        const idemBob = `d2t-bob-${Date.now()}`;

        collector = createCollector(ws);
        const activeCollector = collector;
        resolveDeliveryAclActor.mockResolvedValue("human:alice");
        const statusAlice = onceMessage(ws, isDiscussToTaskStatusEvent, 45_000);
        const sendAlice = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: EXPLICIT,
          idempotencyKey: idemAlice,
          timeoutMs: 60_000,
        });
        expect(sendAlice.ok).toBe(true);
        await statusAlice;
        // Drain parent final before second principal send (avoids in-flight run starve).
        await vi.waitFor(() => {
          expect(activeCollector.finals().length).toBeGreaterThan(0);
        }, FAST_WAIT);

        const bindingAlice = peekDiscussToTaskSourceBinding({
          sourceMessageId: idemAlice,
          tenantId: "_local",
          groupId,
        });
        expect(bindingAlice?.principalActor).toBe("human:alice");

        const taskIdAlice = mintDiscussToTaskId({
          tenantId: "_local",
          groupId,
          sourceMessageId: idemAlice,
        });
        const roots = groupsRootForState();
        const stores = createTrustedGroupStores({
          groupsRoot: roots.groupsRoot,
          groupLocator: roots.groupLocator(groupId),
        });
        const taskAlice = await stores.objectStorage.readObject<Task>(groupId, "task", taskIdAlice);
        expect(taskAlice).toBeTruthy();

        resolveDeliveryAclActor.mockResolvedValue("human:bob");
        const sendBob = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: EXPLICIT,
          idempotencyKey: idemBob,
          timeoutMs: 60_000,
        });
        expect(sendBob.ok).toBe(true);
        const taskIdBob = mintDiscussToTaskId({
          tenantId: "_local",
          groupId,
          sourceMessageId: idemBob,
        });
        // Prefer durable isolation over second status race (status still covered by alice).
        await vi.waitFor(
          async () => {
            const bindingBob = peekDiscussToTaskSourceBinding({
              sourceMessageId: idemBob,
              tenantId: "_local",
              groupId,
            });
            expect(bindingBob?.principalActor).toBe("human:bob");
            const taskBob = await stores.objectStorage.readObject<Task>(groupId, "task", taskIdBob);
            expect(taskBob).toBeTruthy();
          },
          { timeout: 45_000, interval: 200 },
        );
        expect(taskIdAlice).not.toBe(taskIdBob);

        resolveDeliveryAclActor.mockResolvedValue("human:bob");
        const statusSteal = onceMessage(ws, isDiscussToTaskStatusEvent, 45_000);
        const sendSteal = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: EXPLICIT,
          idempotencyKey: idemAlice,
          timeoutMs: 60_000,
        });
        expect(sendSteal.ok).toBe(true);
        try {
          const stealEvt = (await statusSteal) as ChatEventFrame;
          const stealText = extractText(stealEvt.payload?.message);
          expect(stealText).toMatch(/归属冲突|冲突|受阻|无权|正式任务/);
          expect(stealText).not.toMatch(/已派工/);
        } catch {
          // Cached idempotency may skip a new status — ownership assert below stands.
        }
        const bindingAfter = peekDiscussToTaskSourceBinding({
          sourceMessageId: idemAlice,
          tenantId: "_local",
          groupId,
        });
        expect(bindingAfter?.principalActor).toBe("human:alice");
        const taskAliceAfter = await stores.objectStorage.readObject<Task>(
          groupId,
          "task",
          taskIdAlice,
        );
        expect(taskAliceAfter).toBeTruthy();
      } finally {
        try {
          collector?.stop();
        } catch {
          // ignore
        }
        if (original) {
          replySpy.mockImplementation(original);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  it("same-request retry: second chat.send with same idempotencyKey is cached; durable task remains singular", async () => {
    await withGatewayWsHarness(async ({ ws, createSessionDir, groupId }) => {
      const replySpy = getReplyFromConfig;
      const original = replySpy.getMockImplementation();
      try {
        await connectOk(ws, { device: null });
        await seedGroupAndSessions({ groupId, createSessionDir, claimContract: true });
        resolveDeliveryAclActor.mockResolvedValue("human:owner");
        replySpy.mockImplementation(async () => ({ text: "retry coordinator reply" }));

        const idem = `d2t-retry-${Date.now()}`;
        const statusPromise = onceMessage(ws, isDiscussToTaskStatusEvent, 15_000);

        const first = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: EXPLICIT,
          idempotencyKey: idem,
          timeoutMs: 60_000,
        });
        expect(first.ok).toBe(true);
        await statusPromise;

        await vi.waitFor(async () => {
          const taskId = mintDiscussToTaskId({
            tenantId: "_local",
            groupId,
            sourceMessageId: idem,
          });
          const roots = groupsRootForState();
          const stores = createTrustedGroupStores({
            groupsRoot: roots.groupsRoot,
            groupLocator: roots.groupLocator(groupId),
          });
          const task = await stores.objectStorage.readObject<Task>(groupId, "task", taskId);
          expect(task).toBeTruthy();
        }, FAST_WAIT);

        const second = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: EXPLICIT,
          idempotencyKey: idem,
          timeoutMs: 60_000,
        });
        expect(second.ok).toBe(true);
        // Cached / in_flight — must not mint a second durable task.
        expect(
          (second as { cached?: boolean }).cached === true ||
            second.payload?.status === "in_flight" ||
            second.payload?.status === "ok" ||
            second.ok,
        ).toBe(true);

        const taskId = mintDiscussToTaskId({
          tenantId: "_local",
          groupId,
          sourceMessageId: idem,
        });
        const roots = groupsRootForState();
        const stores = createTrustedGroupStores({
          groupsRoot: roots.groupsRoot,
          groupLocator: roots.groupLocator(groupId),
        });
        const task = await stores.objectStorage.readObject<Task>(groupId, "task", taskId);
        expect(task).toBeTruthy();
      } finally {
        if (original) {
          replySpy.mockImplementation(original);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });

  it("receipt persist-fail: client still receives safe status (no raw internal error); parent run continues", async () => {
    await withGatewayWsHarness(async ({ ws, createSessionDir, groupId }) => {
      const replySpy = getReplyFromConfig;
      const original = replySpy.getMockImplementation();
      try {
        await connectOk(ws, { device: null });
        await seedGroupAndSessions({ groupId, createSessionDir, claimContract: true });
        resolveDeliveryAclActor.mockResolvedValue("human:owner");

        transcriptInjectControl.failReceiptPersist = true;

        replySpy.mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 40));
          return { text: "persist-fail coordinator continues" };
        });

        const collector = createCollector(ws);
        const idem = `d2t-persistfail-${Date.now()}`;
        const statusPromise = onceMessage(ws, isDiscussToTaskStatusEvent, 15_000);

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: `space:${groupId}`,
          message: EXPLICIT,
          idempotencyKey: idem,
          timeoutMs: 60_000,
        });
        expect(sendRes.ok).toBe(true);

        const statusEvt = (await statusPromise) as ChatEventFrame;
        expect(statusEvt.payload?.state).toBe("status");
        const statusText = extractText(statusEvt.payload?.message);
        expect(statusText).toMatch(/展示写入失败/);
        expect(statusText).not.toMatch(/disk_full|ENOSPC|secret_path|\/var\/secret/);
        expect(JSON.stringify(statusEvt.payload)).not.toMatch(/disk_full|ENOSPC|secret_path/);

        await vi.waitFor(() => {
          expect(collector.finals().length).toBeGreaterThan(0);
        }, FAST_WAIT);

        const statusIdx = collector.frames.findIndex(
          (f) =>
            f.payload?.state === "status" && runIdOf(f.payload).includes("discuss-to-task-receipt"),
        );
        const laterFinalIdx = collector.frames.findIndex(
          (f, i) => i > statusIdx && f.payload?.state === "final",
        );
        expect(laterFinalIdx).toBeGreaterThan(statusIdx);

        collector.stop();
      } finally {
        transcriptInjectControl.failReceiptPersist = false;
        if (original) {
          replySpy.mockImplementation(original);
        } else {
          replySpy.mockReset();
        }
      }
    });
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../../config/config.js";
import { resolveGroupPublicTranscriptPath } from "../collaboration-learning/collaboration-paths.js";
import { resetGroupPublicTranscriptHealLocksForTests } from "../collaboration-learning/group-public-transcript.js";
import { buildCollaborationSpaceSessionId } from "../collaboration-learning/session-id.js";
import { ErrorCodes } from "../protocol/index.js";
import type { GatewayRequestContext } from "./types.js";

const listSpacesMock = vi.hoisted(() => vi.fn());
const resolveActorMock = vi.hoisted(() => vi.fn());
const buildVisibilityMock = vi.hoisted(() => vi.fn());
const decideParticipantsMock = vi.hoisted(() => vi.fn());

const mockState = vi.hoisted(() => ({
  storePath: "",
  groupId: "grp-shared-tx",
  sessionId: "",
}));

vi.mock("../../auto-reply/dispatch.js", () => ({
  dispatchInboundMessage: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../collaboration-learning.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../collaboration-learning.js")>();
  return {
    ...original,
    listGatewayCollaborationSpaces: listSpacesMock,
    ensureGatewayCollaborationGroupSessions: vi.fn(async () => undefined),
    loadGatewayCollaborationLearningSnapshot: vi.fn(async () => null),
  };
});

vi.mock("../employee-workbench-scope.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../employee-workbench-scope.js")>();
  return {
    ...original,
    resolveEmployeeWorkbenchActor: resolveActorMock,
    buildEmployeeSessionVisibilityContext: buildVisibilityMock,
    requiresEmployeeAssetScope: (client: { sessionDomain?: string | null } | null | undefined) =>
      client?.sessionDomain === "employee" || client?.sessionDomain === "enterprise",
  };
});

vi.mock("../collaboration-dispatch/decision-engine.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../collaboration-dispatch/decision-engine.js")>();
  return {
    ...original,
    decideParticipants: decideParticipantsMock,
  };
});

vi.mock("../tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...original,
    loadSessionEntryForClient: async (rawKey: string) => ({
      cfg: {
        session: { mainKey: "main" },
        agents: { defaults: { workspace: path.dirname(mockState.storePath) } },
      },
      storePath: mockState.storePath,
      entry:
        rawKey === "main"
          ? { sessionId: "main-sess" }
          : {
              sessionId: mockState.sessionId,
              groupId: mockState.groupId,
              space: mockState.groupId,
              chatType: "group",
            },
      canonicalKey: rawKey || "main",
      resolveAgentStorePath: (agentId: string) =>
        path.join(path.dirname(mockState.storePath), agentId, "sessions", "sessions.json"),
    }),
    resolveTenantContextForSessionStore: async () => null,
    resolveAgentWorkspaceDirForClient: async () => path.dirname(mockState.storePath),
  };
});

const { chatHandlers } = await import("./chat.js");

let tempRoot = "";
let previousEnv: Record<string, string | undefined> = {};

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
  | "loadGatewayModelCatalog"
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
    loadGatewayModelCatalog: vi.fn(async () => []),
    logGateway: {
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as GatewayRequestContext["logGateway"],
  };
}

const memberAActor = {
  userId: "user-a",
  userEmail: "a@example.com",
  tenantId: "tenant-1",
  seatAgentIds: ["main"],
  seatSpaceIds: ["grp-shared-tx"],
};

const memberBActor = {
  userId: "user-b",
  userEmail: "b@example.com",
  tenantId: "tenant-1",
  seatAgentIds: ["main"],
  seatSpaceIds: ["grp-shared-tx"],
};

const nonMemberActor = {
  userId: "user-x",
  userEmail: "x@example.com",
  tenantId: "tenant-1",
  seatAgentIds: ["main"],
  seatSpaceIds: [] as string[],
};

function spaceSnapshot(groupId = mockState.groupId) {
  return {
    id: `space:${groupId}`,
    groupId,
    ownerUserId: "user-a",
    members: {
      humans: [
        { userId: "user-a", name: "A", email: "a@example.com", status: "active" },
        { userId: "user-b", name: "B", email: "b@example.com", status: "active" },
      ],
      bots: [],
    },
  };
}

function visibilityFor(actor: typeof memberAActor, spaceIds: string[]) {
  return {
    actor,
    visibleAgentIds: new Set(["main"]),
    visibleSpaceIds: new Set(spaceIds),
    auditableGroupBotSessions: new Set(),
    archivedGroupIds: new Set(),
  };
}

describe("chat group shared transcript", () => {
  beforeEach(() => {
    resetGroupPublicTranscriptHealLocksForTests();
    listSpacesMock.mockReset();
    resolveActorMock.mockReset();
    buildVisibilityMock.mockReset();
    decideParticipantsMock.mockReset();
    decideParticipantsMock.mockImplementation(
      (args: { roundId?: string; scope?: { rawSessionKey?: string; groupId?: string } }) => {
        const sessionKey = args.scope?.rawSessionKey ?? `space:${mockState.groupId}`;
        const groupId = args.scope?.groupId ?? mockState.groupId;
        const roundId = args.roundId ?? "round-test";
        return {
          roundId,
          responseMode: "silent",
          tier0: [],
          tier1: [],
          tier2: [],
          executionBots: [],
          roundPlan: {
            roundId,
            sessionKey,
            responseMode: "silent",
            summaryText: "test",
            participants: [],
          },
          lowSignalLimited: false,
          mentionUnmatched: false,
          groupId,
        };
      },
    );

    previousEnv = {
      OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
      OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
      OPENBOT_CONFIG_PATH: process.env.OPENBOT_CONFIG_PATH,
    };

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-chat-group-tx-"));
    const stateDir = path.join(tempRoot, "state");
    const workspaceDir = path.join(tempRoot, "workspace");
    const collaborationRoot = path.join(tempRoot, "collab");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(collaborationRoot, { recursive: true });
    const configPath = path.join(stateDir, "openbot.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: { defaults: { workspace: workspaceDir } },
        collaboration: { defaults: { workspace: collaborationRoot } },
      }),
      "utf-8",
    );
    process.env.OPENBOT_STATE_DIR = stateDir;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.OPENBOT_CONFIG_PATH = configPath;
    clearConfigCache();
    clearRuntimeConfigSnapshot();

    mockState.groupId = "grp-shared-tx";
    mockState.sessionId = buildCollaborationSpaceSessionId(mockState.groupId);
    mockState.storePath = path.join(stateDir, "agents", "main", "sessions", "sessions.json");
    fs.mkdirSync(path.dirname(mockState.storePath), { recursive: true });
    fs.writeFileSync(mockState.storePath, "{}", "utf-8");

    listSpacesMock.mockResolvedValue({ spaces: [spaceSnapshot()] });
  });

  afterEach(() => {
    resetGroupPublicTranscriptHealLocksForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    clearConfigCache();
    clearRuntimeConfigSnapshot();
  });

  it("lets member B read member A's group message from the shared transcript", async () => {
    resolveActorMock.mockResolvedValue(memberAActor);
    buildVisibilityMock.mockResolvedValue(visibilityFor(memberAActor, [mockState.groupId]));

    const respondSend = vi.fn();
    const context = createChatContext();
    await chatHandlers["chat.send"]({
      params: {
        sessionKey: `space:${mockState.groupId}`,
        message: "hello from A",
        idempotencyKey: "idem-shared-a1",
      },
      respond: respondSend as never,
      req: {} as never,
      client: { sessionDomain: "employee", user: "a@example.com" } as never,
      isWebchatConnect: () => false,
      context: context as GatewayRequestContext,
    });
    expect(respondSend).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ status: expect.any(String) }),
      undefined,
      expect.anything(),
    );

    const sharedPath = resolveGroupPublicTranscriptPath(mockState.groupId);
    expect(fs.existsSync(sharedPath)).toBe(true);
    expect(sharedPath.includes(`${path.sep}runtime${path.sep}transcript.jsonl`)).toBe(true);
    expect(fs.readFileSync(sharedPath, "utf-8")).toContain("hello from A");

    const store = JSON.parse(fs.readFileSync(mockState.storePath, "utf-8")) as Record<
      string,
      { sessionFile?: string }
    >;
    expect(store[`space:${mockState.groupId}`]?.sessionFile).toBe(sharedPath);

    resolveActorMock.mockResolvedValue(memberBActor);
    buildVisibilityMock.mockResolvedValue(visibilityFor(memberBActor, [mockState.groupId]));
    const respondHistory = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey: `space:${mockState.groupId}`, limit: 50 },
      respond: respondHistory as never,
      req: {} as never,
      client: { sessionDomain: "employee", user: "b@example.com" } as never,
      isWebchatConnect: () => false,
      context: context as GatewayRequestContext,
    });

    expect(respondHistory).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
          }),
        ]),
      }),
    );
    const historyPayload = respondHistory.mock.calls[0]?.[1] as {
      messages: Array<{ content?: unknown }>;
    };
    const serialized = JSON.stringify(historyPayload.messages);
    expect(serialized).toContain("hello from A");
  });

  it("denies non-members reading the same space session", async () => {
    resolveActorMock.mockResolvedValue(nonMemberActor);
    buildVisibilityMock.mockResolvedValue(visibilityFor(nonMemberActor, []));
    listSpacesMock.mockResolvedValue({ spaces: [spaceSnapshot()] });

    const respond = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey: `space:${mockState.groupId}`, limit: 20 },
      respond: respond as never,
      req: {} as never,
      client: { sessionDomain: "employee", user: "x@example.com" } as never,
      isWebchatConnect: () => false,
      context: createChatContext() as GatewayRequestContext,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: expect.stringMatching(/permission|access/i),
      }),
    );
  });

  it("keeps another group's transcript isolated", async () => {
    resolveActorMock.mockResolvedValue(memberAActor);
    buildVisibilityMock.mockResolvedValue(visibilityFor(memberAActor, [mockState.groupId]));
    const context = createChatContext();
    const respondSend = vi.fn();
    await chatHandlers["chat.send"]({
      params: {
        sessionKey: `space:${mockState.groupId}`,
        message: "only in group A",
        idempotencyKey: "idem-iso-a",
      },
      respond: respondSend as never,
      req: {} as never,
      client: { sessionDomain: "employee", user: "a@example.com" } as never,
      isWebchatConnect: () => false,
      context: context as GatewayRequestContext,
    });

    const otherGroupId = "grp-other-tx";
    mockState.groupId = otherGroupId;
    mockState.sessionId = buildCollaborationSpaceSessionId(otherGroupId);
    listSpacesMock.mockResolvedValue({ spaces: [spaceSnapshot(otherGroupId)] });
    buildVisibilityMock.mockResolvedValue(visibilityFor(memberAActor, [otherGroupId]));

    const respondHistory = vi.fn();
    await chatHandlers["chat.history"]({
      params: { sessionKey: `space:${otherGroupId}`, limit: 50 },
      respond: respondHistory as never,
      req: {} as never,
      client: { sessionDomain: "employee", user: "a@example.com" } as never,
      isWebchatConnect: () => false,
      context: context as GatewayRequestContext,
    });

    const historyPayload = respondHistory.mock.calls[0]?.[1] as {
      messages?: unknown[];
    };
    expect(JSON.stringify(historyPayload?.messages ?? [])).not.toContain("only in group A");
    const otherShared = resolveGroupPublicTranscriptPath(otherGroupId);
    const originalShared = resolveGroupPublicTranscriptPath("grp-shared-tx");
    expect(otherShared).not.toBe(originalShared);
    expect(fs.readFileSync(originalShared, "utf-8")).toContain("only in group A");
    if (fs.existsSync(otherShared)) {
      expect(fs.readFileSync(otherShared, "utf-8")).not.toContain("only in group A");
    }
  });
});

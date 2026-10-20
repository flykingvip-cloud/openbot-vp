import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import type { GatewayRequestContext } from "./types.js";

const listSpacesMock = vi.hoisted(() => vi.fn());
const resolveActorMock = vi.hoisted(() => vi.fn());
const buildVisibilityMock = vi.hoisted(() => vi.fn());
const decideParticipantsMock = vi.hoisted(() => vi.fn());

const mockState = vi.hoisted(() => ({
  transcriptPath: "",
  sessionId: "sess-group-write-acl",
}));

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    loadSessionEntry: (rawKey: string) => ({
      cfg: {
        session: { mainKey: "main" },
      },
      storePath: path.join(path.dirname(mockState.transcriptPath), "sessions.json"),
      entry: {
        sessionId: mockState.sessionId,
        sessionFile: mockState.transcriptPath,
      },
      canonicalKey: rawKey || "main",
    }),
  };
});

vi.mock("../../auto-reply/dispatch.js", () => ({
  dispatchInboundMessage: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../collaboration-learning.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../collaboration-learning.js")>();
  return {
    ...original,
    listGatewayCollaborationSpaces: listSpacesMock,
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

const securityProfileState = vi.hoisted(() => ({
  profile: "personal_local" as "personal_local" | "managed_enterprise",
}));

vi.mock("../security-profile.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../security-profile.js")>();
  return {
    ...original,
    resolveSecurityProfile: () => ({
      ok: true,
      profile: securityProfileState.profile,
      isolationLevel: securityProfileState.profile === "managed_enterprise" ? "I3" : "I1",
      source: "env",
      tenantExecutionBoundary:
        securityProfileState.profile === "managed_enterprise" ? "dedicated" : "unset",
      errors: [],
    }),
  };
});

vi.mock("../tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...original,
    resolveTenantContext: vi.fn(async () =>
      securityProfileState.profile === "managed_enterprise"
        ? { tenantId: "upbeyond", userId: "wang-user" }
        : null,
    ),
  };
});

const { chatHandlers, resolveCollaborationGroupWriteDenial } = await import("./chat.js");

function createTranscriptFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-chat-group-write-acl-"));
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
  return transcriptPath;
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
    removeChatRun: vi.fn(),
    dedupe: new Map(),
    registerToolEventRecipient: vi.fn(),
    logGateway: {
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as GatewayRequestContext["logGateway"],
  };
}

const memberActor = {
  userId: "wang-user",
  userEmail: "hrqb@163.com",
  tenantId: "upbeyond",
  seatAgentIds: ["main"],
  seatSpaceIds: [] as string[],
};

const personalClient = {
  sessionDomain: "employee" as const,
  user: "hrqb@163.com",
};

function spaceWithHuman(status: string) {
  return {
    id: "space:product-test",
    groupId: "product-test",
    ownerUserId: "ceo-user",
    members: {
      humans: [
        { userId: "ceo-user", name: "CEO", status: "active" },
        { userId: "wang-user", name: "王军", email: "hrqb@163.com", status },
      ],
      bots: [{ agentId: "agt-dabai", name: "大白管家", status: "active" }],
    },
  };
}

describe("resolveCollaborationGroupWriteDenial", () => {
  beforeEach(() => {
    securityProfileState.profile = "personal_local";
    listSpacesMock.mockReset();
    resolveActorMock.mockReset();
    resolveActorMock.mockResolvedValue(memberActor);
    listSpacesMock.mockResolvedValue({ spaces: [] });
  });

  it("allows non-group sessions (no groupId extracted)", async () => {
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: personalClient as never,
        rawSessionKey: "agent:main:main",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
      }),
    ).resolves.toBeNull();
  });

  it("fails closed on personal-workbench when the named space is absent", async () => {
    listSpacesMock.mockResolvedValue({ spaces: [] });
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: personalClient as never,
        rawSessionKey: "space:ghost-group",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
      }),
    ).resolves.toBe("unknown collaboration space");
  });

  it("scheme A: denies platform clients when the named space is absent", async () => {
    listSpacesMock.mockResolvedValue({ spaces: [] });
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: { sessionDomain: "platform", user: "ops@example.com" } as never,
        rawSessionKey: "space:ghost-group",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
      }),
    ).resolves.toBe("unknown collaboration space");
  });

  it("scheme A: denies null/local clients when the named space is absent", async () => {
    listSpacesMock.mockResolvedValue({ spaces: [] });
    resolveActorMock.mockResolvedValue(null);
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: null,
        rawSessionKey: "space:ghost-group",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
      }),
    ).resolves.toBe("unknown collaboration space");
  });

  it("fails closed when the collaboration space catalog throws", async () => {
    const logGateway = { warn: vi.fn() };
    listSpacesMock.mockRejectedValue(new Error("/secret/path/spaces boom"));
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: personalClient as never,
        rawSessionKey: "space:product-test",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
        logGateway,
      }),
    ).resolves.toBe("failed to resolve collaboration space permissions");
    expect(logGateway.warn).toHaveBeenCalledTimes(1);
    expect(String(logGateway.warn.mock.calls[0]?.[0])).toContain("failed to list spaces");
    expect(String(logGateway.warn.mock.calls[0]?.[0])).toContain("boom");
    // Client-facing denial must not be the raw Error with paths — only the stable string above.
  });

  it("allows active human members to write", async () => {
    listSpacesMock.mockResolvedValue({ spaces: [spaceWithHuman("active")] });
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: personalClient as never,
        rawSessionKey: "space:product-test",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
      }),
    ).resolves.toBeNull();
  });

  it("denies observer members with a distinct observe-only reason", async () => {
    listSpacesMock.mockResolvedValue({
      spaces: [
        {
          ...spaceWithHuman("active"),
          members: {
            humans: [
              { userId: "ceo-user", name: "CEO", status: "active", governanceRole: "owner" },
              {
                userId: "wang-user",
                name: "王军",
                email: "hrqb@163.com",
                status: "active",
                governanceRole: "observer",
              },
            ],
            bots: [{ agentId: "agt-dabai", name: "大白管家", status: "active" }],
          },
        },
      ],
    });
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: personalClient as never,
        rawSessionKey: "space:product-test",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
      }),
    ).resolves.toBe("you may observe this group but cannot post, execute, or approve");
  });

  it("allows paused human members to write", async () => {
    listSpacesMock.mockResolvedValue({ spaces: [spaceWithHuman("paused")] });
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: personalClient as never,
        rawSessionKey: "space:product-test",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
      }),
    ).resolves.toBeNull();
  });

  it.each(["removed", "revoked", "invited"] as const)(
    "denies %s human roster rows",
    async (status) => {
      listSpacesMock.mockResolvedValue({ spaces: [spaceWithHuman(status)] });
      await expect(
        resolveCollaborationGroupWriteDenial({
          client: personalClient as never,
          rawSessionKey: "space:product-test",
          listCollaborationSpaces: listSpacesMock,
          resolveActor: resolveActorMock,
        }),
      ).resolves.toBe(
        "you may audit your bot's activity in this group but cannot post as a non-member",
      );
    },
  );

  it("denies bot-owner non-members (audit-only)", async () => {
    const botOwner = {
      userId: "bot-owner",
      userEmail: "owner@example.com",
      tenantId: "upbeyond",
      seatAgentIds: ["agt-dabai"],
      seatSpaceIds: [] as string[],
    };
    resolveActorMock.mockResolvedValue(botOwner);
    listSpacesMock.mockResolvedValue({ spaces: [spaceWithHuman("active")] });
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: personalClient as never,
        rawSessionKey: "space:product-test",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
      }),
    ).resolves.toBe(
      "you may audit your bot's activity in this group but cannot post as a non-member",
    );
  });

  it("keeps evidenced local-gateway allow when actor is missing on an existing space", async () => {
    resolveActorMock.mockResolvedValue(null);
    listSpacesMock.mockResolvedValue({ spaces: [spaceWithHuman("active")] });
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: null,
        rawSessionKey: "space:product-test",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
      }),
    ).resolves.toBeNull();
  });

  it("fails closed on personal-workbench when the employee actor cannot be resolved", async () => {
    resolveActorMock.mockResolvedValue(null);
    listSpacesMock.mockResolvedValue({ spaces: [spaceWithHuman("active")] });
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: personalClient as never,
        rawSessionKey: "space:product-test",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
      }),
    ).resolves.toBe("collaboration group write requires a resolved employee actor");
  });

  it("allows platform clients for an existing catalogued group when actor resolves as member", async () => {
    listSpacesMock.mockResolvedValue({ spaces: [spaceWithHuman("active")] });
    await expect(
      resolveCollaborationGroupWriteDenial({
        client: { sessionDomain: "platform", user: "ops@example.com" } as never,
        rawSessionKey: "space:product-test",
        listCollaborationSpaces: listSpacesMock,
        resolveActor: resolveActorMock,
      }),
    ).resolves.toBeNull();
  });

  it("managed: uses tenant-scoped members.json and ignores personal catalog members", async () => {
    securityProfileState.profile = "managed_enterprise";
    const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-gacl-managed-"));
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      // Catalog claims wang-user is a member — must be ignored in managed mode.
      listSpacesMock.mockResolvedValue({ spaces: [spaceWithHuman("active")] });
      const membersPath = path.join(
        tenantsRoot,
        "upbeyond",
        "collaboration",
        "groups",
        "product-test",
        "members.json",
      );
      fs.mkdirSync(path.dirname(membersPath), { recursive: true });
      // Authoritative store: wang-user is removed — catalog must not override.
      fs.writeFileSync(
        membersPath,
        JSON.stringify([
          {
            memberId: "m1",
            memberKind: "human",
            userId: "ceo-user",
            governanceRole: "owner",
            status: "active",
            updatedAtMs: 1,
          },
          {
            memberId: "m2",
            memberKind: "human",
            userId: "wang-user",
            governanceRole: "member",
            status: "removed",
            updatedAtMs: 1,
          },
        ]),
      );
      await expect(
        resolveCollaborationGroupWriteDenial({
          client: personalClient as never,
          rawSessionKey: "space:product-test",
          listCollaborationSpaces: listSpacesMock,
          resolveActor: resolveActorMock,
        }),
      ).resolves.toBe(
        "you may audit your bot's activity in this group but cannot post as a non-member",
      );

      fs.writeFileSync(
        membersPath,
        JSON.stringify([
          {
            memberId: "m2",
            memberKind: "human",
            userId: "wang-user",
            governanceRole: "member",
            status: "active",
            updatedAtMs: 1,
          },
        ]),
      );
      await expect(
        resolveCollaborationGroupWriteDenial({
          client: personalClient as never,
          rawSessionKey: "space:product-test",
          listCollaborationSpaces: listSpacesMock,
          resolveActor: resolveActorMock,
        }),
      ).resolves.toBeNull();
      // Catalog is unused for managed membership.
      expect(listSpacesMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
      fs.rmSync(tenantsRoot, { recursive: true, force: true });
      securityProfileState.profile = "personal_local";
    }
  });

  it("managed: materializes UUID members.json for every list-visible space, mixed owners", async () => {
    securityProfileState.profile = "managed_enterprise";
    const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-gacl-materialize-"));
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    const ownerA = {
      userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      userEmail: "owner-a@example.com",
      tenantId: "upbeyond",
      seatAgentIds: [] as string[],
      seatSpaceIds: [] as string[],
    };
    const ownerB = {
      userId: "11111111-2222-3333-4444-555555555555",
      userEmail: "owner-b@example.com",
      tenantId: "upbeyond",
      seatAgentIds: [] as string[],
      seatSpaceIds: [] as string[],
    };
    const stranger = {
      userId: "00000000-0000-0000-0000-000000000000",
      userEmail: "stranger@example.com",
      tenantId: "upbeyond",
      seatAgentIds: [] as string[],
      seatSpaceIds: [] as string[],
    };
    const spaces = [
      {
        id: "space:grp-alpha",
        groupId: "grp-alpha",
        ownerUserId: ownerA.userId,
        members: {
          humans: [{ userId: ownerA.userId, email: ownerA.userEmail, name: "A", status: "active" }],
          bots: [],
        },
      },
      {
        id: "space:grp-beta",
        groupId: "grp-beta",
        ownerUserId: ownerB.userId,
        members: {
          humans: [
            { userId: ownerB.userId, email: ownerB.userEmail, name: "B", status: "active" },
            { userId: ownerA.userId, email: ownerA.userEmail, name: "A", status: "active" },
          ],
          bots: [],
        },
      },
    ];
    try {
      listSpacesMock.mockResolvedValue({ spaces });

      resolveActorMock.mockResolvedValue(ownerA);
      await expect(
        resolveCollaborationGroupWriteDenial({
          client: personalClient as never,
          rawSessionKey: "space:grp-alpha",
          listCollaborationSpaces: listSpacesMock,
          resolveActor: resolveActorMock,
        }),
      ).resolves.toBeNull();

      const alphaPath = path.join(
        tenantsRoot,
        "upbeyond",
        "collaboration",
        "groups",
        "grp-alpha",
        "members.json",
      );
      const alphaRaw = JSON.parse(fs.readFileSync(alphaPath, "utf8")) as unknown;
      expect(Array.isArray(alphaRaw)).toBe(true);
      expect(alphaRaw).not.toEqual(expect.objectContaining({ members: expect.anything() }));
      expect((alphaRaw as Array<{ userId?: string }>).map((row) => row.userId)).toContain(
        ownerA.userId,
      );
      expect(
        (alphaRaw as Array<{ userId?: string }>).some((row) => row.userId?.includes("@")),
      ).toBe(false);

      await expect(
        resolveCollaborationGroupWriteDenial({
          client: personalClient as never,
          rawSessionKey: "space:grp-beta",
          listCollaborationSpaces: listSpacesMock,
          resolveActor: resolveActorMock,
        }),
      ).resolves.toBeNull();
      const betaPath = path.join(
        tenantsRoot,
        "upbeyond",
        "collaboration",
        "groups",
        "grp-beta",
        "members.json",
      );
      const betaRaw = JSON.parse(fs.readFileSync(betaPath, "utf8")) as unknown;
      expect(Array.isArray(betaRaw)).toBe(true);
      expect((betaRaw as Array<{ userId?: string }>).map((row) => row.userId)).toEqual(
        expect.arrayContaining([ownerA.userId, ownerB.userId]),
      );
      expect((betaRaw as Array<{ userId?: string }>).some((row) => row.userId?.includes("@"))).toBe(
        false,
      );

      const wrapperPath = path.join(
        tenantsRoot,
        "upbeyond",
        "collaboration",
        "groups",
        "grp-alpha",
        "members.json",
      );
      fs.writeFileSync(
        wrapperPath,
        JSON.stringify({ members: [{ userId: ownerA.userEmail, status: "active" }] }),
      );
      await expect(
        resolveCollaborationGroupWriteDenial({
          client: personalClient as never,
          rawSessionKey: "space:grp-alpha",
          listCollaborationSpaces: listSpacesMock,
          resolveActor: resolveActorMock,
        }),
      ).resolves.toBeNull();
      const unreaped = JSON.parse(fs.readFileSync(wrapperPath, "utf8")) as unknown;
      expect(Array.isArray(unreaped)).toBe(true);
      expect((unreaped as Array<{ userId?: string }>)[0]?.userId).toBe(ownerA.userId);

      fs.writeFileSync(
        wrapperPath,
        JSON.stringify([
          {
            memberId: "m-email",
            memberKind: "human",
            userId: ownerA.userEmail,
            governanceRole: "owner",
            status: "active",
            updatedAtMs: 1,
          },
        ]),
      );
      await expect(
        resolveCollaborationGroupWriteDenial({
          client: personalClient as never,
          rawSessionKey: "space:grp-alpha",
          listCollaborationSpaces: listSpacesMock,
          resolveActor: resolveActorMock,
        }),
      ).resolves.toBeNull();
      const converted = JSON.parse(fs.readFileSync(wrapperPath, "utf8")) as Array<{
        userId?: string;
      }>;
      expect(converted.map((row) => row.userId)).toContain(ownerA.userId);
      expect(converted.some((row) => row.userId?.includes("@"))).toBe(false);

      resolveActorMock.mockResolvedValue(stranger);
      const beforeStranger = fs.readFileSync(betaPath, "utf8");
      await expect(
        resolveCollaborationGroupWriteDenial({
          client: personalClient as never,
          rawSessionKey: "space:grp-beta",
          listCollaborationSpaces: listSpacesMock,
          resolveActor: resolveActorMock,
        }),
      ).resolves.toBe(
        "you may audit your bot's activity in this group but cannot post as a non-member",
      );
      expect(fs.readFileSync(betaPath, "utf8")).toBe(beforeStranger);

      fs.rmSync(path.dirname(alphaPath), { recursive: true, force: true });
      await expect(
        resolveCollaborationGroupWriteDenial({
          client: personalClient as never,
          rawSessionKey: "space:grp-alpha",
          listCollaborationSpaces: listSpacesMock,
          resolveActor: resolveActorMock,
        }),
      ).resolves.toBe("unknown collaboration space");
      expect(fs.existsSync(alphaPath)).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
      fs.rmSync(tenantsRoot, { recursive: true, force: true });
      securityProfileState.profile = "personal_local";
    }
  });
});

describe("chat.send unknown collaboration space fail-closed", () => {
  beforeEach(() => {
    securityProfileState.profile = "personal_local";
    listSpacesMock.mockReset();
    resolveActorMock.mockReset();
    buildVisibilityMock.mockReset();
    decideParticipantsMock.mockReset();
    createTranscriptFixture();

    resolveActorMock.mockResolvedValue({
      ...memberActor,
      // Stale seat grant so session ACL can pass while the catalog has no space.
      seatSpaceIds: ["ghost-group"],
    });
    buildVisibilityMock.mockResolvedValue({
      actor: {
        ...memberActor,
        seatSpaceIds: ["ghost-group"],
      },
      visibleAgentIds: new Set(["main"]),
      visibleSpaceIds: new Set(["ghost-group"]),
      auditableGroupBotSessions: new Set(),
      archivedGroupIds: new Set(),
    });
    listSpacesMock.mockResolvedValue({ spaces: [] });
  });

  it("rejects personal-workbench chat.send to an unknown space:{groupId}", async () => {
    const respond = vi.fn();
    const context = createChatContext();
    const transcriptBefore = fs.readFileSync(mockState.transcriptPath, "utf-8");

    await chatHandlers["chat.send"]({
      params: {
        sessionKey: "space:ghost-group",
        message: "hello ghost group",
        idempotencyKey: "idem-unknown-space",
      },
      respond: respond as unknown as Parameters<(typeof chatHandlers)["chat.send"]>[0]["respond"],
      req: {} as never,
      client: personalClient as never,
      isWebchatConnect: () => false,
      context: context as GatewayRequestContext,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: expect.stringContaining("unknown collaboration space"),
      }),
    );
    expect(decideParticipantsMock).not.toHaveBeenCalled();
    expect(context.broadcast).not.toHaveBeenCalled();
    expect(fs.readFileSync(mockState.transcriptPath, "utf-8")).toBe(transcriptBefore);
  });

  it("rejects chat.send when scope re-list throws after write ACL passed", async () => {
    const knownSpace = spaceWithHuman("active");
    let listCallCount = 0;
    listSpacesMock.mockImplementation(async () => {
      listCallCount += 1;
      if (listCallCount === 1) {
        return { spaces: [knownSpace] };
      }
      throw new Error("/var/lib/openbot/spaces permission denied");
    });
    buildVisibilityMock.mockResolvedValue({
      actor: memberActor,
      visibleAgentIds: new Set(["main", "agt-dabai"]),
      visibleSpaceIds: new Set(["product-test"]),
      auditableGroupBotSessions: new Set(),
      archivedGroupIds: new Set(),
    });

    const respond = vi.fn();
    const context = createChatContext();
    const transcriptBefore = fs.readFileSync(mockState.transcriptPath, "utf-8");

    await chatHandlers["chat.send"]({
      params: {
        sessionKey: "space:product-test",
        message: "hello known space",
        idempotencyKey: "idem-scope-relist-throw",
      },
      respond: respond as unknown as Parameters<(typeof chatHandlers)["chat.send"]>[0]["respond"],
      req: {} as never,
      client: personalClient as never,
      isWebchatConnect: () => false,
      context: context as GatewayRequestContext,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: expect.stringContaining("failed to resolve collaboration space permissions"),
      }),
    );
    const clientMessage = String(respond.mock.calls[0]?.[2]?.message ?? "");
    expect(clientMessage).not.toContain("/var/lib/openbot");
    expect(decideParticipantsMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(mockState.transcriptPath, "utf-8")).toBe(transcriptBefore);
    expect(context.logGateway.warn).toHaveBeenCalled();
  });

  it("rejects chat.send when scope re-list succeeds but the named group is gone", async () => {
    const knownSpace = spaceWithHuman("active");
    let listCallCount = 0;
    listSpacesMock.mockImplementation(async () => {
      listCallCount += 1;
      if (listCallCount === 1) {
        return { spaces: [knownSpace] };
      }
      return { spaces: [] };
    });
    buildVisibilityMock.mockResolvedValue({
      actor: memberActor,
      visibleAgentIds: new Set(["main", "agt-dabai"]),
      visibleSpaceIds: new Set(["product-test"]),
      auditableGroupBotSessions: new Set(),
      archivedGroupIds: new Set(),
    });

    const respond = vi.fn();
    const context = createChatContext();
    const transcriptBefore = fs.readFileSync(mockState.transcriptPath, "utf-8");

    await chatHandlers["chat.send"]({
      params: {
        sessionKey: "space:product-test",
        message: "hello vanished space",
        idempotencyKey: "idem-scope-relist-miss",
      },
      respond: respond as unknown as Parameters<(typeof chatHandlers)["chat.send"]>[0]["respond"],
      req: {} as never,
      client: personalClient as never,
      isWebchatConnect: () => false,
      context: context as GatewayRequestContext,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: expect.stringContaining("failed to resolve collaboration space permissions"),
      }),
    );
    expect(decideParticipantsMock).not.toHaveBeenCalled();
    expect(context.broadcast).not.toHaveBeenCalled();
    expect(context.chatAbortControllers.size).toBe(0);
    expect(fs.readFileSync(mockState.transcriptPath, "utf-8")).toBe(transcriptBefore);
    expect(context.logGateway.warn).toHaveBeenCalled();
  });

  it("rejects chat.send when the collaboration space catalog throws", async () => {
    const respond = vi.fn();
    const context = createChatContext();
    const transcriptBefore = fs.readFileSync(mockState.transcriptPath, "utf-8");
    listSpacesMock.mockRejectedValue(new Error("/var/lib/openbot/spaces permission denied"));

    await chatHandlers["chat.send"]({
      params: {
        sessionKey: "space:ghost-group",
        message: "hello during catalog outage",
        idempotencyKey: "idem-catalog-throw",
      },
      respond: respond as unknown as Parameters<(typeof chatHandlers)["chat.send"]>[0]["respond"],
      req: {} as never,
      client: personalClient as never,
      isWebchatConnect: () => false,
      context: context as GatewayRequestContext,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: expect.stringContaining("failed to resolve collaboration space permissions"),
      }),
    );
    const clientMessage = String(respond.mock.calls[0]?.[2]?.message ?? "");
    expect(clientMessage).not.toContain("/var/lib/openbot");
    expect(clientMessage).not.toContain("permission denied");
    expect(decideParticipantsMock).not.toHaveBeenCalled();
    expect(context.broadcast).not.toHaveBeenCalled();
    expect(fs.readFileSync(mockState.transcriptPath, "utf-8")).toBe(transcriptBefore);
    expect(context.logGateway.warn).toHaveBeenCalled();
  });

  it("scheme A: rejects platform chat.send to an unknown space:{groupId}", async () => {
    const respond = vi.fn();
    const context = createChatContext();
    const transcriptBefore = fs.readFileSync(mockState.transcriptPath, "utf-8");
    // Platform clients skip personal session ACL; write ACL must still deny.
    buildVisibilityMock.mockResolvedValue(null);

    await chatHandlers["chat.send"]({
      params: {
        sessionKey: "space:ghost-group",
        message: "platform ghost",
        idempotencyKey: "idem-platform-unknown-space",
      },
      respond: respond as unknown as Parameters<(typeof chatHandlers)["chat.send"]>[0]["respond"],
      req: {} as never,
      client: { sessionDomain: "platform", user: "ops@example.com" } as never,
      isWebchatConnect: () => false,
      context: context as GatewayRequestContext,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: expect.stringContaining("unknown collaboration space"),
      }),
    );
    expect(decideParticipantsMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(mockState.transcriptPath, "utf-8")).toBe(transcriptBefore);
  });

  it("does not affect non-group chat.send sessions", async () => {
    const respond = vi.fn();
    const context = createChatContext();
    buildVisibilityMock.mockResolvedValue({
      actor: memberActor,
      visibleAgentIds: new Set(["main"]),
      visibleSpaceIds: new Set(),
      auditableGroupBotSessions: new Set(),
      archivedGroupIds: new Set(),
    });

    await chatHandlers["chat.send"]({
      params: {
        sessionKey: "agent:main:main",
        message: "hello personal",
        idempotencyKey: "idem-personal-ok",
      },
      respond: respond as unknown as Parameters<(typeof chatHandlers)["chat.send"]>[0]["respond"],
      req: {} as never,
      client: personalClient as never,
      isWebchatConnect: () => false,
      context: context as GatewayRequestContext,
    });

    // Non-group path is not rejected by the unknown-space write ACL.
    const first = respond.mock.calls[0];
    if (first?.[0] === false) {
      expect(String(first?.[2]?.message ?? "")).not.toContain("unknown collaboration space");
    } else {
      expect(first?.[0]).toBe(true);
    }
  });

  it("managed chat.send materializes list-visible missing C5 instead of unknown space", async () => {
    securityProfileState.profile = "managed_enterprise";
    const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-send-c5-"));
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    const owner = {
      userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      userEmail: "owner-a@example.com",
      tenantId: "upbeyond",
      seatAgentIds: ["main"],
      seatSpaceIds: ["grp-alpha"],
    };
    resolveActorMock.mockResolvedValue(owner);
    buildVisibilityMock.mockResolvedValue({
      actor: owner,
      visibleAgentIds: new Set(["main"]),
      visibleSpaceIds: new Set(["grp-alpha"]),
      auditableGroupBotSessions: new Set(),
      archivedGroupIds: new Set(),
    });
    listSpacesMock.mockResolvedValue({
      spaces: [
        {
          id: "space:grp-alpha",
          groupId: "grp-alpha",
          ownerUserId: owner.userId,
          members: {
            humans: [{ userId: owner.userId, email: owner.userEmail, name: "A", status: "active" }],
            bots: [],
          },
        },
      ],
    });
    const respond = vi.fn();
    const context = createChatContext();
    try {
      try {
        await chatHandlers["chat.send"]({
          params: {
            sessionKey: "space:grp-alpha",
            message: "hello listed space",
            idempotencyKey: "idem-listed-c5",
          },
          respond: respond as unknown as Parameters<
            (typeof chatHandlers)["chat.send"]
          >[0]["respond"],
          req: {} as never,
          client: personalClient as never,
          isWebchatConnect: () => false,
          context: context as GatewayRequestContext,
        });
      } catch {
        // Post-ACL dispatch is out of scope for this fixture.
      }
      const first = respond.mock.calls[0];
      if (first?.[0] === false) {
        expect(String(first?.[2]?.message ?? "")).not.toContain("unknown collaboration space");
      }
      const membersPath = path.join(
        tenantsRoot,
        "upbeyond",
        "collaboration",
        "groups",
        "grp-alpha",
        "members.json",
      );
      expect(fs.existsSync(membersPath)).toBe(true);
      const raw = JSON.parse(fs.readFileSync(membersPath, "utf8")) as unknown;
      expect(Array.isArray(raw)).toBe(true);
      expect((raw as Array<{ userId?: string }>)[0]?.userId).toBe(owner.userId);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
      fs.rmSync(tenantsRoot, { recursive: true, force: true });
      securityProfileState.profile = "personal_local";
    }
  });
});

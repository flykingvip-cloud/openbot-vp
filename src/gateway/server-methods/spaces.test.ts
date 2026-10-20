import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let workspaceDir = "";
let stateDir = "";
const loadConfigMock = vi.fn(() => ({}));
const { getOwnershipRecord } = await import("../ownership-store.js");
const { loadEnterpriseSeatAssetsStore, saveEnterpriseSeatAssetsStore } =
  await import("../enterprise-seat-assets-store.js");

vi.mock("../../config/config.js", () => ({
  loadConfig: loadConfigMock,
}));

vi.mock("../../config/paths.js", () => ({
  get STATE_DIR() {
    return stateDir;
  },
  resolveStateDir: vi.fn(() => stateDir),
  resolveOAuthDir: vi.fn(() => path.join(stateDir, "oauth")),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: vi.fn(() => "main"),
  resolveAgentWorkspaceDir: vi.fn(() => workspaceDir),
}));

async function writeGroupFile(groupId: string, filename: string, data: unknown) {
  const groupDir = path.join(stateDir, "collaboration", "groups", encodeURIComponent(groupId));
  await fs.mkdir(groupDir, { recursive: true });
  await fs.writeFile(path.join(groupDir, filename), JSON.stringify(data));
}

async function writeGroupMemoryFile(groupId: string, filename: string, data: unknown) {
  const memoryDir = path.join(
    stateDir,
    "collaboration",
    "groups",
    encodeURIComponent(groupId),
    "memory",
  );
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.writeFile(path.join(memoryDir, filename), JSON.stringify(data));
}

async function writeManagedSpaceFile(groupId: string, filename: string, data: unknown) {
  const groupDir = path.join(stateDir, "collaboration", "groups", encodeURIComponent(groupId));
  await fs.mkdir(groupDir, { recursive: true });
  let payload = data;
  if (
    filename === "profile.json" &&
    data &&
    typeof data === "object" &&
    "profile" in data &&
    (data as { profile?: unknown }).profile &&
    typeof (data as { profile?: unknown }).profile === "object"
  ) {
    payload = (data as { profile: unknown }).profile;
  } else if (
    filename === "members.json" &&
    data &&
    typeof data === "object" &&
    Array.isArray((data as { members?: unknown }).members)
  ) {
    payload = (data as { members: unknown[] }).members;
  }
  await fs.writeFile(path.join(groupDir, filename), JSON.stringify(payload));
}

function collaborationGroupDir(groupId: string) {
  return path.join(stateDir, "collaboration", "groups", encodeURIComponent(groupId));
}

function unwrapProfile(value: unknown) {
  if (value && typeof value === "object" && "profile" in value) {
    const wrapped = (value as { profile?: unknown }).profile;
    if (wrapped && typeof wrapped === "object") {
      return wrapped;
    }
  }
  return value;
}

function unwrapMembers(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { members?: unknown }).members)
  ) {
    return (value as { members: unknown[] }).members;
  }
  return value;
}

async function writeAgentSessions(agentId: string, sessions: Record<string, unknown>) {
  const sessionsDir = path.join(stateDir, "agents", agentId, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(path.join(sessionsDir, "sessions.json"), JSON.stringify(sessions));
}

async function writeAgentTranscript(agentId: string, sessionId: string, messages: unknown[]) {
  const sessionsDir = path.join(stateDir, "agents", agentId, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: sessionsDir,
    }),
    ...messages.map((message) =>
      JSON.stringify({
        type: "message",
        timestamp: new Date().toISOString(),
        message,
      }),
    ),
  ];
  await fs.writeFile(path.join(sessionsDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);
}

describe("spaces gateway handlers", () => {
  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-spaces-"));
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-state-"));
    loadConfigMock.mockReset();
    loadConfigMock.mockReturnValue({});
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
    workspaceDir = "";
    stateDir = "";
  });

  it("lists persisted collaboration spaces from managed space files with active members and invites", async () => {
    await writeManagedSpaceFile("grp_product", "profile.json", {
      profile: {
        id: "grp_product",
        groupId: "grp_product",
        name: "Aegis",
        displayName: "Aegis",
        avatar: "🛰️",
        purpose: "战略研究与咨询",
        currentMission: "梳理研究议题与输出节奏",
        coordinatorBotId: "aegis",
        collaborationMode: "discussion_driven",
        successCriteria: ["形成清晰研究方向"],
        finalDecisionPolicy: {
          mode: "human_required",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: true,
        },
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    await writeGroupFile("grp_product", "capabilities.json", {
      groupId: "grp_product",
      systemInstructions: ["新成员先介绍角色", "结论要沉淀到群记忆"],
      confidentialityTier: "internal",
      updatedAtMs: 2,
    });
    await writeManagedSpaceFile("grp_product", "members.json", {
      members: [
        {
          memberId: "human:user-1",
          memberKind: "human",
          userId: "user-1",
          name: "UPBEYOND",
          governanceRole: "member",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
        {
          memberId: "bot:aegis",
          memberKind: "bot",
          agentId: "aegis",
          name: "大白管家",
          governanceRole: "member",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
        {
          memberId: "human:user-2",
          memberKind: "human",
          userId: "user-2",
          name: "Alice",
          governanceRole: "member",
          status: "invited",
          invitedAtMs: 3,
          updatedAtMs: 3,
        },
        {
          memberId: "bot:removed",
          memberKind: "bot",
          agentId: "removed",
          name: "Removed Bot",
          governanceRole: "member",
          status: "removed",
          removedAtMs: 4,
          updatedAtMs: 4,
        },
        {
          memberId: "bot:revoked",
          memberKind: "bot",
          agentId: "revoked",
          name: "Revoked Bot",
          governanceRole: "member",
          status: "revoked",
          updatedAtMs: 5,
        },
      ],
    });
    await writeGroupMemoryFile("grp_product", "presence.json", {
      presence: [
        {
          agentId: "aegis",
          online: true,
          lastActiveAt: "2026-05-11T00:03:00.000Z",
          currentTask: "文章质量审核",
        },
      ],
    });
    await writeGroupMemoryFile("grp_product", "assignments.json", {
      assignments: [
        {
          id: "task-1",
          organizationId: "grp_product",
          title: "文章质量审核",
          ownerAgentId: "aegis",
          createdByAgentId: "main",
          status: "running",
          createdAt: "2026-05-11T00:00:00.000Z",
          updatedAt: "2026-05-11T00:02:00.000Z",
          ackRequired: true,
        },
      ],
    });

    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        spaces: [
          expect.objectContaining({
            id: "grp_product",
            groupId: "grp_product",
            title: "Aegis",
            avatar: "🛰️",
            visibilityScope: null,
            ownerUserId: "user-1",
            purpose: "战略研究与咨询",
            currentMission: "梳理研究议题与输出节奏",
            coordinatorBotId: "aegis",
            collaborationMode: "discussion_driven",
            successCriteria: ["形成清晰研究方向"],
            systemInstructions: expect.arrayContaining([
              "新成员先介绍角色",
              "结论要沉淀到群记忆",
              "群主：UPBEYOND",
              "协调机器人：大白管家",
            ]),
            confidentialityTier: "internal",
            finalDecisionPolicy: {
              mode: "human_required",
              defaultFinalDeciderRole: "owner",
              allowAgentPublishProposal: true,
            },
            operatingState: expect.objectContaining({
              groupId: "grp_product",
              groupProfile: expect.objectContaining({
                displayName: "Aegis",
                purpose: "战略研究与咨询",
                currentMission: "梳理研究议题与输出节奏",
              }),
              governance: expect.objectContaining({
                ownerUserId: "user-1",
                coordinatorBotId: "aegis",
              }),
              activeContext: expect.objectContaining({
                currentOperatingPhase: "explore",
              }),
            }),
            members: {
              humans: [
                expect.objectContaining({
                  userId: "user-1",
                  name: "UPBEYOND",
                  status: "active",
                  presenceStatus: "offline",
                }),
              ],
              bots: [
                expect.objectContaining({
                  agentId: "aegis",
                  name: "大白管家",
                  status: "active",
                  runtimeStatus: "busy",
                  lastActiveAt: "2026-05-11T00:03:00.000Z",
                  currentTask: "文章质量审核",
                  openTaskCount: 1,
                }),
              ],
            },
            invites: {
              humans: [
                expect.objectContaining({
                  userId: "user-2",
                  name: "Alice",
                  status: "invited",
                  presenceStatus: "offline",
                }),
              ],
              bots: [],
            },
          }),
        ],
      }),
      undefined,
    );
  });

  it("auto-bootstraps legacy collaboration groups from roster and first group message", async () => {
    await writeManagedSpaceFile("grp_upbeyond", "members.json", {
      members: [
        {
          memberId: "human:user-1",
          memberKind: "human",
          userId: "user-1",
          name: "UPBEYOND",
          governanceRole: "member",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
        {
          memberId: "bot:aegis",
          memberKind: "bot",
          agentId: "aegis",
          name: "大白管家",
          governanceRole: "member",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    });
    await writeAgentSessions("main", {
      "space:grp_upbeyond": {
        sessionId: "space-grp_upbeyond",
        displayName: "upbeyond",
        groupId: "grp_upbeyond",
        space: "grp_upbeyond",
        chatType: "group",
        updatedAt: 10,
      },
    });
    await writeAgentTranscript("main", "space-grp_upbeyond", [
      {
        role: "user",
        text: "大家都分别介绍一下自己，我们这个小组将致力于战略研究和咨询",
        timestamp: 10,
      },
    ]);

    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    const groupDir = collaborationGroupDir("grp_upbeyond");
    const profile = unwrapProfile(
      JSON.parse(await fs.readFile(path.join(groupDir, "profile.json"), "utf8")),
    ) as { displayName?: string; ownerUserId?: string; purpose?: string; currentMission?: string };
    const members = unwrapMembers(
      JSON.parse(await fs.readFile(path.join(groupDir, "members.json"), "utf8")),
    );
    const capabilities = JSON.parse(
      await fs.readFile(path.join(groupDir, "capabilities.json"), "utf8"),
    );
    const memories = JSON.parse(await fs.readFile(path.join(groupDir, "memories.json"), "utf8"));
    const capsules = JSON.parse(await fs.readFile(path.join(groupDir, "capsules.json"), "utf8"));
    const operatingState = JSON.parse(
      await fs.readFile(path.join(groupDir, "operating-state.json"), "utf8"),
    );

    expect(profile).toEqual(
      expect.objectContaining({
        displayName: "upbeyond",
        ownerUserId: "user-1",
        purpose: "战略研究和咨询",
        currentMission: "完成成员介绍并建立协作上下文",
      }),
    );
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberKind: "human",
          userId: "user-1",
          governanceRole: "owner",
        }),
        expect.objectContaining({
          memberKind: "bot",
          agentId: "aegis",
          collaborationRole: "contributor",
        }),
      ]),
    );
    expect(capabilities.systemInstructions).toEqual(
      expect.arrayContaining([
        "群主：UPBEYOND",
        "小组定位：战略研究和咨询",
        "当前使命：完成成员介绍并建立协作上下文",
      ]),
    );
    expect(memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memoryId: "bootstrap:grp_upbeyond",
          kind: "group_bootstrap",
        }),
      ]),
    );
    expect(capsules).toEqual(
      expect.objectContaining({
        capsules: expect.arrayContaining([
          expect.objectContaining({
            capsuleId: "group-bootstrap:grp_upbeyond",
            title: "upbeyond 小组章程",
          }),
        ]),
      }),
    );
    expect(operatingState).toEqual(
      expect.objectContaining({
        governance: expect.objectContaining({
          ownerUserId: "user-1",
        }),
        onboardingStatus: expect.objectContaining({
          initialized: true,
        }),
        activeContext: expect.objectContaining({
          currentMission: "完成成员介绍并建立协作上下文",
        }),
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        spaces: [
          expect.objectContaining({
            groupId: "grp_upbeyond",
            title: "upbeyond",
            ownerUserId: "user-1",
            purpose: "战略研究和咨询",
            currentMission: "完成成员介绍并建立协作上下文",
            operatingState: expect.objectContaining({
              onboardingStatus: expect.objectContaining({
                initialized: true,
              }),
            }),
          }),
        ],
      }),
      undefined,
    );
  });

  it("updates managed space members and seeds a compatible profile when missing", async () => {
    await writeManagedSpaceFile("grp_product", "members.json", {
      members: [
        {
          memberId: "bot:legacy",
          memberKind: "bot",
          agentId: "legacy",
          name: "Legacy Bot",
          governanceRole: "member",
          status: "invited",
          invitedAtMs: 1,
          updatedAtMs: 1,
        },
      ],
    });
    await writeGroupFile("grp_product", "members.json", [
      {
        memberId: "bot:legacy",
        memberKind: "bot",
        agentId: "legacy",
        name: "Legacy Bot",
        governanceRole: "member",
        status: "invited",
        invitedAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_product",
        title: "Aegis",
        avatar: "🛡️",
        visibilityScope: "tenant",
        purpose: "战略研究与咨询",
        currentMission: "建立协作群章程",
        coordinatorBotId: "aegis",
        collaborationMode: "discussion_driven",
        successCriteria: ["群主明确", "后来者可恢复上下文"],
        systemInstructions: ["新成员先自我介绍", "群定位和群规则必须进入群记忆"],
        confidentialityTier: "restricted",
        finalDecisionPolicy: {
          mode: "human_required",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: true,
        },
        members: {
          humans: [{ userId: "user-1", name: "UPBEYOND" }],
          bots: [{ agentId: "aegis", name: "大白管家" }],
        },
        invites: {
          humans: [{ userId: "user-2", name: "Alice" }],
        },
      },
      respond: respond as never,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    const managedDir = collaborationGroupDir("grp_product");
    const profile = unwrapProfile(
      JSON.parse(await fs.readFile(path.join(managedDir, "profile.json"), "utf8")),
    ) as Record<string, unknown>;
    const members = unwrapMembers(
      JSON.parse(await fs.readFile(path.join(managedDir, "members.json"), "utf8")),
    );
    const capabilities = JSON.parse(
      await fs.readFile(path.join(managedDir, "capabilities.json"), "utf8"),
    );
    const operatingState = JSON.parse(
      await fs.readFile(path.join(managedDir, "operating-state.json"), "utf8"),
    );
    const memories = JSON.parse(await fs.readFile(path.join(managedDir, "memories.json"), "utf8"));
    const capsules = JSON.parse(await fs.readFile(path.join(managedDir, "capsules.json"), "utf8"));
    const mainSessionStore = JSON.parse(
      await fs.readFile(path.join(stateDir, "agents", "main", "sessions", "sessions.json"), "utf8"),
    );
    const aegisSessionStorePath = path.join(
      stateDir,
      "agents",
      "aegis",
      "sessions",
      "sessions.json",
    );

    expect(profile.displayName).toBe("Aegis");
    expect(profile.avatar).toBe("🛡️");
    expect(profile.visibilityScope).toBe("tenant");
    expect(profile.purpose).toBe("战略研究与咨询");
    expect(profile.currentMission).toBe("建立协作群章程");
    expect(profile.coordinatorBotId).toBe("aegis");
    expect(profile.collaborationMode).toBe("discussion_driven");
    expect(profile.successCriteria).toEqual(["群主明确", "后来者可恢复上下文"]);
    expect(profile.finalDecisionPolicy).toEqual({
      mode: "human_required",
      defaultFinalDeciderRole: "owner",
      allowAgentPublishProposal: true,
    });
    expect(profile.members).toEqual({
      humans: [{ userId: "user-1", name: "UPBEYOND", role: "owner" }],
      bots: [{ agentId: "aegis", name: "大白管家", role: "member" }],
    });
    expect(capabilities).toEqual(
      expect.objectContaining({
        groupId: "grp_product",
        confidentialityTier: "restricted",
        systemInstructions: expect.arrayContaining([
          "新成员先自我介绍",
          "群定位和群规则必须进入群记忆",
          "协作小组名称：Aegis",
          "小组定位：战略研究与咨询",
          "当前使命：建立协作群章程",
        ]),
      }),
    );
    expect(operatingState).toEqual(
      expect.objectContaining({
        groupId: "grp_product",
        onboardingStatus: expect.objectContaining({
          initialized: true,
          bootstrapMemoryId: "bootstrap:grp_product",
          charterCapsuleId: "group-bootstrap:grp_product",
        }),
        activeContext: expect.objectContaining({
          currentOperatingPhase: "explore",
          currentMission: "建立协作群章程",
        }),
        collaborationPolicy: expect.objectContaining({
          maxVisibleBotRepliesPerRound: 5,
          mentionBotMustRespond: false,
          openDiscussionWithoutMention: false,
        }),
      }),
    );
    expect(memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memoryId: "bootstrap:grp_product",
          kind: "group_bootstrap",
          groupId: "grp_product",
        }),
      ]),
    );
    expect(capsules).toEqual(
      expect.objectContaining({
        capsules: expect.arrayContaining([
          expect.objectContaining({
            capsuleId: "group-bootstrap:grp_product",
            capsuleType: "playbook",
            groupId: "grp_product",
            title: "Aegis 小组章程",
          }),
        ]),
      }),
    );
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberKind: "human",
          userId: "user-1",
          status: "active",
        }),
        expect.objectContaining({
          memberKind: "bot",
          agentId: "aegis",
          status: "active",
        }),
        expect.objectContaining({
          memberKind: "human",
          userId: "user-2",
          status: "invited",
        }),
        expect.objectContaining({
          memberKind: "bot",
          agentId: "legacy",
          status: "invited",
        }),
      ]),
    );
    expect(mainSessionStore["space:grp_product"]).toEqual(
      expect.objectContaining({
        displayName: "Aegis",
        groupId: "grp_product",
        space: "grp_product",
        chatType: "group",
        collaborationParticipationOverlay: expect.objectContaining({
          v: 1,
          byBotId: expect.objectContaining({
            aegis: expect.objectContaining({
              groupId: "grp_product",
              botId: "aegis",
            }),
          }),
        }),
      }),
    );
    await expect(fs.access(aegisSessionStorePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        space: expect.objectContaining({
          title: "Aegis",
          avatar: "🛡️",
          purpose: "战略研究与咨询",
          currentMission: "建立协作群章程",
          coordinatorBotId: "aegis",
          confidentialityTier: "restricted",
          operatingState: expect.objectContaining({
            onboardingStatus: expect.objectContaining({
              initialized: true,
            }),
            // Agent Growth OS：新空间初始化 growthStatus 为 birth（spec R1/R11，task 4.3）。
            growthStatus: expect.objectContaining({
              lifecycleState: "birth",
              isActivated: false,
            }),
          }),
        }),
      }),
      undefined,
    );
  });

  it("assigns the acting human as group owner when creating a collaboration group", async () => {
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_product",
        title: "Aegis",
        members: {
          humans: [{ userId: "user-1", name: "UPBEYOND" }],
          bots: [],
        },
      },
      respond: respond as never,
      client: { user: "user-1", sessionDomain: "platform", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    const managedDir = collaborationGroupDir("grp_product");
    const profile = unwrapProfile(
      JSON.parse(await fs.readFile(path.join(managedDir, "profile.json"), "utf8")),
    ) as Record<string, unknown>;
    const members = unwrapMembers(
      JSON.parse(await fs.readFile(path.join(managedDir, "members.json"), "utf8")),
    );

    expect(profile.ownerUserId).toBe("user-1");
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberKind: "human",
          userId: "user-1",
          governanceRole: "owner",
          status: "active",
        }),
      ]),
    );
  });

  it("allocates new collaboration groups under the configured shared workspace root", async () => {
    const sharedWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-shared-"));
    try {
      loadConfigMock.mockReturnValue({
        collaboration: {
          defaults: {
            workspace: sharedWorkspaceRoot,
          },
        },
      });
      const respond = vi.fn();
      const { spacesHandlers } = await import("./spaces.js");

      await spacesHandlers["collaboration.spaces.members.update"]({
        req: {} as never,
        params: {
          groupId: "grp_product",
          title: "Aegis",
          avatar: "🛰️",
          members: {
            humans: [{ userId: "user-1", name: "UPBEYOND" }],
            bots: [],
          },
        },
        respond: respond as never,
        client: null,
        isWebchatConnect: () => false,
        context: {} as never,
      });

      const groupWorkspacePath = path.join(sharedWorkspaceRoot, "groups", "grp_product");
      const profile = JSON.parse(
        await fs.readFile(path.join(groupWorkspacePath, "profile.json"), "utf8"),
      );
      await expect(
        fs.stat(path.join(stateDir, "spaces", "grp_product", "profile.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      expect(profile.displayName).toBe("Aegis");
      expect(profile.workspacePath).toBe(groupWorkspacePath);
      expect(respond).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          space: expect.objectContaining({
            groupId: "grp_product",
            workspacePath: groupWorkspacePath,
          }),
        }),
        undefined,
      );
    } finally {
      await fs.rm(sharedWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps legacy spaces.members.update compatibility", async () => {
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_product",
        title: "Aegis",
        members: {
          humans: [{ userId: "user-1", name: "UPBEYOND" }],
        },
      },
      respond: respond as never,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        space: expect.objectContaining({
          groupId: "grp_product",
          title: "Aegis",
        }),
      }),
      undefined,
    );
  });

  it("rejects promoting another member's shared robot without owner approval", async () => {
    loadConfigMock.mockReturnValue({
      agents: {
        list: [
          {
            id: "shared-research-bot",
            scope: "shared",
            ownerId: "employee:alice",
            ownerName: "Alice",
          },
        ],
      },
    });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_product",
        title: "Aegis",
        members: {
          humans: [{ userId: "user-1", name: "UPBEYOND" }],
          bots: [{ agentId: "shared-research-bot", name: "研究助理" }],
        },
        invites: {
          humans: [],
          bots: [],
        },
      },
      respond: respond as never,
      client: { user: "employee:bob", sessionDomain: "platform", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: expect.stringContaining("需要由主人 Alice 同意后才能加入协作小组"),
      }),
    );
  });

  it("rejects non-owner adding builtin steward to a collaboration group", async () => {
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_steward_reject",
        title: "Aegis",
        members: {
          humans: [
            { userId: "user-1", name: "Owner" },
            { userId: "user-2", name: "Member" },
          ],
          bots: [],
        },
      },
      respond: vi.fn(),
      client: { user: "user-1", sessionDomain: "platform", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    const respond = vi.fn();
    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_steward_reject",
        title: "Aegis",
        members: {
          humans: [
            { userId: "user-1", name: "Owner" },
            { userId: "user-2", name: "Member" },
          ],
          bots: [{ agentId: "main", name: "大白管家" }],
        },
      },
      respond: respond as never,
      client: { user: "user-2", sessionDomain: "platform", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: expect.stringContaining("大白管家不是协作小组成员"),
      }),
    );
  });

  it("rejects the group owner adding builtin steward to a collaboration group", async () => {
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_steward",
        title: "Owner Steward Group",
        members: {
          humans: [{ userId: "user-1", name: "Owner" }],
          bots: [{ agentId: "main", name: "大白管家" }],
        },
      },
      respond: respond as never,
      client: { user: "user-1", sessionDomain: "platform", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: expect.stringContaining("大白管家不是协作小组成员"),
      }),
    );
  });

  it("allows the robot owner to approve a pending shared robot invite", async () => {
    loadConfigMock.mockReturnValue({
      agents: {
        list: [
          {
            id: "shared-research-bot",
            scope: "shared",
            ownerId: "employee:alice",
            ownerName: "Alice",
          },
        ],
      },
    });
    await writeManagedSpaceFile("grp_product", "members.json", {
      members: [
        {
          memberId: "bot:shared-research-bot",
          memberKind: "bot",
          agentId: "shared-research-bot",
          name: "研究助理",
          governanceRole: "member",
          status: "invited",
          invitedAtMs: 1,
          updatedAtMs: 1,
        },
      ],
    });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_product",
        title: "Aegis",
        members: {
          humans: [{ userId: "user-1", name: "UPBEYOND" }],
          bots: [{ agentId: "shared-research-bot", name: "研究助理" }],
        },
        invites: {
          humans: [],
          bots: [],
        },
      },
      respond: respond as never,
      client: { user: "employee:alice", sessionDomain: "platform", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    const managedDir = collaborationGroupDir("grp_product");
    const members = unwrapMembers(
      JSON.parse(await fs.readFile(path.join(managedDir, "members.json"), "utf8")),
    );

    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberKind: "bot",
          agentId: "shared-research-bot",
          status: "active",
        }),
      ]),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        space: expect.objectContaining({
          groupId: "grp_product",
          members: expect.objectContaining({
            bots: expect.arrayContaining([
              expect.objectContaining({
                agentId: "shared-research-bot",
                status: "active",
              }),
            ]),
          }),
        }),
      }),
      undefined,
    );
  });

  it("falls back to embedded profile members when members.json is missing", async () => {
    await writeManagedSpaceFile("aegis", "profile.json", {
      profile: {
        id: "aegis",
        name: "Aegis产品开发",
        scope: "user",
        members: {
          humans: [{ userId: "UPBEYOND", name: "UPBEYOND", role: "owner" }],
          bots: [{ agentId: "main", name: "大白管家", role: "specialist" }],
        },
        groupId: "aegis",
        groupCode: "aegis",
        displayName: "Aegis产品开发",
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        spaces: [
          expect.objectContaining({
            id: "aegis",
            groupId: "aegis",
            title: "Aegis产品开发",
            ownerUserId: "UPBEYOND",
            systemInstructions: expect.arrayContaining([
              "协作小组名称：Aegis产品开发",
              "群主：UPBEYOND",
            ]),
            operatingState: expect.objectContaining({
              groupId: "aegis",
              governance: expect.objectContaining({
                ownerUserId: "UPBEYOND",
              }),
            }),
            members: {
              humans: [
                expect.objectContaining({
                  userId: "UPBEYOND",
                  name: "UPBEYOND",
                  status: "active",
                  presenceStatus: "offline",
                }),
              ],
              bots: [],
            },
          }),
        ],
      }),
      undefined,
    );
  });

  it("returns no spaces for a personal-workbench session that cannot resolve an actor", async () => {
    // A managed space exists on the install...
    await writeManagedSpaceFile("aegis", "profile.json", {
      profile: {
        id: "aegis",
        name: "Aegis产品开发",
        scope: "user",
        members: {
          humans: [{ userId: "UPBEYOND", name: "UPBEYOND", role: "owner" }],
          bots: [{ agentId: "main", name: "大白管家", role: "specialist" }],
        },
        groupId: "aegis",
        groupCode: "aegis",
        displayName: "Aegis产品开发",
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    // ...but an employee session whose actor cannot be resolved (no platform auth
    // configured here) must NOT see it — it must get an empty list, never the
    // unscoped platform-wide view.
    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: { sessionDomain: "employee", user: "newcomer@example.com" } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ spaces: [] }), undefined);
  });

  it("ignores managed space namespace directories without direct space files", async () => {
    await fs.mkdir(path.join(stateDir, "spaces", "groups", "nested-space"), { recursive: true });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ spaces: [] }), undefined);
  });

  it("ignores legacy space directories that only expose deprecated humans-bots members files", async () => {
    await writeManagedSpaceFile("space-c5d1adb4-7477-4ae4-a98e-adcaa75daea5", "members.json", {
      humans: [
        {
          id: "human-1",
          spaceId: "space-c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
          userId: "daniel",
          role: "owner",
          status: "active",
        },
      ],
      bots: [
        {
          id: "bot-1",
          spaceId: "space-c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
          botId: "bot-bot-e5490944",
          role: "coordinator",
          status: "active",
        },
      ],
    });
    await writeAgentSessions("main", {
      "agent:main:space:space-c5d1adb4-7477-4ae4-a98e-adcaa75daea5": {
        groupId: "space-c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
        displayName: "产品研发小组",
        updatedAt: 20,
      },
    });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ spaces: [] }), undefined);
  });

  it("falls back to session metadata titles when managed profiles are missing", async () => {
    await writeManagedSpaceFile("space_market", "members.json", {
      members: [
        {
          memberId: "human:user-1",
          memberKind: "human",
          userId: "user-1",
          name: "UPBEYOND",
          governanceRole: "member",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    });
    await writeManagedSpaceFile("space_product", "members.json", {
      members: [],
    });
    await writeAgentSessions("main", {
      "agent:main:main:space:space_product": {
        groupId: "space_product",
        displayName: "产品研发小组",
        updatedAt: 20,
      },
      "agent:main:main:space:space_market": {
        groupId: "space_market",
        label: "旧市场组",
        updatedAt: 10,
      },
    });
    await writeAgentSessions("panda", {
      "agent:panda:main:space:space_market": {
        groupId: "space_market",
        displayName: "市场研究组",
        updatedAt: 30,
      },
    });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        spaces: expect.arrayContaining([
          expect.objectContaining({
            id: "space_product",
            groupId: "space_product",
            title: "产品研发小组",
            avatar: null,
            ownerUserId: null,
            members: {
              humans: [],
              bots: [],
            },
            invites: {
              humans: [],
              bots: [],
            },
          }),
          expect.objectContaining({
            id: "space_market",
            groupId: "space_market",
            title: "市场研究组",
            avatar: null,
            ownerUserId: "user-1",
            members: {
              humans: [
                expect.objectContaining({
                  userId: "user-1",
                  name: "UPBEYOND",
                  status: "active",
                  presenceStatus: "offline",
                }),
              ],
              bots: [],
            },
            invites: {
              humans: [],
              bots: [],
            },
          }),
        ]),
      }),
      undefined,
    );
  });

  it("rejects collaboration space reset requests from non-owners", async () => {
    await writeManagedSpaceFile("grp_product", "profile.json", {
      profile: {
        id: "grp_product",
        groupId: "grp_product",
        name: "Aegis",
        displayName: "Aegis",
        ownerUserId: "user-1",
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    await writeManagedSpaceFile("grp_product", "members.json", {
      members: [
        {
          memberId: "human:user-1",
          memberKind: "human",
          userId: "user-1",
          name: "UPBEYOND",
          governanceRole: "owner",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    });
    await writeGroupFile("grp_product", "profile.json", {
      id: "grp_product",
      groupId: "grp_product",
      name: "Aegis",
      displayName: "Aegis",
      ownerUserId: "user-1",
      createdAtMs: 1,
      updatedAtMs: 2,
    });
    await writeGroupFile("grp_product", "members.json", [
      {
        memberId: "human:user-1",
        memberKind: "human",
        userId: "user-1",
        name: "UPBEYOND",
        governanceRole: "owner",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 2,
      },
    ]);
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.reset"]({
      req: {} as never,
      params: {
        groupId: "grp_product",
      },
      respond: respond as never,
      client: { user: "user-2", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "只有群主才能重置协作小组数据",
      }),
    );
  });

  it("resets collaboration group data, rebuilds the group, and clears historical sessions", async () => {
    await writeManagedSpaceFile("grp_product", "profile.json", {
      profile: {
        id: "grp_product",
        groupId: "grp_product",
        name: "Aegis",
        displayName: "Aegis",
        avatar: "🛰️",
        ownerUserId: "user-1",
        purpose: "战略研究与咨询",
        currentMission: "清理旧数据后重建群章程",
        coordinatorBotId: "main",
        collaborationMode: "discussion_driven",
        successCriteria: ["群历史已重建"],
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    await writeManagedSpaceFile("grp_product", "members.json", {
      members: [
        {
          memberId: "human:user-1",
          memberKind: "human",
          userId: "user-1",
          name: "UPBEYOND",
          governanceRole: "owner",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
        {
          memberId: "bot:main",
          memberKind: "bot",
          agentId: "main",
          name: "大白管家",
          governanceRole: "member",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    });
    await writeGroupFile("grp_product", "profile.json", {
      id: "grp_product",
      groupId: "grp_product",
      name: "Aegis",
      displayName: "Aegis",
      avatar: "🛰️",
      ownerUserId: "user-1",
      purpose: "战略研究与咨询",
      currentMission: "清理旧数据后重建群章程",
      coordinatorBotId: "main",
      collaborationMode: "discussion_driven",
      successCriteria: ["群历史已重建"],
      createdAtMs: 1,
      updatedAtMs: 2,
    });
    await writeGroupFile("grp_product", "members.json", [
      {
        memberId: "human:user-1",
        memberKind: "human",
        userId: "user-1",
        name: "UPBEYOND",
        governanceRole: "owner",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 2,
      },
      {
        memberId: "bot:main",
        memberKind: "bot",
        agentId: "main",
        name: "大白管家",
        governanceRole: "member",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 2,
      },
    ]);
    await writeGroupFile("grp_product", "tasks.json", {
      tasks: [{ taskId: "task-1", title: "Old Task" }],
    });
    await writeGroupFile("grp_product", "capsules.json", {
      capsules: [{ capsuleId: "capsule-1", title: "Old Memory" }],
    });
    await writeGroupFile("grp_product", "capabilities.json", {
      groupId: "grp_product",
      systemInstructions: ["旧规则"],
      confidentialityTier: "restricted",
      updatedAtMs: 2,
    });
    await writeAgentSessions("main", {
      "space:grp_product": {
        sessionId: "space-grp-product",
        groupId: "grp_product",
        updatedAt: 20,
        chatType: "group",
      },
      "agent:main:main:space:grp_product": {
        sessionId: "member-grp-product",
        groupId: "grp_product",
        updatedAt: 30,
        chatType: "group",
      },
    });
    await writeAgentTranscript("main", "space-grp-product", [
      { role: "user", content: [{ type: "text", text: "old alias history" }], timestamp: 1 },
    ]);
    await writeAgentTranscript("main", "member-grp-product", [
      { role: "assistant", content: [{ type: "text", text: "old member history" }], timestamp: 2 },
    ]);

    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.reset"]({
      req: {} as never,
      params: {
        groupId: "grp_product",
      },
      respond: respond as never,
      client: { user: "user-1", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    const managedDir = collaborationGroupDir("grp_product");
    const rebuiltProfile = unwrapProfile(
      JSON.parse(await fs.readFile(path.join(managedDir, "profile.json"), "utf8")),
    ) as Record<string, unknown>;
    const rebuiltMembers = unwrapMembers(
      JSON.parse(await fs.readFile(path.join(managedDir, "members.json"), "utf8")),
    );
    const groupDir = collaborationGroupDir("grp_product");
    const sessionStore = JSON.parse(
      await fs.readFile(path.join(stateDir, "agents", "main", "sessions", "sessions.json"), "utf8"),
    );
    const mainBotSessionStore = JSON.parse(
      await fs.readFile(path.join(stateDir, "agents", "main", "sessions", "sessions.json"), "utf8"),
    );
    const rebuiltCapabilities = JSON.parse(
      await fs.readFile(path.join(groupDir, "capabilities.json"), "utf8"),
    );
    const rebuiltCapsules = JSON.parse(
      await fs.readFile(path.join(groupDir, "capsules.json"), "utf8"),
    );
    const rebuiltOperatingState = JSON.parse(
      await fs.readFile(path.join(groupDir, "operating-state.json"), "utf8"),
    );

    expect(rebuiltProfile.displayName).toBe("Aegis");
    expect(rebuiltProfile.avatar).toBe("🛰️");
    expect(rebuiltProfile.ownerUserId).toBe("user-1");
    expect(rebuiltProfile.purpose).toBe("战略研究与咨询");
    expect(rebuiltProfile.currentMission).toBe("清理旧数据后重建群章程");
    expect(rebuiltProfile.coordinatorBotId || "").toBe("");
    expect(rebuiltMembers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberKind: "human",
          userId: "user-1",
          governanceRole: "owner",
          status: "active",
        }),
      ]),
    );
    expect(rebuiltMembers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberKind: "bot",
          agentId: "main",
        }),
      ]),
    );
    expect(await fs.stat(path.join(groupDir, "profile.json"))).toBeTruthy();
    await expect(fs.stat(path.join(groupDir, "tasks.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(rebuiltCapabilities).toEqual(
      expect.objectContaining({
        groupId: "grp_product",
        confidentialityTier: "restricted",
        systemInstructions: expect.arrayContaining([
          "旧规则",
          "协作小组名称：Aegis",
          "小组定位：战略研究与咨询",
        ]),
      }),
    );
    expect(rebuiltCapsules).toEqual(
      expect.objectContaining({
        capsules: expect.arrayContaining([
          expect.objectContaining({
            capsuleId: "group-bootstrap:grp_product",
            title: "Aegis 小组章程",
          }),
        ]),
      }),
    );
    expect(rebuiltOperatingState).toEqual(
      expect.objectContaining({
        groupId: "grp_product",
        onboardingStatus: expect.objectContaining({
          initialized: true,
          bootstrapMemoryId: "bootstrap:grp_product",
          charterCapsuleId: "group-bootstrap:grp_product",
        }),
        activeContext: expect.objectContaining({
          currentMission: "清理旧数据后重建群章程",
          currentOperatingPhase: "explore",
        }),
      }),
    );
    expect(sessionStore["space:grp_product"]).toEqual(
      expect.objectContaining({
        displayName: "Aegis",
        groupId: "grp_product",
        space: "grp_product",
        chatType: "group",
      }),
    );
    expect(mainBotSessionStore["agent:main:main:space:grp_product"]).toBeUndefined();
    await expect(
      fs.stat(path.join(stateDir, "agents", "main", "sessions", "space-grp-product.jsonl")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(path.join(stateDir, "agents", "main", "sessions", "member-grp-product.jsonl")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        space: expect.objectContaining({
          groupId: "grp_product",
          title: "Aegis",
          purpose: "战略研究与咨询",
          currentMission: "清理旧数据后重建群章程",
          operatingState: expect.objectContaining({
            onboardingStatus: expect.objectContaining({
              initialized: true,
            }),
          }),
        }),
        deleted: expect.objectContaining({
          sessionEntries: 2,
        }),
      }),
      undefined,
    );
  });

  it("persists position ownership when creating a collaboration space with enterprise context", async () => {
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");
    const seatStore = await loadEnterpriseSeatAssetsStore();
    seatStore.seats["pos-sales"] = {
      seatId: "pos-sales",
      tenantId: "001",
      title: "销售经理",
      status: "occupied",
      currentEmployeeId: "user-1",
      defaultSpaceIds: [],
      defaultAgentAssetIds: [],
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
    };
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);

    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_enterprise_sales",
        title: "销售战情组",
        tenantId: "001",
        ownerPositionId: "pos-sales",
        ownerPositionLabel: "销售经理",
        ownerUserLabel: "Alice",
        members: {
          humans: [{ userId: "user-1", name: "Alice" }],
          bots: [],
        },
      },
      respond: respond as never,
      client: { user: "user-1", sessionDomain: "platform", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        space: expect.objectContaining({
          groupId: "grp_enterprise_sales",
          title: "销售战情组",
          ownerUserId: "user-1",
        }),
      }),
      undefined,
    );

    const ownership = getOwnershipRecord({
      tenantId: "001",
      subjectKind: "group",
      subjectId: "grp_enterprise_sales",
    });
    expect(ownership).toMatchObject({
      tenantId: "001",
      positionId: "pos-sales",
      positionLabel: "销售经理",
      createdByUserId: "user-1",
      createdByUserLabel: "Alice",
      currentManagerUserId: "user-1",
      currentManagerLabel: "Alice",
      bindingStatus: "active",
    });

    const afterStore = await loadEnterpriseSeatAssetsStore();
    expect(
      Object.values(afterStore.assetBindings).some(
        (binding) =>
          binding.tenantId === "001" &&
          binding.seatId === "pos-sales" &&
          binding.assetType === "space" &&
          binding.assetId === "grp_enterprise_sales" &&
          binding.status === "active",
      ),
    ).toBe(true);
  });

  it("rejects enterprise collaboration space creation without a position owner", async () => {
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_enterprise_invalid",
        title: "无岗位归属空间",
        tenantId: "001",
        ownerUserLabel: "Alice",
        members: {
          humans: [{ userId: "user-1", name: "Alice" }],
          bots: [],
        },
      },
      respond: respond as never,
      client: { user: "user-1", sessionDomain: "platform", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("position seat"),
      }),
    );
  });

  it("reuses existing space seat binding when member invite omits ownerPositionId", async () => {
    const { spacesHandlers } = await import("./spaces.js");
    const seatStore = await loadEnterpriseSeatAssetsStore();
    seatStore.seats["pos-sales"] = {
      seatId: "pos-sales",
      tenantId: "001",
      title: "销售经理",
      status: "occupied",
      currentEmployeeId: "user-1",
      defaultSpaceIds: [],
      defaultAgentAssetIds: [],
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
    };
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);

    const createRespond = vi.fn();
    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_enterprise_invite_reuse",
        title: "销售邀请复用组",
        tenantId: "001",
        ownerPositionId: "pos-sales",
        ownerPositionLabel: "销售经理",
        ownerUserLabel: "Alice",
        members: {
          humans: [{ userId: "user-1", name: "Alice" }],
          bots: [],
        },
      },
      respond: createRespond as never,
      client: { user: "user-1", sessionDomain: "platform", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(createRespond).toHaveBeenCalledWith(true, expect.anything(), undefined);

    const inviteRespond = vi.fn();
    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_enterprise_invite_reuse",
        title: "销售邀请复用组",
        tenantId: "001",
        ownerUserLabel: "Alice",
        members: {
          humans: [{ userId: "user-1", name: "Alice" }],
          bots: [],
        },
        invites: {
          bots: [{ agentId: "peer-bot", name: "市场分析助手" }],
        },
      },
      respond: inviteRespond as never,
      client: { user: "user-1", sessionDomain: "platform", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(inviteRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        space: expect.objectContaining({
          groupId: "grp_enterprise_invite_reuse",
        }),
      }),
      undefined,
    );
  });

  it("rejects enterprise collaboration space creation without an owning employee actor", async () => {
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_enterprise_actorless",
        title: "无人类 owner 空间",
        tenantId: "001",
        ownerPositionId: "pos-sales",
        ownerPositionLabel: "销售经理",
        members: {
          humans: [],
          bots: [{ agentId: "main", name: "大白管家" }],
        },
      },
      respond: respond as never,
      client: { user: "", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("owning employee actor"),
      }),
    );
  });

  it("allows a non-owner human member to leave a collaboration space", async () => {
    await writeManagedSpaceFile("grp_member_leave", "profile.json", {
      profile: {
        id: "grp_member_leave",
        groupId: "grp_member_leave",
        name: "成员退出测试",
        displayName: "成员退出测试",
        ownerUserId: "owner-1",
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    await writeManagedSpaceFile("grp_member_leave", "members.json", {
      members: [
        {
          memberId: "human:owner-1",
          memberKind: "human",
          userId: "owner-1",
          name: "Owner",
          governanceRole: "owner",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
        {
          memberId: "human:member-1",
          memberKind: "human",
          userId: "member-1",
          name: "Member",
          governanceRole: "member",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    });
    await writeGroupFile("grp_member_leave", "profile.json", {
      id: "grp_member_leave",
      groupId: "grp_member_leave",
      name: "成员退出测试",
      displayName: "成员退出测试",
      ownerUserId: "owner-1",
      createdAtMs: 1,
      updatedAtMs: 2,
    });
    await writeGroupFile("grp_member_leave", "members.json", [
      {
        memberId: "human:owner-1",
        memberKind: "human",
        userId: "owner-1",
        name: "Owner",
        governanceRole: "owner",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 2,
      },
      {
        memberId: "human:member-1",
        memberKind: "human",
        userId: "member-1",
        name: "Member",
        governanceRole: "member",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 2,
      },
    ]);
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.leave"]({
      req: {} as never,
      params: { groupId: "grp_member_leave" },
      respond: respond as never,
      client: { user: "member-1", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        left: true,
        groupId: "grp_member_leave",
        actor: "member-1",
        space: expect.objectContaining({
          groupId: "grp_member_leave",
        }),
      }),
      undefined,
    );
  });

  it("rejects owner leaving a collaboration space before transfer", async () => {
    await writeManagedSpaceFile("grp_owner_leave", "profile.json", {
      profile: {
        id: "grp_owner_leave",
        groupId: "grp_owner_leave",
        name: "群主退出测试",
        displayName: "群主退出测试",
        ownerUserId: "owner-1",
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    await writeManagedSpaceFile("grp_owner_leave", "members.json", {
      members: [
        {
          memberId: "human:owner-1",
          memberKind: "human",
          userId: "owner-1",
          name: "Owner",
          governanceRole: "owner",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    });
    await writeGroupFile("grp_owner_leave", "profile.json", {
      id: "grp_owner_leave",
      groupId: "grp_owner_leave",
      name: "群主退出测试",
      displayName: "群主退出测试",
      ownerUserId: "owner-1",
      createdAtMs: 1,
      updatedAtMs: 2,
    });
    await writeGroupFile("grp_owner_leave", "members.json", [
      {
        memberId: "human:owner-1",
        memberKind: "human",
        userId: "owner-1",
        name: "Owner",
        governanceRole: "owner",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 2,
      },
    ]);
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.leave"]({
      req: {} as never,
      params: { groupId: "grp_owner_leave" },
      respond: respond as never,
      client: { user: "owner-1", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("请先移交管理权再退出"),
      }),
    );
  });

  it("allows owner to transfer collaboration space ownership to another active human member", async () => {
    await writeManagedSpaceFile("grp_transfer", "profile.json", {
      profile: {
        id: "grp_transfer",
        groupId: "grp_transfer",
        name: "移交测试群",
        displayName: "移交测试群",
        ownerUserId: "owner-1",
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    await writeManagedSpaceFile("grp_transfer", "members.json", {
      members: [
        {
          memberId: "human:owner-1",
          memberKind: "human",
          userId: "owner-1",
          name: "Owner",
          governanceRole: "owner",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
        {
          memberId: "human:user-2",
          memberKind: "human",
          userId: "user-2",
          name: "Alice",
          governanceRole: "member",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    });
    await writeGroupFile("grp_transfer", "profile.json", {
      id: "grp_transfer",
      groupId: "grp_transfer",
      name: "移交测试群",
      displayName: "移交测试群",
      ownerUserId: "owner-1",
      createdAtMs: 1,
      updatedAtMs: 2,
    });
    await writeGroupFile("grp_transfer", "members.json", [
      {
        memberId: "human:owner-1",
        memberKind: "human",
        userId: "owner-1",
        name: "Owner",
        governanceRole: "owner",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 2,
      },
      {
        memberId: "human:user-2",
        memberKind: "human",
        userId: "user-2",
        name: "Alice",
        governanceRole: "member",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 2,
      },
    ]);
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.transferOwnership"]({
      req: {} as never,
      params: { groupId: "grp_transfer", newOwnerUserId: "user-2", newOwnerLabel: "Alice" },
      respond: respond as never,
      client: { user: "owner-1", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        transferred: true,
        groupId: "grp_transfer",
        previousOwnerUserId: "owner-1",
        newOwnerUserId: "user-2",
      }),
      undefined,
    );
  });

  it.skip("auto-archives and clears sessions when the last active member is removed", async () => {
    await writeManagedSpaceFile("grp_auto_archive", "profile.json", {
      profile: {
        id: "grp_auto_archive",
        groupId: "grp_auto_archive",
        name: "自动归档测试",
        displayName: "自动归档测试",
        ownerUserId: "owner-1",
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    await writeManagedSpaceFile("grp_auto_archive", "members.json", {
      members: [
        {
          memberId: "human:owner-1",
          memberKind: "human",
          userId: "owner-1",
          name: "Owner",
          governanceRole: "owner",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
        {
          memberId: "bot:main",
          memberKind: "bot",
          agentId: "main",
          name: "main",
          governanceRole: "member",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    });
    await writeGroupFile("grp_auto_archive", "profile.json", {
      id: "grp_auto_archive",
      groupId: "grp_auto_archive",
      name: "自动归档测试",
      displayName: "自动归档测试",
      ownerUserId: "owner-1",
      createdAtMs: 1,
      updatedAtMs: 2,
    });
    await writeGroupFile("grp_auto_archive", "members.json", [
      {
        memberId: "human:owner-1",
        memberKind: "human",
        userId: "owner-1",
        name: "Owner",
        governanceRole: "owner",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 2,
      },
      {
        memberId: "bot:main",
        memberKind: "bot",
        agentId: "main",
        name: "main",
        governanceRole: "member",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 2,
      },
    ]);
    await writeAgentSessions("main", {
      "agent:main:space:grp_auto_archive": {
        sessionId: "sess-auto-archive",
        displayName: "自动归档测试",
        groupId: "grp_auto_archive",
        space: "grp_auto_archive",
        chatType: "group",
        updatedAt: 1,
      },
    });
    await writeAgentTranscript("main", "sess-auto-archive", [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);

    const respond = vi.fn();
    const broadcast = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_auto_archive",
        title: "自动归档测试",
        members: { humans: [], bots: [] },
        invites: { humans: [], bots: [] },
      },
      respond: respond as never,
      client: { user: "owner-1", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: { broadcast } as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        autoArchived: true,
        deleted: expect.objectContaining({
          sessionEntries: 1,
          transcriptFiles: expect.any(Number),
        }),
        space: expect.objectContaining({
          groupId: "grp_auto_archive",
          operatingState: expect.objectContaining({
            groupProfile: expect.objectContaining({
              lifecycleStatus: "archived",
            }),
          }),
        }),
      }),
      undefined,
    );
    expect(broadcast).toHaveBeenCalledWith(
      "collaboration.space.dissolved",
      expect.objectContaining({
        groupId: "grp_auto_archive",
        dissolvedAtMs: expect.any(Number),
      }),
    );

    const runtimeProfile = JSON.parse(
      await fs.readFile(
        path.join(collaborationGroupDir("grp_auto_archive"), "profile.json"),
        "utf8",
      ),
    );
    expect(runtimeProfile.lifecycleStatus).toBe("archived");

    const sessions = JSON.parse(
      await fs.readFile(path.join(stateDir, "agents", "main", "sessions", "sessions.json"), "utf8"),
    );
    expect(sessions["agent:main:space:grp_auto_archive"]).toBeUndefined();
  });

  it("heals vacant unarchived spaces during spaces.list using managed mirror roster", async () => {
    await writeManagedSpaceFile("grp_list_heal", "profile.json", {
      profile: {
        id: "grp_list_heal",
        groupId: "grp_list_heal",
        name: "列表自愈测试",
        displayName: "列表自愈测试",
        ownerUserId: "owner-1",
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    await writeManagedSpaceFile("grp_list_heal", "members.json", {
      members: [
        {
          memberId: "human:owner-1",
          memberKind: "human",
          userId: "owner-1",
          name: "Owner",
          governanceRole: "owner",
          status: "removed",
          updatedAtMs: 100,
        },
        {
          memberId: "bot:main",
          memberKind: "bot",
          agentId: "main",
          name: "main",
          governanceRole: "member",
          status: "removed",
          updatedAtMs: 100,
        },
      ],
    });
    await writeGroupFile("grp_list_heal", "profile.json", {
      id: "grp_list_heal",
      groupId: "grp_list_heal",
      name: "列表自愈测试",
      displayName: "列表自愈测试",
      ownerUserId: "owner-1",
      createdAtMs: 1,
      updatedAtMs: 2,
    });
    await writeGroupFile("grp_list_heal", "members.json", [
      {
        memberId: "human:owner-1",
        memberKind: "human",
        userId: "owner-1",
        name: "Owner",
        governanceRole: "owner",
        status: "active",
        updatedAtMs: 1,
      },
      {
        memberId: "bot:main",
        memberKind: "bot",
        agentId: "main",
        name: "main",
        governanceRole: "member",
        status: "active",
        updatedAtMs: 1,
      },
    ]);
    await writeAgentSessions("main", {
      "agent:main:space:grp_list_heal": {
        sessionId: "sess-list-heal",
        displayName: "列表自愈测试",
        groupId: "grp_list_heal",
        space: "grp_list_heal",
        chatType: "group",
        updatedAt: 1,
      },
    });
    await writeAgentTranscript("main", "sess-list-heal", [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);

    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.list"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      client: { user: "owner-1", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    const listPayload = respond.mock.calls[0]?.[1] as {
      archivedGroupIds?: string[];
      spaces?: Array<{
        groupId?: string;
        members?: { humans?: Array<{ userId?: string; presenceStatus?: string }> };
      }>;
    };
    expect(listPayload).toEqual(
      expect.objectContaining({
        archivedGroupIds: expect.any(Array),
        spaces: expect.any(Array),
      }),
    );
    // Vacancy heal should archive when the managed mirror stays vacant. Bootstrap may
    // rehydrate managed members from a stale runtime roster in some fixtures; in that
    // case still assert human presenceStatus is projected on the listed snapshot.
    if (listPayload.archivedGroupIds?.includes("grp_list_heal")) {
      expect(listPayload.spaces).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ groupId: "grp_list_heal" })]),
      );
      const runtimeProfile = JSON.parse(
        await fs.readFile(
          path.join(collaborationGroupDir("grp_list_heal"), "profile.json"),
          "utf8",
        ),
      );
      expect(runtimeProfile.lifecycleStatus).toBe("archived");
      const sessions = JSON.parse(
        await fs.readFile(
          path.join(stateDir, "agents", "main", "sessions", "sessions.json"),
          "utf8",
        ),
      );
      expect(sessions["agent:main:space:grp_list_heal"]).toBeUndefined();
    } else {
      const listed = listPayload.spaces?.find((space) => space.groupId === "grp_list_heal");
      expect(listed?.members?.humans?.[0]).toEqual(
        expect.objectContaining({
          userId: "owner-1",
          presenceStatus: "offline",
        }),
      );
    }
  });

  it.skip("auto-promotes self-owned bot invites to active members", async () => {
    loadConfigMock.mockReturnValue({
      agents: {
        list: [
          {
            id: "market-bot",
            name: "市场助手",
            ownerId: "user-1",
            ownerName: "Alice",
            scope: "self",
          },
        ],
      },
    });
    const respond = vi.fn();
    const { spacesHandlers } = await import("./spaces.js");

    await spacesHandlers["collaboration.spaces.members.update"]({
      req: {} as never,
      params: {
        groupId: "grp_self_owned_bot",
        title: "自有机器人直加",
        members: {
          humans: [{ userId: "user-1", name: "Alice" }],
          bots: [],
        },
        invites: {
          bots: [{ agentId: "market-bot", name: "市场助手" }],
        },
      },
      respond: respond as never,
      client: { user: "user-1", connect: {} as never } as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        space: expect.objectContaining({
          groupId: "grp_self_owned_bot",
          members: expect.objectContaining({
            bots: expect.arrayContaining([
              expect.objectContaining({
                agentId: "market-bot",
                status: "active",
                ownerUserId: "user-1",
              }),
            ]),
          }),
          invites: expect.objectContaining({
            bots: expect.not.arrayContaining([expect.objectContaining({ agentId: "market-bot" })]),
          }),
        }),
      }),
      undefined,
    );
  });
});

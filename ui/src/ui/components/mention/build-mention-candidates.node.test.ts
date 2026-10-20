import { describe, expect, it } from "vitest";
import { resolveWorkbenchChatSessionKey } from "../../chat/workbench-visible-messages.ts";
import {
  buildMentionCandidatesForComposer,
  buildMentionCandidatesFromRoster,
  collectComposerPluginMentionEntries,
  resolveComposerMentionScope,
  type ComposerMentionDirectory,
} from "./build-mention-candidates.ts";
import { buildMentionsFromMessage } from "./mention-from-message.ts";

describe("buildMentionCandidatesFromRoster", () => {
  const members = {
    humans: [
      { userId: "alice", name: "Alice", status: "active" },
      { userId: "self-user", name: "Me", status: "active" },
      { userId: "invited-user", name: "Invited", status: "invited" },
      { userId: "removed-user", name: "Removed", status: "removed" },
      { userId: "inactive-user", name: "Inactive", status: "inactive" },
    ],
    bots: [
      { agentId: "bot-1", name: "HelperBot", status: "active", runtimeStatus: "online" as const },
      { agentId: "bot-2", name: "CoordBot", status: "active", runtimeStatus: "busy" as const },
      { agentId: "bot-removed", name: "GoneBot", status: "removed" },
      { agentId: "bot-invited", name: "InviteBot", status: "invited" },
    ],
  };

  it("includes active humans and bots while excluding self and inactive members", () => {
    const candidates = buildMentionCandidatesFromRoster({
      members,
      selfUserId: "self-user",
      coordinatorBotId: "bot-2",
    });
    const names = candidates.map((c) => c.displayName);
    expect(names).toEqual(expect.arrayContaining(["Alice", "HelperBot", "CoordBot"]));
    expect(names).not.toContain("Me");
    expect(names).not.toContain("Invited");
    expect(names).not.toContain("Removed");
    expect(names).not.toContain("Inactive");
    expect(names).not.toContain("GoneBot");
    expect(names).not.toContain("InviteBot");

    expect(candidates.find((c) => c.displayName === "Alice")).toMatchObject({
      kind: "human",
      userId: "alice",
      isBot: false,
    });
    expect(candidates.find((c) => c.displayName === "CoordBot")).toMatchObject({
      kind: "agent",
      agentId: "bot-2",
      roleName: "协调者",
      isBot: true,
    });
  });

  it("keeps active humans when the space has no bots (leftover bots-only builders must not win)", () => {
    const candidates = buildMentionCandidatesFromRoster({
      members: {
        humans: [{ userId: "wang-jun", name: "王军", status: "active" }],
        bots: [],
      },
      selfUserId: "ceo",
    });
    expect(candidates).toEqual([
      expect.objectContaining({
        kind: "human",
        userId: "wang-jun",
        displayName: "王军",
        isBot: false,
      }),
    ]);
  });
});

const tenantDirectory: ComposerMentionDirectory = {
  humans: [
    { user: "13800001111", userId: "13800001111", displayName: "13800001111", status: "active" },
    { user: "13800002222", userId: "13800002222", displayName: "13800002222", status: "active" },
    { user: "ayu@example.com", userId: "user-ayu", displayName: "阿育王", status: "active" },
    { user: "aipu@example.com", userId: "user-aipu", displayName: "艾璞", status: "active" },
    { user: "me@example.com", userId: "user-me", displayName: "我", status: "active" },
  ],
  robots: [
    { agentId: "bot-panda", displayName: "熊猫学习", ownerUserId: "user-me" },
    { agentId: "bot-market", displayName: "市场助手", ownerUserId: "user-ayu" },
    { agentId: "bot-team", displayName: "战队助手", ownerUserId: "user-aipu" },
    { agentId: "main", displayName: "大白管家", ownerUserId: "user-me" },
  ],
  ownedAgentIds: ["bot-panda"],
  actorIdentities: ["user-me", "me@example.com"],
  plugins: collectComposerPluginMentionEntries({
    operationalIdentities: [
      {
        identityId: "id-github",
        provider: "github-personal",
        providerLabel: "GitHub（个人）",
        displayName: "GitHub",
        status: "active",
      },
      {
        identityId: "id-finance",
        provider: "personal-email",
        providerLabel: "个人邮箱",
        displayName: "Finance",
        status: "reauth_required",
      },
    ],
    pluginToolGroups: [
      { id: "plugin:origin", label: "Origin", source: "plugin", pluginId: "origin" },
      { id: "core-tools", label: "Core", source: "core", pluginId: "core" },
    ],
  }),
};

const digitalTeam = {
  id: "grp-digital",
  groupId: "grp-digital",
  title: "数字人战队",
  coordinatorBotId: "bot-team",
  members: {
    humans: [
      { userId: "user-aipu", name: "艾璞", status: "active" },
      { userId: "user-me", name: "我", status: "active" },
    ],
    bots: [
      { agentId: "bot-team", name: "战队助手", status: "active", runtimeStatus: "online" as const },
    ],
  },
};

describe("composer mention scope", () => {
  it("offers only that group's members in a collaboration room", () => {
    expect(resolveComposerMentionScope({ sessionKey: "space:grp-digital" })).toBe("group-members");
    const candidates = buildMentionCandidatesForComposer({
      sessionKey: "space:grp-digital",
      directory: tenantDirectory,
      spaces: [digitalTeam],
      selfUserId: "user-me",
    });
    expect(candidates.map((candidate) => candidate.displayName).toSorted()).toEqual([
      "战队助手",
      "艾璞",
    ]);
    expect(candidates.find((candidate) => candidate.displayName === "艾璞")).toMatchObject({
      kind: "human",
      userId: "user-aipu",
    });
    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("阿育王");
    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("13800001111");
    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("熊猫学习");
    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("GitHub");
    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("Finance");
    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("Origin");
    expect(candidates.map((candidate) => candidate.roleName)).not.toContain("同事");
    expect(candidates.map((candidate) => candidate.kind)).not.toContain("plugin");
  });

  it("offers same-tenant humans + own robots in an ordinary (non-group) bot chat", () => {
    const sessionKey = "agent:bot-panda:main";
    expect(
      resolveComposerMentionScope({
        sessionKey,
        sessionDefaults: { mainSessionKey: "agent:main:employee:user-me" },
      }),
    ).toBe("own-assistants");
    const candidates = buildMentionCandidatesForComposer({
      sessionKey,
      sessionDefaults: { mainSessionKey: "agent:main:employee:user-me" },
      directory: tenantDirectory,
      spaces: [digitalTeam],
      selfUserId: "user-me",
    });
    const names = candidates.map((candidate) => candidate.displayName);
    expect(names).toEqual(
      expect.arrayContaining([
        "13800001111",
        "13800002222",
        "阿育王",
        "艾璞",
        "熊猫学习",
        "GitHub",
        "Finance",
        "Origin",
      ]),
    );
    expect(candidates.find((candidate) => candidate.displayName === "熊猫学习")).toMatchObject({
      kind: "agent",
      agentId: "bot-panda",
      roleName: "我的机器人",
    });
    expect(candidates.find((candidate) => candidate.displayName === "阿育王")?.roleName).toBe(
      "同事",
    );
    expect(candidates.find((candidate) => candidate.displayName === "GitHub")).toMatchObject({
      kind: "plugin",
      roleName: "已连接",
      online: true,
    });
    expect(names).not.toContain("Core");
    for (const blocked of ["市场助手", "战队助手", "大白管家"]) {
      expect(names).not.toContain(blocked);
    }
  });

  it("still offers every enterprise human and own assistants from 大白管家", () => {
    for (const sessionKey of ["agent:main:employee:user-me", "main", "agent:main:main"]) {
      expect(resolveComposerMentionScope({ sessionKey })).toBe("tenant-humans");
    }
    const candidates = buildMentionCandidatesForComposer({
      sessionKey: "agent:main:employee:user-me",
      sessionDefaults: { mainSessionKey: "agent:main:employee:user-me" },
      directory: tenantDirectory,
      spaces: [digitalTeam],
      selfUserId: "user-me",
    });
    const names = candidates.map((candidate) => candidate.displayName);
    expect(names).toEqual(
      expect.arrayContaining([
        "13800001111",
        "13800002222",
        "阿育王",
        "艾璞",
        "熊猫学习",
        "GitHub",
        "Finance",
        "Origin",
      ]),
    );
    expect(candidates.find((candidate) => candidate.displayName === "熊猫学习")).toMatchObject({
      kind: "agent",
      roleName: "我的机器人",
    });
    expect(names).not.toContain("市场助手");
    expect(names).not.toContain("战队助手");
    expect(names).not.toContain("大白管家");
    expect(candidates.find((candidate) => candidate.displayName === "阿育王")?.roleName).toBe(
      "同事",
    );
  });

  it("follows the open header when the stored session key is still another chat", () => {
    const sessionKey = resolveWorkbenchChatSessionKey({
      selectedKey: "agent:bot-panda:main",
      sessionKey: "agent:main:employee:user-me",
    });
    const candidates = buildMentionCandidatesForComposer({
      sessionKey,
      sessionDefaults: { mainSessionKey: "agent:main:employee:user-me" },
      directory: tenantDirectory,
      spaces: [digitalTeam],
      selfUserId: "user-me",
    });
    const names = candidates.map((candidate) => candidate.displayName);
    // Non-group header → tenant humans + own robots (not colleagues' robots).
    expect(names).toEqual(
      expect.arrayContaining(["熊猫学习", "阿育王", "艾璞", "GitHub", "Origin"]),
    );
    expect(names).not.toContain("市场助手");
    expect(names).not.toContain("战队助手");
  });

  it("selected MCP/plugin @ mentions survive extraction as plugin targets", () => {
    const candidates = buildMentionCandidatesForComposer({
      sessionKey: "agent:bot-panda:main",
      sessionDefaults: { mainSessionKey: "agent:main:employee:user-me" },
      directory: tenantDirectory,
      spaces: [digitalTeam],
      selfUserId: "user-me",
    });
    const github = candidates.find((candidate) => candidate.displayName === "GitHub");
    expect(github).toMatchObject({
      kind: "plugin",
      agentId: "plugin:connector:github-personal:id-github",
    });
    const origin = candidates.find((candidate) => candidate.displayName === "Origin");
    expect(origin).toMatchObject({
      kind: "plugin",
      agentId: "plugin:ext:origin",
    });
    const mentions = buildMentionsFromMessage("请用 @GitHub 查 PR", candidates, {
      createMentionId: () => "m-gh",
    });
    expect(mentions).toEqual([
      expect.objectContaining({
        mention_id: "m-gh",
        displayName: "GitHub",
        targetKind: "plugin",
        target: { kind: "plugin", pluginId: "plugin:connector:github-personal:id-github" },
      }),
    ]);
    expect(mentions[0]?.agentId).toBeUndefined();
  });

  it("plugin mention bindings expose connector provider and OpenBot plugin allowlist", async () => {
    const { resolveComposerPluginMentionBindings } =
      await import("../../../../../src/auto-reply/reply/composer-plugin-mention-bindings.js");
    const candidates = buildMentionCandidatesForComposer({
      sessionKey: "agent:bot-panda:main",
      sessionDefaults: { mainSessionKey: "agent:main:employee:user-me" },
      directory: tenantDirectory,
      spaces: [digitalTeam],
      selfUserId: "user-me",
    });
    const mentions = buildMentionsFromMessage("请用 @GitHub 和 @Origin", candidates, {
      createMentionId: (() => {
        let n = 0;
        return () => `m-${++n}`;
      })(),
    });
    const bindings = resolveComposerPluginMentionBindings(mentions);
    expect(bindings.connectors).toEqual([
      expect.objectContaining({
        provider: "github-personal",
        identityId: "id-github",
        displayName: "GitHub",
      }),
    ]);
    expect(bindings.pluginToolAllowlist).toEqual(["origin"]);
    expect(bindings.turnPrompt).toContain("user_operational_identity");
  });

  it("keeps MCP/plugin candidates off collaboration group composers", () => {
    const candidates = buildMentionCandidatesForComposer({
      sessionKey: "agent:bot-team:space:grp-digital",
      directory: tenantDirectory,
      spaces: [digitalTeam],
      selfUserId: "user-me",
    });
    expect(candidates.map((c) => c.displayName).toSorted()).toEqual(["战队助手", "艾璞"]);
    expect(candidates.some((c) => c.kind === "plugin")).toBe(false);
  });
});

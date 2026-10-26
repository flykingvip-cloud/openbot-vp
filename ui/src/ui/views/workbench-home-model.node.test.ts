import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentsListResult, SessionsListResult } from "../types.ts";
import type { WorkbenchTeamObject } from "../workbench-team-object.ts";

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe("buildWorkbenchHomeModelFromState", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("derives sidebar, team, and metric state from live workbench inputs", async () => {
    const { buildWorkbenchHomeModelFromState } =
      await import("../ports/employee/views/workbench-home-model.ts");
    const now = Date.now();
    const agentsList = {
      defaultId: "main",
      mainKey: "main",
      scope: "user",
      agents: [
        { id: "main", name: "Main Assistant", identity: { emoji: "MA", name: "Main Assistant" } },
        { id: "analyst", name: "Data Analyst", identity: { emoji: "DA", name: "Data Analyst" } },
      ],
    } as AgentsListResult;
    const sessionsResult = {
      count: 4,
      sessions: [
        {
          key: "main",
          kind: "global",
          label: "Main Assistant",
          subject: "Main Assistant",
          updatedAt: now - 1_000,
          lastMessagePreview: "Primary thread",
        },
        {
          key: "agent:analyst:main",
          kind: "global",
          label: "Data Analyst",
          subject: "Data Analyst",
          updatedAt: now - 2_000,
          lastMessagePreview: "Analyst thread",
        },
        {
          key: "agent:main:telegram:direct:alice",
          kind: "direct",
          label: "Alice",
          subject: "Alice",
          surface: "telegram",
          updatedAt: now - 3_000,
          lastMessagePreview: "Need follow-up",
        },
        {
          key: "agent:main:telegram:group:product-room",
          kind: "group",
          label: "Product Room",
          subject: "Product Room",
          surface: "telegram",
          room: "product-room",
          updatedAt: now - 4_000,
          lastMessagePreview: "Standup moved",
        },
      ],
    } as SessionsListResult;
    const teamObjects: Record<string, WorkbenchTeamObject> = {
      "agent:analyst:main": {
        key: "agent:analyst:main",
        kind: "assistant",
        alias: "Insight Desk",
        createdAt: now - 100_000,
        updatedAt: now - 50_000,
      },
      "agent:main:telegram:direct:alice": {
        key: "agent:main:telegram:direct:alice",
        kind: "member",
        alias: "Alice PM",
        createdAt: now - 100_000,
        updatedAt: now - 40_000,
      },
    };

    const model = buildWorkbenchHomeModelFromState({
      agentsList,
      sessionsResult,
      sessionSeenAt: {
        main: now,
        "agent:analyst:main": now,
        "agent:main:telegram:direct:alice": now - 100_000,
      },
      activeSessionKey: "main",
      teamObjects,
      teamOrder: ["agent:main:telegram:direct:alice", "agent:analyst:main"],
      channelsSnapshot: {
        ts: now,
        channelOrder: ["telegram"],
        channelLabels: { telegram: "Telegram" },
        channelAccounts: {
          telegram: [{ accountId: "acct-1", connected: true }],
        },
        channelDefaultAccountId: { telegram: "acct-1" },
        channels: {},
      },
      presenceEntries: [{ instanceId: "desktop-1" }],
      connected: true,
      cronNext: now + 60_000,
      lastError: null,
    });

    expect(model.agents).toHaveLength(2);
    expect(model.contacts).toHaveLength(1);
    expect(model.groups).toHaveLength(1);
    expect(model.contacts[0]?.unreadCount).toBe(1);
    expect(model.teamAssistants.find((entry) => entry.key === "agent:analyst:main")).toMatchObject({
      key: "agent:analyst:main",
      title: "Insight Desk",
      saved: true,
    });
    expect(model.teamMembers[0]).toMatchObject({
      key: "agent:main:telegram:direct:alice",
      title: "Alice PM",
      saved: true,
    });
    expect(model.accounts.active).toBe(1);
    expect(model.sessionCount).toBe(4);
    expect(model.savedTeamCount).toBe(0);
    expect(model.metrics.map((entry) => entry.value)).toEqual(["2", "1", "1", "4"]);
    expect(model.signals.cards.map((card) => card.key)).toEqual(["schedule", "todos"]);
    expect(model.signals.cards[0]?.actionId).toBe("openCron");
    expect(model.signals.cards[1]?.actionId).toBe("openTodos");
    expect(model.modules.tasks.followupCount).toBe(1);
    expect(model.modules.tasks.followups[0]).toMatchObject({
      title: "Alice",
      sessionKey: "agent:main:telegram:direct:alice",
    });
    expect(model.modules.favorites.savedCount).toBe(2);
    expect(model.modules.favorites.saved.map((entry) => entry.title)).toEqual([
      "Alice PM",
      "Insight Desk",
    ]);
  });

  it("orders assistant history by recency even when the canonical main session is absent", async () => {
    const { buildWorkbenchHomeModelFromState } =
      await import("../ports/employee/views/workbench-home-model.ts");
    const now = Date.now();

    const model = buildWorkbenchHomeModelFromState({
      agentsList: {
        defaultId: "main",
        mainKey: "main",
        scope: "user",
        agents: [
          { id: "main", name: "Main Assistant", identity: { emoji: "MA", name: "Main Assistant" } },
          { id: "analyst", name: "Data Analyst", identity: { emoji: "DA", name: "Data Analyst" } },
        ],
      } as AgentsListResult,
      sessionsResult: {
        count: 3,
        sessions: [
          {
            key: "agent:analyst:telegram:group:ops-room",
            kind: "group",
            label: "Ops Room",
            subject: "Ops Room",
            surface: "telegram",
            updatedAt: now - 10_000,
            lastMessagePreview: "older thread",
          },
          {
            key: "agent:analyst:telegram:direct:alice",
            kind: "direct",
            label: "Alice",
            subject: "Alice",
            surface: "telegram",
            updatedAt: now - 1_000,
            lastMessagePreview: "latest thread",
          },
          {
            key: "main",
            kind: "global",
            label: "Main Assistant",
            subject: "Main Assistant",
            updatedAt: now - 2_000,
            lastMessagePreview: "main thread",
          },
        ],
      } as SessionsListResult,
      sessionSeenAt: {},
      activeSessionKey: "agent:analyst:telegram:direct:alice",
      teamObjects: {},
      teamOrder: [],
      channelsSnapshot: null,
      presenceEntries: [],
      connected: true,
      cronNext: null,
      lastError: null,
    });

    expect(model.teamAssistants.find((entry) => entry.key === "agent:analyst:main")).toMatchObject({
      key: "agent:analyst:main",
      sessionKeys: ["agent:analyst:telegram:direct:alice", "agent:analyst:telegram:group:ops-room"],
      updatedAt: now - 1_000,
    });
  });

  it("keeps all assistants and excludes cron sessions from assistant history", async () => {
    const { buildWorkbenchHomeModelFromState } =
      await import("../ports/employee/views/workbench-home-model.ts");
    const now = Date.now();

    const model = buildWorkbenchHomeModelFromState({
      agentsList: {
        defaultId: "main",
        mainKey: "main",
        scope: "user",
        agents: [
          { id: "main", name: "Main Assistant" },
          { id: "bot", name: "高级秘书" },
          { id: "bot-2", name: "市场助手" },
          { id: "bot--agent", name: "高密度分析" },
          { id: "bot-skill", name: "Skill孵化" },
          { id: "panda", name: "熊猫学习" },
          { id: "ops", name: "Ops" },
        ],
      } as AgentsListResult,
      sessionsResult: {
        count: 5,
        sessions: [
          {
            key: "main",
            kind: "global",
            label: "Main Assistant",
            updatedAt: now - 1_000,
          },
          {
            key: "agent:bot:cron:job-1",
            kind: "unknown",
            label: "Cron: 每小时日程检查",
            updatedAt: now - 100,
          },
          {
            key: "agent:bot:main:space:space-aegis",
            kind: "group",
            label: "Aegis产品开发",
            groupId: "space-aegis",
            updatedAt: now - 2_000,
          },
          {
            key: "agent:bot-2:cron:job-2",
            kind: "unknown",
            label: "Cron: 每日AI情报汇总",
            updatedAt: now - 200,
          },
          {
            key: "agent:bot-2:main:space:space-market",
            kind: "group",
            label: "市场研究组",
            groupId: "space-market",
            updatedAt: now - 3_000,
          },
        ],
      } as SessionsListResult,
      sessionSeenAt: {},
      activeSessionKey: "main",
      teamObjects: {},
      teamOrder: [],
      channelsSnapshot: null,
      presenceEntries: [],
      connected: true,
      cronNext: null,
      lastError: null,
    });

    expect(model.teamAssistants).toHaveLength(7);
    expect(model.teamAssistants.find((entry) => entry.key === "agent:bot:main")).toMatchObject({
      sessionKeys: ["agent:bot:main:space:space-aegis"],
      updatedAt: now - 2_000,
    });
    expect(model.teamAssistants.find((entry) => entry.key === "agent:bot-2:main")).toMatchObject({
      sessionKeys: ["agent:bot-2:main:space:space-market"],
      updatedAt: now - 3_000,
    });
  });

  it("never surfaces foreign agents that only appear in the session store (no fallback leak)", async () => {
    const { buildWorkbenchHomeModelFromState } =
      await import("../ports/employee/views/workbench-home-model.ts");
    const now = Date.now();

    const model = buildWorkbenchHomeModelFromState({
      agentsList: {
        defaultId: "main",
        mainKey: "main",
        scope: "user",
        agents: [{ id: "main", name: "大白管家" }],
      } as AgentsListResult,
      sessionsResult: {
        count: 2,
        sessions: [
          { key: "main", kind: "global", label: "大白管家", updatedAt: now - 1_000 },
          // A foreign bot owned by another seat that still has a lingering
          // session row. It must NOT appear in this user's assistant sidebar.
          {
            key: "agent:agt-elledecke204-gmail-com-:main",
            kind: "global",
            label: "客户经理",
            updatedAt: now - 500,
          },
        ],
      } as SessionsListResult,
      sessionSeenAt: {},
      activeSessionKey: "main",
      teamObjects: {},
      teamOrder: [],
      channelsSnapshot: null,
      presenceEntries: [],
      connected: true,
      cronNext: null,
      lastError: null,
    });

    expect(model.agents.map((entry) => entry.key)).toEqual(["main"]);
    expect(model.teamAssistants.some((entry) => entry.key.includes("agt-elledecke204"))).toBe(
      false,
    );
  });

  it("drops bare UUID assistant titles and keeps a UUID id that has a human name", async () => {
    const { buildWorkbenchHomeModelFromState } =
      await import("../ports/employee/views/workbench-home-model.ts");
    const uuid = "11f7a389-2e7a-4767-ad35-e617d33f3b93";
    const namedUuid = "907f2920-9414-4e7a-9c11-bbbbbbbbbbbb";
    const model = buildWorkbenchHomeModelFromState({
      agentsList: {
        defaultId: "main",
        mainKey: "main",
        scope: "user",
        agents: [
          { id: "main", name: "大白管家" },
          { id: uuid, name: uuid },
          { id: namedUuid, name: "市场助手" },
        ],
      } as AgentsListResult,
      sessionsResult: { count: 0, sessions: [] } as unknown as SessionsListResult,
      sessionSeenAt: {},
      activeSessionKey: "main",
      teamObjects: {},
      teamOrder: [],
      channelsSnapshot: null,
      presenceEntries: [],
      connected: true,
      cronNext: null,
      lastError: null,
    });

    expect(model.teamAssistants.map((entry) => entry.title)).toEqual(["大白管家", "市场助手"]);
    expect(model.teamAssistants.some((entry) => entry.title === uuid)).toBe(false);
  });

  it("never opens the steward 1:1 entry on a collaboration space key", async () => {
    const { buildWorkbenchHomeModelFromState } =
      await import("../ports/employee/views/workbench-home-model.ts");
    const now = Date.now();

    const model = buildWorkbenchHomeModelFromState({
      agentsList: {
        defaultId: "main",
        mainKey: "main",
        scope: "user",
        agents: [{ id: "main", name: "大白管家" }],
      } as AgentsListResult,
      sessionsResult: {
        count: 3,
        sessions: [
          {
            key: "space:grp-elledecke204-gmail-com-ai",
            kind: "group",
            label: "AI智库",
            updatedAt: now,
          },
          {
            key: "agent:main:space:grp-elledecke204-gmail-com-ai",
            kind: "group",
            label: "AI智库",
            updatedAt: now - 100,
          },
          {
            key: "agent:main:employee:alice",
            kind: "direct",
            label: "大白管家",
            updatedAt: now - 200,
          },
        ],
      } as SessionsListResult,
      sessionSeenAt: {},
      activeSessionKey: "space:grp-elledecke204-gmail-com-ai",
      teamObjects: {},
      teamOrder: [],
      channelsSnapshot: null,
      presenceEntries: [],
      connected: true,
      cronNext: null,
      lastError: null,
    });

    const steward = model.teamAssistants.find((entry) => entry.title === "大白管家");
    expect(steward?.key).toBe("agent:main:employee:alice");
    expect(steward?.key.startsWith("space:")).toBe(false);
    expect(steward?.key.includes(":space:")).toBe(false);
  });

  it("P1: 系统/定时会话（无真实消息）不计入未读 — 消除大白管家假计数", async () => {
    const { buildWorkbenchHomeModelFromState } =
      await import("../ports/employee/views/workbench-home-model.ts");
    const now = Date.now();
    const model = buildWorkbenchHomeModelFromState({
      agentsList: {
        defaultId: "main",
        mainKey: "main",
        scope: "user",
        agents: [
          { id: "main", name: "大白管家" },
          { id: "bot-2", name: "市场助手" },
        ],
      } as AgentsListResult,
      sessionsResult: {
        count: 3,
        sessions: [
          // 用户与大白管家的主对话：有真实消息、已读 → 不算未读
          {
            key: "main",
            kind: "global",
            label: "大白管家",
            updatedAt: now - 5_000,
            lastMessagePreview: "老对话",
          },
          // 员工隔离初始化：只 bump updatedAt、无真实消息 → 不应计未读（假计数来源）
          {
            key: "agent:main:employee:e1",
            kind: "global",
            label: "大白管家",
            updatedAt: now - 100,
          },
          // 定时任务会话 → 不应计未读
          { key: "agent:main:cron:job-1", kind: "unknown", label: "Cron", updatedAt: now - 50 },
        ],
      } as SessionsListResult,
      sessionSeenAt: { main: now },
      activeSessionKey: "agent:bot-2:main",
      teamObjects: {},
      teamOrder: [],
      channelsSnapshot: null,
      presenceEntries: [],
      connected: true,
      cronNext: null,
      lastError: null,
    });
    expect(model.agents.find((entry) => entry.sessionKeys.includes("main"))?.unreadCount).toBe(0);
  });

  it("P1: 真实未读入站消息仍计入未读", async () => {
    const { buildWorkbenchHomeModelFromState } =
      await import("../ports/employee/views/workbench-home-model.ts");
    const now = Date.now();
    const model = buildWorkbenchHomeModelFromState({
      agentsList: {
        defaultId: "main",
        mainKey: "main",
        scope: "user",
        agents: [
          { id: "main", name: "大白管家" },
          { id: "bot-2", name: "市场助手" },
        ],
      } as AgentsListResult,
      sessionsResult: {
        count: 1,
        sessions: [
          // 有真实消息、未读（sessionSeenAt 未包含该键）→ 计 1
          {
            key: "main",
            kind: "global",
            label: "大白管家",
            updatedAt: now - 1_000,
            lastMessagePreview: "新消息",
          },
        ],
      } as SessionsListResult,
      sessionSeenAt: {},
      activeSessionKey: "agent:bot-2:main",
      teamObjects: {},
      teamOrder: [],
      channelsSnapshot: null,
      presenceEntries: [],
      connected: true,
      cronNext: null,
      lastError: null,
    });
    expect(model.agents.find((entry) => entry.sessionKeys.includes("main"))?.unreadCount).toBe(1);
  });
});

describe("formatCronMinutesLabel", () => {
  it("never falls back to the raw i18n key", async () => {
    const { formatCronMinutesLabel } =
      await import("../ports/employee/views/workbench-home-model.ts");
    const label = formatCronMinutesLabel(8);
    expect(label).not.toContain("frontstage.workbench.cards.cronMinutes");
    expect(label).toMatch(/8/);
  });
});

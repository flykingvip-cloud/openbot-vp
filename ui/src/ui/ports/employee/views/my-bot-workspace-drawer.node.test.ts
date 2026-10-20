// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyMyBotProjection } from "../semantic/my-bot-read-model.ts";
import {
  inferCapabilityDomain,
  renderMyBotWorkspaceDrawer,
  resetMyBotDrawerLocalUiForTests,
} from "./my-bot-workspace-drawer.ts";

afterEach(() => {
  document.body.innerHTML = "";
  resetMyBotDrawerLocalUiForTests();
});

const baseRobotEntry = {
  id: "sales",
  sessionKey: "agent:sales:main",
  name: "销售助手",
  emoji: "💼",
  source: "owned" as const,
  status: "running" as const,
  shareStatus: "private",
  workspaceState: "configured" as const,
  lastActiveAt: Date.now(),
};

function renderDrawer(overrides: Record<string, unknown> = {}) {
  const bot = createEmptyMyBotProjection("sales", "销售助手");
  bot.phase = 2;
  bot.identity.positioning = "市场分析与成交加速";
  bot.identity.role = "顾问";
  bot.capabilities = [
    {
      name: "市场分析",
      stars: 5,
      source: "personal",
      relationId: "cap-1",
      callCount: 12,
      domain: "research",
    },
    {
      name: "PPT生成",
      stars: 3,
      source: "personal",
      relationId: "cap-2",
      callCount: 4,
      domain: "content",
    },
  ];
  bot.collaborations = [{ groupId: "g1", title: "销售协作组", sessionKey: "space:g1" }];
  bot.growth.level = 2;
  bot.growth.sources = ["personal", "skill_upgrade"];
  bot.growth.sourceCounts = { personal: 1, skill_upgrade: 1 };
  bot.growth.recentEvents = [
    { text: "首个任务成功", at: "2026-08-02T10:00:00.000Z", source: "personal" },
    { text: "首次掌握能力", at: "2026-08-01T08:00:00.000Z", source: "skill_upgrade" },
  ];
  bot.data.memorySize = 2048;
  bot.data.longTermCount = 3;

  const container = document.createElement("div");
  const props = {
    open: true,
    loading: false,
    error: null,
    saving: false,
    canEditIdentity: true,
    bot,
    robotEntry: baseRobotEntry,
    identityDraft: {
      name: "销售助手",
      positioning: "市场分析与成交加速",
      role: "顾问",
      personaTraits: "简洁",
      model: "openai/gpt-4.1",
    },
    operationalIdentitySnapshot: {
      identities: [],
      grants: [],
      usageHistory: [],
      providerCatalog: [],
      enterpriseAccessByAgent: { sales: [] },
    },
    onClose: () => undefined,
    onIdentityDraftChange: () => undefined,
    onSaveIdentity: () => undefined,
    onOpenGroup: () => undefined,
    onApplyRobotIdentityGrants: vi.fn(),
    onRequestUpdate: () => {
      render(html`${renderMyBotWorkspaceDrawer(props as never)}`, container);
    },
    ...overrides,
  };
  if (overrides.bot) {
    props.bot = overrides.bot as typeof bot;
  }
  render(html`${renderMyBotWorkspaceDrawer(props as never)}`, container);
  return { container, props, bot };
}

describe("renderMyBotWorkspaceDrawer", () => {
  it("renders nothing when closed", () => {
    const container = document.createElement("div");
    render(
      html`${renderMyBotWorkspaceDrawer({
        open: false,
        loading: false,
        error: null,
        saving: false,
        canEditIdentity: true,
        bot: null,
        robotEntry: null,
        identityDraft: null,
        onClose: () => undefined,
        onIdentityDraftChange: () => undefined,
        onSaveIdentity: () => undefined,
        onOpenGroup: () => undefined,
      })}`,
      container,
    );
    expect(container.querySelector(".employee-workbench__mybot-drawer")).toBeNull();
  });

  it("renders six blocks with capability radar, affinity, and evidence growth", () => {
    const { container } = renderDrawer();

    expect(container.querySelector(".employee-workbench__mybot-drawer")).toBeTruthy();
    expect(container.querySelector("[data-wb-settings-toolbar]")).toBeTruthy();
    expect(container.querySelector('[data-block="identity"]')).toBeTruthy();
    expect(container.querySelector('[data-block="persona"]')).toBeTruthy();
    expect(container.querySelector('[data-block="advanced-config"]')).toBeTruthy();
    expect(container.querySelector(".employee-workbench__robot-identity-panel")).toBeTruthy();
    expect(container.textContent).toContain("① 身份");
    expect(container.textContent).toContain("② 能力");
    expect(container.textContent).toContain("③ 职能倾向");
    expect(container.textContent).not.toContain("③ 扮演身份");
    expect(container.textContent).toContain("高级配置 · 运营身份授权");
    expect(container.textContent).toContain("④ 成长");
    expect(container.textContent).toContain("⑤ 协作");
    expect(container.textContent).toContain("⑥ 数据");
    expect(container.textContent).toContain("市场分析");
    expect(container.querySelector("[data-cap-insight]")?.textContent).toContain("已掌握 2 项");
    expect(container.querySelector("[data-cap-insight]")?.textContent).toContain("累计调用");
    expect(container.querySelector("[data-cap-radar]")).toBeTruthy();
    expect(container.querySelector("[data-identity-affinity]")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__mybot-growth-timeline")).toBeTruthy();
    expect(container.textContent).toContain("任务完成");
    expect(container.textContent).toContain("能力里程碑");
    expect(container.textContent).not.toContain("安装第一项能力");
    expect(container.textContent).not.toContain("安装能力");
    expect(container.textContent).not.toContain("探索更多能力");
    expect(container.textContent).toContain("销售协作组");
    expect(container.textContent).toContain("不含 Token");
    expect(container.querySelector(".employee-workbench__mybot-identity-avatar")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__mybot-data-metrics")).toBeTruthy();
  });

  it("opens capability L1 from map list and returns without install CTA", () => {
    const { container } = renderDrawer();
    const row = container.querySelector('[data-capability-id="cap-1"]');
    expect(row).toBeTruthy();
    (row as HTMLElement | null)?.click();
    expect(container.querySelector('[data-capability-l1="cap-1"]')).toBeTruthy();
    expect(container.textContent).toContain("返回能力地图");
    expect(container.textContent).toContain("调用 12 次");
    expect(container.querySelector('[data-cap-action="try"]')).toBeTruthy();
    expect(container.querySelector('[data-cap-action="cultivate"]')).toBeNull();
    const back = container.querySelector(".employee-workbench__mybot-cap-l1-back");
    (back as HTMLElement | null)?.click();
    expect(container.querySelector("[data-capability-l1]")).toBeNull();
    expect(container.querySelector("[data-cap-insight]")).toBeTruthy();
    expect(container.querySelector('[data-cap-action="install"]')).toBeNull();
  });

  it("wires try action from capability L1", () => {
    const onTryCapability = vi.fn();
    const { container } = renderDrawer({ onTryCapability });
    (container.querySelector('[data-capability-id="cap-1"]') as HTMLButtonElement).click();
    (container.querySelector('[data-cap-action="try"]') as HTMLButtonElement).click();
    expect(onTryCapability).toHaveBeenCalledWith({
      agentId: "sales",
      sessionKey: "agent:sales:main",
      capabilityName: "市场分析",
      relationId: "cap-1",
    });
  });

  it("lists unused capabilities under pending when callCount evidence exists", () => {
    const bot = createEmptyMyBotProjection("sales", "销售助手");
    bot.capabilities = [
      {
        name: "市场分析",
        stars: 5,
        source: "personal",
        relationId: "cap-1",
        callCount: 3,
        domain: "research",
      },
      {
        name: "未使用技能",
        stars: 1,
        source: "personal",
        relationId: "cap-unused",
        callCount: 0,
        domain: "tools",
      },
    ];
    const { container } = renderDrawer({ bot });
    expect(container.textContent).toContain("市场分析");
    expect(container.textContent).toContain("未使用技能");
    expect(container.textContent).toContain("待激活能力");
    expect(container.textContent).toContain("待首次调用");
    expect(container.querySelector("[data-cap-insight]")?.textContent).toContain("已掌握 1 项");
  });

  it("renders gateway description and growth task links when provided", () => {
    const bot = createEmptyMyBotProjection("sales", "销售助手");
    bot.capabilities = [
      {
        name: "市场分析",
        stars: 5,
        source: "personal",
        relationId: "cap-1",
        callCount: 2,
        description: "擅长行业与竞品研究",
        domain: "research",
        lastImprovedAt: "2026-08-02T10:00:00.000Z",
      },
    ];
    bot.growth.recentEvents = [
      {
        text: "首次掌握能力",
        at: "2026-08-02T10:00:00.000Z",
        source: "skill_upgrade",
        capabilityRef: "cap-1",
        taskRef: { kind: "session", id: "agent:sales:main", title: "首次打开会话" },
      },
    ];
    bot.growth.sources = ["skill_upgrade", "personal"];
    bot.growth.sourceCounts = { skill_upgrade: 1, personal: 0 };
    const onOpenGrowthTaskRef = vi.fn();
    const { container } = renderDrawer({ bot, onOpenGrowthTaskRef });
    (container.querySelector('[data-capability-id="cap-1"]') as HTMLButtonElement).click();
    expect(container.querySelector("[data-cap-description]")?.textContent).toContain(
      "擅长行业与竞品研究",
    );
    (
      container.querySelector(".employee-workbench__mybot-cap-l1-back") as HTMLButtonElement
    ).click();
    expect(container.querySelector("[data-growth-task-kind='session']")).toBeTruthy();
    expect(container.querySelector("[data-growth-cap-ref='cap-1']")).toBeTruthy();
    (container.querySelector("[data-growth-task-kind='session']") as HTMLButtonElement).click();
    expect(onOpenGrowthTaskRef).toHaveBeenCalledWith({
      kind: "session",
      id: "agent:sales:main",
      title: "首次打开会话",
    });
  });

  it("infers capability domains from names", () => {
    expect(inferCapabilityDomain("市场分析")).toBe("research");
    expect(inferCapabilityDomain("PPT生成")).toBe("content");
    expect(inferCapabilityDomain("数据统计")).toBe("data");
    expect(inferCapabilityDomain("未知技能")).toBe("general");
  });
});

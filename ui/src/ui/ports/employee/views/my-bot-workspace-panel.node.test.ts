// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { createEmptyMyBotProjection } from "../semantic/my-bot-read-model.ts";
import { renderMyBotWorkspacePanel } from "./my-bot-workspace-panel.ts";
import {
  resetPersonalDevicesPanelForTests,
  setPersonalDevicesClientForTests,
} from "./personal-devices-page.ts";
import type { WorkbenchSettingsRobotEntry } from "./workbench-types.ts";

afterEach(() => {
  resetPersonalDevicesPanelForTests();
  setPersonalDevicesClientForTests(null);
  document.body.innerHTML = "";
});

beforeEach(async () => {
  await i18n.setLocale("zh-CN");
});

const baseEntry: WorkbenchSettingsRobotEntry = {
  id: "sales",
  sessionKey: "agent:sales:main",
  name: "销售助手",
  emoji: "🤖",
  source: "owned",
  status: "running",
  shareStatus: null,
  workspaceState: "configured",
  lastActiveAt: Date.now(),
};

describe("renderMyBotWorkspacePanel", () => {
  it("renders top tabs and identity stage for a projection", () => {
    const bot = createEmptyMyBotProjection("sales", "销售助手");
    bot.phase = 2;
    bot.capabilities = [{ name: "报价助手", stars: 4, source: "personal", relationId: "cap-1" }];
    bot.collaborations = [{ groupId: "g1", title: "销售协作组", sessionKey: "space:g1" }];
    bot.growth.level = 2;
    bot.data.memorySize = 2048;
    bot.data.longTermCount = 3;

    const onTabChange = vi.fn();
    const container = document.createElement("div");
    render(
      html`${renderMyBotWorkspacePanel({
        entry: baseEntry,
        loading: false,
        error: null,
        saving: false,
        bot,
        identityDraft: {
          name: "销售助手",
          positioning: "成交加速",
          role: "顾问",
          personaTraits: "简洁",
          model: "openai/gpt-4.1",
        },
        activeTab: "identity",
        onTabChange,
        onIdentityDraftChange: () => undefined,
        onSaveIdentity: () => undefined,
        onExploreCapabilities: () => undefined,
        onOpenGroup: () => undefined,
        onSelectSession: () => undefined,
      })}`,
      container,
    );

    expect(container.querySelector(".employee-workbench__mybot-drawer")).toBeNull();
    expect(container.querySelector("[data-wb-settings-toolbar]")).toBeTruthy();
    expect(container.querySelector(".wb-bots__tabs")).toBeTruthy();
    expect(container.textContent).toContain("身份");
    expect(container.textContent).toContain("能力");
    expect(container.textContent).toContain("成长");
    expect(container.textContent).toContain("运营授权");
    expect(container.textContent).toContain("协作");
    expect(container.textContent).toContain("数据");
    expect(container.textContent).toContain("已连接设备");
    expect(container.textContent).toContain("删除");
    expect(container.textContent).toContain("进入工作区");
    expect(container.textContent).toContain("定位");

    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "能力")
      ?.click();
    expect(onTabChange).toHaveBeenCalledWith("capabilities");
  });

  it("renders capabilities tab content with explore CTA", () => {
    const bot = createEmptyMyBotProjection("sales", "销售助手");
    bot.capabilities = [{ name: "报价助手", stars: 4, source: "personal", relationId: "cap-1" }];
    const onExplore = vi.fn();
    const container = document.createElement("div");
    render(
      html`${renderMyBotWorkspacePanel({
        entry: baseEntry,
        loading: false,
        error: null,
        saving: false,
        bot,
        identityDraft: null,
        activeTab: "capabilities",
        capabilityAtlas: {
          agentId: baseEntry.id,
          loading: false,
          loaded: true,
          error: null,
          capabilities: [
            {
              id: "cap-quote",
              name: "报价助手",
              domain: "research",
              callCount: 2,
              origin: "installed",
              weight: 2,
            },
            {
              id: "pat-browser",
              name: "微信公众号成稿",
              domain: "research",
              callCount: 26,
              origin: "used",
              weight: 26,
            },
          ],
          knowledge: [{ id: "kb-sales", label: "销售手册", documents: ["折扣口径"] }],
          outputs: [{ id: "out-1", title: "季度经营复盘（3页 PPTX）" }],
        },
        onTabChange: () => undefined,
        onIdentityDraftChange: () => undefined,
        onSaveIdentity: () => undefined,
        onExploreCapabilities: onExplore,
        onOpenGroup: () => undefined,
        onSelectSession: () => undefined,
      })}`,
      container,
    );

    expect(container.querySelector("[data-cap-radar]")).toBeTruthy();
    expect(container.textContent).toContain("能力地图");
    expect(container.textContent).toContain("知识图谱");
    expect(container.textContent).toContain("报价助手");
    expect(container.textContent).toContain("微信公众号成稿");
    expect(container.textContent).toContain("使用");
    expect(container.textContent).toContain("销售手册");
    expect(container.textContent).toContain("折扣口径");
    expect(container.textContent).not.toContain("季度经营复盘");
    expect(container.textContent).not.toContain("扮演");
    expect(container.textContent).toContain("探索能力");
    expect(container.textContent).not.toContain("Lv.");
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "探索能力")
      ?.click();
    expect(onExplore).toHaveBeenCalled();
  });

  it("shows captured deliverables on the growth tab", () => {
    const bot = createEmptyMyBotProjection("sales", "销售助手");
    const container = document.createElement("div");
    render(
      html`${renderMyBotWorkspacePanel({
        entry: baseEntry,
        loading: false,
        error: null,
        saving: false,
        bot,
        identityDraft: null,
        activeTab: "growth",
        capabilityAtlas: {
          agentId: "sales",
          loading: false,
          loaded: true,
          error: null,
          capabilities: [],
          knowledge: [],
          outputs: [{ id: "out-1", title: "季度经营复盘（3页 PPTX）" }],
        },
        onTabChange: () => undefined,
        onIdentityDraftChange: () => undefined,
        onSaveIdentity: () => undefined,
        onExploreCapabilities: () => undefined,
        onOpenGroup: () => undefined,
        onSelectSession: () => undefined,
      })}`,
      container,
    );
    expect(container.querySelector("[data-wb-bots-outputs]")?.textContent).toContain(
      "季度经营复盘（3页 PPTX）",
    );
    expect(container.textContent).toContain("产出");
  });

  it("renders growth dossier capability/performance/suggestion zones with primary recommendation CTA", () => {
    const bot = createEmptyMyBotProjection("sales", "销售助手");
    bot.identity.role = "销售顾问";
    bot.identity.positioning = "成交加速";
    bot.growth = {
      ...bot.growth,
      level: 2,
      activationScore: 64,
      operationalScore: null,
      falseReady: false,
      dimensions: { identity: 40, capability: 20, knowledge: 0, habits: 0 },
      completeness: { identity: 40, capability: 20, performance: 0, suggestion: 50 },
      capabilityGaps: [{ key: "crm", label: "CRM", kind: "skill", status: "missing" }],
      recommendation: {
        kind: "install_capabilities",
        reason: "growth.recommend.install_capabilities",
        canSkip: true,
        gaps: [{ key: "crm", label: "CRM", kind: "skill", status: "missing" }],
        target: { module: "assistant", tab: "skills", recommendedSkillKeys: ["crm"] },
      },
      growthReport: null,
      funnel: {
        hasSessionOpened: true,
        hasIdentityCompleted: false,
        hasFirstSkillInstalled: false,
        hasFirstMissionSent: false,
        hasFirstMissionSuccess: false,
        preludeDismissed: false,
      },
    };
    const onExplore = vi.fn();
    const container = document.createElement("div");
    render(
      html`${renderMyBotWorkspacePanel({
        entry: baseEntry,
        loading: false,
        error: null,
        saving: false,
        bot,
        identityDraft: null,
        activeTab: "growth",
        onTabChange: () => undefined,
        onIdentityDraftChange: () => undefined,
        onSaveIdentity: () => undefined,
        onExploreCapabilities: onExplore,
        onOpenGroup: () => undefined,
        onSelectSession: () => undefined,
      })}`,
      container,
    );

    expect(container.querySelector("[data-wb-bots-growth-dossier]")).toBeTruthy();
    expect(container.querySelector('[data-wb-bots-zone="identity"]')).toBeNull();
    expect(container.querySelector('[data-wb-bots-zone="capability"]')).toBeTruthy();
    expect(container.querySelector('[data-wb-bots-zone="performance"]')).toBeNull();
    expect(container.querySelector('[data-wb-bots-zone="suggestion"]')).toBeTruthy();
    expect(container.textContent).not.toContain("实战表现");
    expect(container.textContent).not.toContain("暂无");
    expect(container.textContent).toContain("CRM");
    expect(container.textContent).toContain("去安装推荐能力");
    container.querySelector<HTMLButtonElement>("[data-wb-bots-growth-cta]")?.click();
    expect(onExplore).toHaveBeenCalled();
  });

  it("renders learned Working DNA preferences in the growth capability zone", () => {
    const bot = createEmptyMyBotProjection("sales", "销售助手");
    bot.growth = {
      ...bot.growth,
      workingStyle: {
        learned: true,
        style: {
          outputFormat: "structured",
          reportingCadence: "on_completion",
          decisionPreference: "confirm_first",
          riskPreference: "conservative",
          communicationTone: "neutral",
        },
        evidence: {
          tasksTotal: 12,
          minSamplesForLearning: 5,
          minSamplesForAutonomous: 10,
          learningEligible: true,
          autonomousEligible: true,
        },
        updatedAtMs: Date.now(),
        lastChange: {
          changedAtMs: Date.now(),
          effectStatus: "improved",
          rolledBack: false,
        },
      },
    };
    const container = document.createElement("div");
    render(
      html`${renderMyBotWorkspacePanel({
        entry: baseEntry,
        loading: false,
        error: null,
        saving: false,
        bot,
        identityDraft: null,
        activeTab: "growth",
        onTabChange: () => undefined,
        onIdentityDraftChange: () => undefined,
        onSaveIdentity: () => undefined,
        onExploreCapabilities: () => undefined,
        onOpenGroup: () => undefined,
        onSelectSession: () => undefined,
      })}`,
      container,
    );
    expect(container.querySelector("[data-wb-bots-working-style]")).toBeTruthy();
    expect(container.textContent).toContain("工作偏好");
    expect(container.textContent).toContain("表现改善");
  });

  it("lets an owner confirm-delete without an unbind choice", () => {
    const onConfirm = vi.fn();
    const container = document.createElement("div");
    render(
      html`${renderMyBotWorkspacePanel({
        entry: {
          ...baseEntry,
          id: "agt-daniel-hhd-gmail-com-nchn5ey",
          name: "agt-daniel-hhd-gmail-com-nchn5ey",
        },
        loading: false,
        error: "unknown or inaccessible agentId: agt-daniel-hhd-gmail-com-nchn5ey",
        saving: false,
        bot: null,
        identityDraft: null,
        activeTab: "danger",
        onTabChange: () => undefined,
        onIdentityDraftChange: () => undefined,
        onSaveIdentity: () => undefined,
        onExploreCapabilities: () => undefined,
        onOpenGroup: () => undefined,
        onSelectSession: () => undefined,
        onConfirmOwnedRobotDelete: onConfirm,
        onPrepareOwnedRobotDelete: () => undefined,
      })}`,
      container,
    );

    expect(container.textContent).toContain("确认删除");
    expect(container.textContent).toContain("删除后不可恢复");
    expect(container.textContent).not.toContain("仅解除绑定");
    expect(container.textContent).not.toContain("删除全部数据");
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "确认删除")
      ?.click();
    expect(onConfirm).toHaveBeenCalled();
  });

  it("renders growth dossier in English without hardcoded Chinese", async () => {
    await i18n.setLocale("en");
    const bot = createEmptyMyBotProjection("sales", "Sales Bot");
    bot.growth = {
      ...bot.growth,
      operationalScore: null,
      completeness: { identity: 10, capability: 10, performance: 0, suggestion: 50 },
      recommendation: {
        kind: "install_capabilities",
        reason: "growth.recommend.install_capabilities",
        canSkip: true,
        gaps: [{ key: "crm", label: "CRM", kind: "skill", status: "missing" }],
      },
      growthReport: null,
    };
    const container = document.createElement("div");
    render(
      html`${renderMyBotWorkspacePanel({
        entry: baseEntry,
        loading: false,
        error: null,
        saving: false,
        bot,
        identityDraft: null,
        activeTab: "growth",
        onTabChange: () => undefined,
        onIdentityDraftChange: () => undefined,
        onSaveIdentity: () => undefined,
        onExploreCapabilities: () => undefined,
        onOpenGroup: () => undefined,
        onSelectSession: () => undefined,
      })}`,
      container,
    );
    expect(container.textContent).toContain("Install recommended skills");
    expect(container.textContent).not.toContain("Operational score");
    expect(container.textContent).not.toContain("Not available");
    expect(container.textContent).not.toContain("实战表现");
    expect(container.textContent).not.toContain("去安装推荐能力");
  });

  it("lists devices bound to the open digital human", async () => {
    setPersonalDevicesClientForTests({
      listDevices: async (query) =>
        query?.digitalHumanId === "sales"
          ? [
              {
                deviceId: "dev-1",
                displayName: "门口相机",
                platformId: "plat-1",
                externalDeviceId: "cam-1",
                binding: {
                  bindingId: "bind-1",
                  digitalHumanId: "sales",
                  scopes: ["chat"],
                  status: "active",
                  expectedBindingVersion: 1,
                  appliedBindingVersion: 1,
                  authorizationEstablished: true,
                  platformApplied: true,
                },
                status: { online: false, presence: "unknown", capabilities: [] },
              },
            ]
          : [],
      listPlatforms: async () => [{ platformId: "plat-1", displayName: "实验室设备" }],
      listHumans: async () => [{ digitalHumanId: "sales", displayName: "销售助手" }],
      submit: async () => null,
    });
    const container = document.createElement("div");
    const paint = () => {
      render(
        html`${renderMyBotWorkspacePanel({
          entry: baseEntry,
          loading: true,
          error: null,
          saving: false,
          bot: null,
          identityDraft: null,
          activeTab: "devices",
          onTabChange: () => undefined,
          onIdentityDraftChange: () => undefined,
          onSaveIdentity: () => undefined,
          onExploreCapabilities: () => undefined,
          onOpenGroup: () => undefined,
          onSelectSession: () => undefined,
        })}`,
        container,
      );
    };
    paint();
    for (let step = 0; step < 6; step += 1) {
      await Promise.resolve();
    }
    paint();
    expect(container.querySelector("[data-wb-bots-tab=devices]")).not.toBeNull();
    expect(container.textContent).toContain("已连接设备");
    expect(container.textContent).toContain("门口相机");
    expect(container.textContent).toContain("未确认·JOINT_PENDING");
    expect(container.textContent).not.toContain("正在加载详情");
    expect(
      container
        .querySelector("[data-personal-devices-view]")
        ?.getAttribute("data-personal-devices-view"),
    ).toBe("list");
    expect(container.querySelector("[data-testid=personal-device-add]")).toBeNull();
    container.querySelector<HTMLButtonElement>("[data-testid=personal-devices-add]")?.click();
    paint();
    expect(
      container
        .querySelector("[data-personal-devices-view]")
        ?.getAttribute("data-personal-devices-view"),
    ).toBe("add");
    const human = container.querySelector<HTMLInputElement>("[data-testid=personal-device-human]");
    expect(human?.disabled).toBe(true);
    expect(human?.getAttribute("data-digital-human-id")).toBe("sales");
  });

  it("lists openable memory, knowledge, and workspace files on the data tab", () => {
    const onOpenRobotDataItem = vi.fn();
    const container = document.createElement("div");
    render(
      html`${renderMyBotWorkspacePanel({
        entry: baseEntry,
        loading: false,
        error: null,
        saving: false,
        bot: createEmptyMyBotProjection("sales", "销售助手"),
        identityDraft: null,
        activeTab: "data",
        onTabChange: () => undefined,
        onIdentityDraftChange: () => undefined,
        onSaveIdentity: () => undefined,
        onExploreCapabilities: () => undefined,
        onOpenGroup: () => undefined,
        onSelectSession: () => undefined,
        dataSurface: {
          agentId: "sales",
          loading: false,
          loaded: true,
          error: null,
          workspace: "/robots/sales/workspace",
          workspaceFiles: [{ name: "SOUL.md", label: "SOUL.md", bytes: 120 }],
          memoryFiles: [
            { name: "memory/task_ledger.json", label: "memory/task_ledger.json", bytes: 80 },
          ],
          atoms: [],
          knowledge: [
            {
              knowledgeBaseId: "kb-1",
              documentId: "doc-1",
              title: "合同审查手册",
              baseTitle: "法务知识库",
            },
          ],
          open: null,
        },
        onOpenRobotDataItem,
      })}`,
      container,
    );
    expect(container.textContent).toContain("memory/task_ledger.json");
    expect(container.textContent).toContain("合同审查手册");
    expect(container.textContent).toContain("/robots/sales/workspace");
    expect(container.textContent).toContain("SOUL.md");
    expect(container.textContent).not.toContain("尚未配置");
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("memory/task_ledger.json"))
      ?.click();
    expect(onOpenRobotDataItem).toHaveBeenCalledWith({
      kind: "file",
      agentId: "sales",
      name: "memory/task_ledger.json",
      label: "memory/task_ledger.json",
    });
  });
});

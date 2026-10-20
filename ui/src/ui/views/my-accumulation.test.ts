// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { scanNode } from "../capability/employee-capability/terminology-filter.ts";
import type {
  CapabilityShareVisibility,
  CapabilitySummary,
} from "../capability/employee-capability/types.ts";
import type { MyAccumulationProps } from "./my-accumulation.ts";
import { renderMyAccumulation } from "./my-accumulation.ts";

function capability(overrides: Partial<CapabilitySummary> = {}): CapabilitySummary {
  return {
    id: overrides.id ?? "cap-1",
    name: overrides.name ?? "客户情绪分析",
    summary: overrides.summary ?? "分析客户消息中的情绪倾向",
    assetType: overrides.assetType ?? "capability",
    usageExamples: overrides.usageExamples ?? ["客户投诉处理"],
    inputDescription: overrides.inputDescription ?? "客户消息",
    outputDescription: overrides.outputDescription ?? "情绪摘要和建议",
    tags: overrides.tags ?? ["客户", "分析"],
    category: overrides.category ?? "客户服务",
    avatar: overrides.avatar ?? null,
    health: overrides.health ?? "运行稳定",
    shareVisibility: overrides.shareVisibility ?? "私有",
    maturity: overrides.maturity ?? null,
    attribution: overrides.attribution ?? {
      sourceRobot: { id: "robot-1", name: "销售助手" },
      sourceTaskSummary: "客户服务任务",
      firstFormedScenario: "首次在客户投诉处理时形成",
      highFrequencyScenarios: ["客户投诉"],
    },
    usage: overrides.usage ?? {
      robots: [{ id: "robot-1", name: "销售助手" }],
      totalUsageCount: 12,
      lastUsedAt: 1_700_000_000_000,
    },
    usageMetrics: overrides.usageMetrics ?? {
      robotCount: 1,
      groupCount: 0,
      totalUsageCount: 12,
      lastUsedAt: 1_700_000_000_000,
    },
    recentUpdate: overrides.recentUpdate ?? {
      id: "recap-1",
      at: 1_700_000_000_000,
      headline: "最近更新 · 优化了使用场景说明",
    },
    versionInfo: overrides.versionInfo ?? {
      currentVersion: "1.0.0",
      versionCount: 1,
      submittedVersion: null,
    },
    isDraft: overrides.isDraft ?? false,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    applicationSummary: overrides.applicationSummary ?? "已在 1 个机器人中应用",
    feedbackSummary: overrides.feedbackSummary ?? "应用稳定",
    enterpriseReview:
      overrides.enterpriseReview ??
      ({
        statusLabel: "审核中",
        nextStep: "等待企业管理员开始审核。",
        submittedAt: 1_700_000_000_000,
        reviewerNote: null,
      } satisfies NonNullable<CapabilitySummary["enterpriseReview"]>),
    enterpriseLifecycle:
      overrides.enterpriseLifecycle ??
      ({
        stage: "draft",
        stageLabel: "资产草稿",
        nextStep: "补充信息后可共享或提交企业。",
      } satisfies NonNullable<CapabilitySummary["enterpriseLifecycle"]>),
    sourceContextLabel: overrides.sourceContextLabel ?? "来自客户服务任务",
    optimizationTargets: overrides.optimizationTargets ?? [
      { kind: "robot", id: "robot-1", name: "销售助手" },
    ],
  };
}

function props(overrides: Partial<MyAccumulationProps> = {}): MyAccumulationProps {
  const cap = capability();
  return {
    loading: false,
    error: null,
    items: [
      {
        id: cap.id,
        name: cap.name,
        summary: cap.summary,
        assetType: cap.assetType,
        health: cap.health,
        shareVisibility: cap.shareVisibility,
        isDraft: cap.isDraft,
        recentUpdate: cap.recentUpdate,
        updatedAt: cap.updatedAt,
        sourceRobotName: cap.attribution.sourceRobot.name,
        sourceContextLabel: cap.sourceContextLabel,
        usageBrief: {
          robotCount: cap.usage.robots.length,
          lastUsedAt: cap.usage.lastUsedAt,
        },
        usageMetrics: cap.usageMetrics,
        versionInfo: cap.versionInfo,
        applicationSummary: cap.applicationSummary,
        feedbackSummary: cap.feedbackSummary,
        enterpriseReview: cap.enterpriseReview,
        enterpriseLifecycle: cap.enterpriseLifecycle,
        optimizationTargets: cap.optimizationTargets,
      },
    ],
    selectedCapability: cap,
    selectedLoading: false,
    detailTab: "overview",
    activeSegment: "all",
    pendingUsageBrief: null,
    pendingUsageBriefIntent: "edit",
    availableTags: ["客户", "分析"],
    availableCategories: ["客户服务"],
    availableSources: ["销售助手"],
    availableShareVisibilities: ["私有", "已共享到协作小组"] as CapabilityShareVisibility[],
    availableGroups: [{ id: "group-1", name: "销售协作组" }],
    searchQuery: "",
    filterTag: null,
    filterCategory: null,
    filterSource: null,
    filterShareVisibility: null,
    onSearchChange: vi.fn(),
    onFilterTagChange: vi.fn(),
    onFilterCategoryChange: vi.fn(),
    onFilterSourceChange: vi.fn(),
    onFilterShareVisibilityChange: vi.fn(),
    onShowDraftsOnly: vi.fn(),
    onShowAllCapabilities: vi.fn(),
    onShowContributedOnly: vi.fn(),
    onChangeSegment: vi.fn(),
    onChangeDetailTab: vi.fn(),
    onSelectCapability: vi.fn(),
    onContinueOrganize: vi.fn(),
    onShareToGroup: vi.fn(),
    onPrepareEdit: vi.fn(),
    onPrepareDelete: vi.fn(),
    onEditDraftChange: vi.fn(),
    onRunDefinitionAutofill: vi.fn(),
    onConfirmUsageBrief: vi.fn(),
    onCancelUsageBrief: vi.fn(),
    onOpenRobot: vi.fn(),
    onOpenGroup: vi.fn(),
    onSubmitToEnterprise: vi.fn(),
    definitionDirty: false,
    definitionSaving: false,
    definitionSaveNotice: null,
    autofillBusy: false,
    autofillError: null,
    autofillNotice: null,
    ...overrides,
  };
}

describe("renderMyAccumulation", () => {
  it("renders the entry title and list field boundary", () => {
    const container = document.createElement("div");
    render(renderMyAccumulation(props()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("我的资产");
    expect(text).toContain("已入企业");
    expect(text).toContain("审核中");
    expect(text).toContain("需优化");
    expect(text).not.toContain("我的技能");
    expect(text).toContain("客户情绪分析");
    expect(text).toContain("分析客户消息中的情绪倾向");
    expect(text).toContain("来自客户服务任务");
    expect(text).toContain("1.0.0");
    expect(text).toContain("定义");
    expect(text).toContain("安装与分发");
    expect(text).toContain("状态");
    expect(text).toContain("累计调用");
  });

  it("renders draft marker and all filters", () => {
    const container = document.createElement("div");
    const cap = capability({ isDraft: true });
    render(
      renderMyAccumulation(
        props({
          selectedCapability: null,
          items: [
            {
              id: cap.id,
              name: cap.name,
              summary: cap.summary,
              assetType: cap.assetType,
              health: cap.health,
              shareVisibility: cap.shareVisibility,
              isDraft: true,
              recentUpdate: cap.recentUpdate,
              updatedAt: cap.updatedAt,
              sourceRobotName: cap.attribution.sourceRobot.name,
              sourceContextLabel: cap.sourceContextLabel,
              usageBrief: { robotCount: 1, lastUsedAt: 1 },
              usageMetrics: cap.usageMetrics,
              versionInfo: cap.versionInfo,
              applicationSummary: cap.applicationSummary,
              feedbackSummary: cap.feedbackSummary,
              enterpriseLifecycle: cap.enterpriseLifecycle,
            },
          ],
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("待完善");
    expect(text).toContain("搜索资产");
  });

  it("routes pending deposit through the draft-organizing lane", () => {
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          activeSegment: "drafts",
          showDraftsOnly: true,
          assetSuggestionVisible: true,
          selectedCapability: null,
          canDepositFromContext: true,
          depositHint: "已识别当前工作上下文，可直接沉淀能力",
          onOpenSkillSave: vi.fn(),
          onOpenSkillSaveAndContinue: vi.fn(),
          items: [],
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("资产草稿");
    expect(text).toContain("本次任务可资产化建议");
    expect(text).toContain("开始整理");
    expect(text).not.toContain("沉淀新能力");
    expect(container.querySelector(".my-accumulation__suggestions")?.textContent).toContain(
      "本次任务可资产化建议",
    );
    expect(container.querySelector(".my-accumulation__list")?.textContent).not.toContain(
      "本次任务可资产化建议",
    );
  });

  it("shows a direct enterprise-submission action for mature workflow suggestions", () => {
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          activeSegment: "drafts",
          showDraftsOnly: true,
          assetSuggestionVisible: true,
          selectedCapability: null,
          canDepositFromContext: true,
          depositHint: "公众号发布工作流已整理完成，包含脚本、凭证和人工审核边界",
          showEnterpriseSubmitActionFromSuggestion: true,
          onOpenSkillSave: vi.fn(),
          onOpenSkillSaveAndContinue: vi.fn(),
          items: [],
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("直接整理并提交企业");
    expect(text).toContain("成熟工作流");
  });

  it("renders list-first asset management layout with expanded actions", () => {
    const container = document.createElement("div");
    render(renderMyAccumulation(props()), container);

    const text = container.textContent ?? "";
    for (const section of ["资产列表", "概览", "定义", "版本", "运行时"]) {
      expect(text).toContain(section);
    }
  });

  it("renders usage confirmation with delete intent", () => {
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          pendingUsageBriefIntent: "delete",
          pendingUsageBrief: {
            robots: [{ id: "robot-1", name: "销售助手" }],
            totalUsageCount: 1,
            lastUsedAt: 1,
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("确认继续");
    expect(container.textContent).toContain("删除前，请先确认这些机器人会受到影响。");
  });

  it("renders enterprise submission action and edit confirmation copy", () => {
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          pendingUsageBriefIntent: "edit",
          pendingUsageBrief: {
            robots: [{ id: "robot-1", name: "销售助手" }],
            totalUsageCount: 2,
            lastUsedAt: 1,
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("提交企业");
    expect(container.textContent).toContain("编辑前，请先确认这些机器人会受到影响。");
  });

  it("renders enterprise asset package submission modal", () => {
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          enterpriseSubmissionOpen: true,
          enterpriseSubmissionExpanded: false,
          enterpriseSubmissionReasonLines: [
            "识别到多脚本依赖或固定执行流程，因此按复合资产包处理。",
            "识别到对外发布和人工预览边界，因此建议采用半自动执行。",
          ],
          enterpriseSubmissionDraft: {
            packageTitle: "公众号文章编辑与发布",
            packageSummary: "用于整理、生成并发布公众号文章的复合资产包",
            assetPackageType: "composite_pack",
            businessScenario: "公众号文章编辑与发布",
            inputArtifacts: ["标题", "正文 Markdown"],
            outputArtifacts: ["已发布文章", "发布记录"],
            dependencies: ["publish.js", "wechat-config.md"],
            executionMode: "semi_automatic",
            riskTags: ["external_publish", "credential_required"],
            targetTeams: ["市场", "新媒体"],
            verifiedInProduction: true,
            promotionIntent: "enterprise_standard",
            needsEnterpriseSecrets: true,
            notes: "需企业统一托管公众号凭证",
          },
          onEnterpriseSubmissionChange: vi.fn(),
          onOpenEnterpriseSubmissionEditor: vi.fn(),
          onCloseEnterpriseSubmissionEditor: vi.fn(),
          onConfirmEnterpriseSubmission: vi.fn(),
          onCancelEnterpriseSubmission: vi.fn(),
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("提交企业资产包");
    expect(container.textContent).toContain("业务场景");
    expect(container.textContent).toContain("执行方式");
    expect(container.textContent).toContain("需要企业托管凭证");
    expect(container.textContent).toContain("提交企业");
    expect(container.textContent).toContain("自动补齐要点");
    expect(container.textContent).toContain("系统判断依据");
    expect(container.textContent).toContain("按复合资产包处理");
    expect(container.querySelector('.quick-capability-save-modal input[type="text"]')).toBeNull();
  });

  it("renders enterprise asset package editing fields when expanded", () => {
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          enterpriseSubmissionOpen: true,
          enterpriseSubmissionExpanded: true,
          enterpriseSubmissionDraft: {
            packageTitle: "公众号文章编辑与发布",
            packageSummary: "用于整理、生成并发布公众号文章的复合资产包",
            assetPackageType: "composite_pack",
            businessScenario: "公众号文章编辑与发布",
            inputArtifacts: ["标题", "正文 Markdown"],
            outputArtifacts: ["已发布文章", "发布记录"],
            dependencies: ["publish.js", "wechat-config.md"],
            executionMode: "semi_automatic",
            riskTags: ["external_publish", "credential_required"],
            targetTeams: ["市场", "新媒体"],
            verifiedInProduction: true,
            promotionIntent: "enterprise_standard",
            needsEnterpriseSecrets: true,
            notes: "需企业统一托管公众号凭证",
          },
          onEnterpriseSubmissionChange: vi.fn(),
          onOpenEnterpriseSubmissionEditor: vi.fn(),
          onCloseEnterpriseSubmissionEditor: vi.fn(),
          onConfirmEnterpriseSubmission: vi.fn(),
          onCancelEnterpriseSubmission: vi.fn(),
        }),
      ),
      container,
    );

    const titleInput = container.querySelector<HTMLInputElement>(
      '.quick-capability-save-modal input[type="text"]',
    );
    expect(titleInput?.value).toBe("公众号文章编辑与发布");
    expect(container.textContent).toContain("返回确认视图");
  });

  it("renders enterprise review tracking in the detail panel", () => {
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          detailTab: "definition",
          selectedCapability: capability({
            shareVisibility: "审核中",
            feedbackSummary: "企业正在审核",
            enterpriseLifecycle: {
              stage: "under_review",
              stageLabel: "审核中",
              nextStep: "等待企业管理员开始审核。",
              submittedAt: 1_700_000_000_000,
              reviewerNote: "先看资产边界和风险标签。",
            },
            enterpriseReview: {
              statusLabel: "审核中",
              nextStep: "等待企业管理员开始审核。",
              submittedAt: 1_700_000_000_000,
              reviewerNote: "先看资产边界和风险标签。",
            },
          }),
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("企业链路");
    expect(text).toContain("先看资产边界和风险标签。");
    expect(text).toContain("等待企业管理员开始审核。");
  });

  it("renders employee-side file guidance in the files tab", () => {
    const container = document.createElement("div");
    render(renderMyAccumulation(props({ detailTab: "files" })), container);

    const text = container.textContent ?? "";
    expect(text).toContain("个人端暂不展示技术文件");
    expect(text).toContain("SKILL.md");
  });

  it("renders shared timeline syntax in the versions tab", () => {
    const container = document.createElement("div");
    render(renderMyAccumulation(props({ detailTab: "versions" })), container);

    const text = container.textContent ?? "";
    expect(text).toContain("版本动态");
    expect(text).toContain("最近更新");
    expect(text).toContain("继续优化");
    expect(text).toContain("回到场景");
  });

  it("wires shared detail tab changes", () => {
    const container = document.createElement("div");
    const onChangeDetailTab = vi.fn();
    render(renderMyAccumulation(props({ onChangeDetailTab })), container);

    const runtimeTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".asset-detail-tabs__tab"),
    ).find((button) => button.textContent?.includes("运行时"));
    runtimeTab?.click();

    expect(onChangeDetailTab).toHaveBeenCalledWith("runtime");
  });

  it("shares to the selected collaboration group", () => {
    const container = document.createElement("div");
    const onShareToGroup = vi.fn();
    render(renderMyAccumulation(props({ detailTab: "install", onShareToGroup })), container);

    const select = container.querySelector<HTMLSelectElement>(".my-accumulation__group-select");
    expect(select?.value).toBe("group-1");
    container.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      if (button.textContent?.includes("分享到协作小组")) {
        button.click();
      }
    });

    expect(onShareToGroup).toHaveBeenCalledWith("cap-1", "group-1");
  });

  it("renders definition organize workbench with save and autofill actions for drafts", () => {
    const container = document.createElement("div");
    const onPrepareEdit = vi.fn();
    const onRunDefinitionAutofill = vi.fn();
    const onContinueOrganize = vi.fn();
    const onDiscardDefinitionChanges = vi.fn();
    const onUndoDefinitionAutofill = vi.fn();
    render(
      renderMyAccumulation(
        props({
          detailTab: "definition",
          definitionDirty: true,
          autofillCanUndo: true,
          selectedCapability: capability({
            isDraft: true,
            incubationReadiness: {
              ready: false,
              admissible: true,
              gaps: [{ field: "tags", label: "标签", severity: "recommend" }],
              reasons: ["缺少标签"],
            },
          }),
          items: [
            {
              id: "cap-1",
              name: "客户情绪分析",
              summary: "分析客户消息中的情绪倾向",
              assetType: "capability",
              health: "运行稳定",
              shareVisibility: "私有",
              isDraft: true,
              recentUpdate: null,
              updatedAt: 1,
              sourceRobotName: "销售助手",
              sourceContextLabel: "来自客户服务任务",
              usageBrief: { robotCount: 0, lastUsedAt: null },
              usageMetrics: {
                robotCount: 0,
                groupCount: 0,
                totalUsageCount: 0,
                lastUsedAt: null,
              },
              versionInfo: {
                currentVersion: "0.1.0",
                versionCount: 1,
                submittedVersion: null,
              },
              applicationSummary: undefined,
              feedbackSummary: undefined,
              enterpriseReview: null,
              enterpriseLifecycle: {
                stage: "draft",
                stageLabel: "资产草稿",
                nextStep: "补充信息后可共享或提交企业。",
              },
              optimizationTargets: [],
            },
          ],
          onPrepareEdit,
          onRunDefinitionAutofill,
          onContinueOrganize,
          onDiscardDefinitionChanges,
          onUndoDefinitionAutofill,
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("智能补齐");
    expect(text).toContain("保存整理");
    expect(text).toContain("整理进度");
    expect(text).toContain("标签");
    expect(text).toContain("有未保存修改");
    expect(text).toContain("放弃修改");
    expect(text).toContain("撤销补齐");
    expect(text).toContain("未保存");

    container.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      if (button.textContent?.trim() === "智能补齐") {
        button.click();
      }
      if (button.textContent?.includes("保存整理")) {
        button.click();
      }
      if (button.textContent?.includes("继续整理")) {
        button.click();
      }
      if (button.textContent?.trim() === "放弃修改") {
        button.click();
      }
      if (button.textContent?.trim() === "撤销补齐") {
        button.click();
      }
    });
    expect(onRunDefinitionAutofill).toHaveBeenCalledWith("cap-1");
    expect(onPrepareEdit).toHaveBeenCalledWith("cap-1");
    expect(onContinueOrganize).toHaveBeenCalledWith("cap-1");
    expect(onDiscardDefinitionChanges).toHaveBeenCalled();
    expect(onUndoDefinitionAutofill).toHaveBeenCalled();
  });

  it("folds technical diagnostic summary on overview and list", () => {
    const container = document.createElement("div");
    const diagnostic =
      "信封注册为 skill_abc；ASSET.md 指向 skill-template，索引失败，未能把正文写入知识库";
    render(
      renderMyAccumulation(
        props({
          detailTab: "overview",
          selectedCapability: capability({
            isDraft: true,
            summary: diagnostic,
          }),
          items: [
            {
              id: "cap-1",
              name: "客户情绪分析",
              summary: diagnostic,
              assetType: "capability",
              health: "运行稳定",
              shareVisibility: "私有",
              isDraft: true,
              recentUpdate: null,
              updatedAt: 1,
              sourceRobotName: "销售助手",
              sourceContextLabel: "来自客户服务任务",
              usageBrief: { robotCount: 0, lastUsedAt: null },
              usageMetrics: {
                robotCount: 0,
                groupCount: 0,
                totalUsageCount: 0,
                lastUsedAt: null,
              },
              versionInfo: {
                currentVersion: "0.1.0",
                versionCount: 1,
                submittedVersion: null,
              },
              applicationSummary: undefined,
              feedbackSummary: undefined,
              enterpriseReview: null,
              enterpriseLifecycle: {
                stage: "draft",
                stageLabel: "资产草稿",
                nextStep: "补充信息后可共享或提交企业。",
              },
              optimizationTargets: [],
            },
          ],
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("检测到系统诊断原文");
    expect(text).toContain("系统诊断信息已折叠");
    expect(text).toContain("查看原始诊断");
    expect(container.querySelector(".my-accumulation__diag-fold")).not.toBeNull();
  });

  it("disables share and submit on install tab while definition is dirty", () => {
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          detailTab: "install",
          definitionDirty: true,
          selectedCapability: capability({
            isDraft: true,
            incubationReadiness: {
              ready: true,
              admissible: true,
              gaps: [],
              reasons: [],
            },
          }),
        }),
      ),
      container,
    );

    const shareButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("分享到协作小组"),
    );
    const submitButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "提交企业",
    );
    expect(shareButton?.disabled).toBe(true);
    expect(submitButton?.disabled).toBe(true);
    expect(shareButton?.title).toContain("请先保存整理");
  });

  it("installs an owned MCP asset onto the selected robot", () => {
    const onInstallOwnedAssetToRobot = vi.fn();
    const mcp = capability({
      name: "打单参谋",
      assetType: "mcp",
      isDraft: false,
      usage: {
        robots: [],
        totalUsageCount: 0,
        lastUsedAt: null,
      },
    });
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          detailTab: "install",
          installRobots: [
            { id: "bot-skill", name: "Skill孵化" },
            { id: "main", name: "大白管家" },
          ],
          installTargetRobotId: "bot-skill",
          onInstallOwnedAssetToRobot,
          selectedCapability: mcp,
          items: [
            {
              id: mcp.id,
              name: mcp.name,
              summary: mcp.summary,
              assetType: mcp.assetType,
              health: mcp.health,
              shareVisibility: mcp.shareVisibility,
              isDraft: mcp.isDraft,
              recentUpdate: mcp.recentUpdate,
              updatedAt: mcp.updatedAt,
              sourceRobotName: mcp.attribution.sourceRobot.name,
              sourceContextLabel: mcp.sourceContextLabel,
              usageBrief: {
                robotCount: 0,
                lastUsedAt: null,
              },
              usageMetrics: mcp.usageMetrics,
              versionInfo: mcp.versionInfo,
              applicationSummary: mcp.applicationSummary,
              feedbackSummary: mcp.feedbackSummary,
              enterpriseReview: mcp.enterpriseReview,
              enterpriseLifecycle: mcp.enterpriseLifecycle,
              optimizationTargets: mcp.optimizationTargets,
            },
          ],
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("安装到这只机器人");
    expect(text).not.toContain("从平台市场安装");
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (entry) => entry.textContent?.trim() === "安装到这只机器人",
    );
    expect(button).toBeTruthy();
    button?.click();
    expect(onInstallOwnedAssetToRobot).toHaveBeenCalledWith(mcp.id, "bot-skill");
  });

  it("does not offer owned robot install for draft assets", () => {
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          detailTab: "install",
          installRobots: [{ id: "bot-skill", name: "Skill孵化" }],
          onInstallOwnedAssetToRobot: vi.fn(),
          selectedCapability: capability({
            assetType: "mcp",
            isDraft: true,
          }),
        }),
      ),
      container,
    );
    expect(container.textContent).toContain("草稿或知识资产不能直接装到机器人");
    expect(container.textContent).not.toContain("安装到这只机器人");
  });

  it("passes terminology blacklist scan", () => {
    const container = document.createElement("div");
    render(renderMyAccumulation(props()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("1.0.0");
    expect(scanNode(container)).toBeUndefined();
  });

  it("keeps review and digest suggestions out of the asset list", () => {
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          selectedCapability: null,
          items: [],
          assetReviewSuggestions: [
            {
              fingerprint: "fp-structured",
              label: "结构化任务",
              summary: "结构化任务 66 次",
              recurrenceCount: 66,
              suggestedAssetType: "workflow",
            },
            {
              fingerprint: "fp-knowledge",
              label: "知识/报告产出",
              summary: "知识/报告产出 17 次",
              recurrenceCount: 17,
              suggestedAssetType: "capability",
            },
          ],
          assetWeeklyDigest: {
            weekKey: "2026-W37",
            headline: "本周识别到 2 个可整理模式",
            entries: [
              {
                id: "digest-1",
                kind: "review",
                label: "结构化任务",
                summary: "重复出现的任务结构可整理成流程",
              },
            ],
          },
          onAcceptAssetReviewSuggestion: vi.fn(),
          onDismissAssetReviewSuggestion: vi.fn(),
          onDismissWeeklyDigest: vi.fn(),
        }),
      ),
      container,
    );

    const rail = container.querySelector(".my-accumulation__suggestions");
    const list = container.querySelector(".my-accumulation__list");
    expect(rail?.textContent).toContain("整理建议");
    expect(rail?.textContent).toContain("可整理的工作模式");
    expect(rail?.textContent).toContain("结构化任务");
    expect(rail?.textContent).toContain("1 项建议");
    expect(rail?.textContent).not.toContain("知识/报告产出");
    expect(rail?.textContent).toContain("本周资产回顾");
    expect(rail?.querySelectorAll(".my-accumulation__suggestion")).toHaveLength(2);
    expect(list?.textContent).toContain("还没有可安装的资产");
    expect(list?.textContent).not.toContain("可整理的工作模式");
    expect(list?.textContent).not.toContain("本周资产回顾");
    expect(list?.querySelector(".my-accumulation__item")).toBeNull();
  });

  it("lets every lifecycle tab filter the list", () => {
    const reviewing = {
      ...props().items[0],
      id: "cap-review",
      name: "审核中的周报",
      isDraft: false,
      shareVisibility: "审核中" as const,
    };
    const registered = {
      ...props().items[0],
      id: "cap-ent",
      name: "已入企业的周报",
      isDraft: false,
      shareVisibility: "已进入企业资产库" as const,
    };
    const optimize = {
      ...props().items[0],
      id: "cap-opt",
      name: "需要优化的周报",
      isDraft: false,
      shareVisibility: "需要修改后再次提交" as const,
      health: "需要重新整理" as const,
    };
    const onChangeSegment = vi.fn();
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          selectedCapability: null,
          items: [reviewing, registered, optimize],
          onChangeSegment,
          assetReviewSuggestions: [
            {
              fingerprint: "fp-1",
              label: "结构化任务",
              summary: "结构化任务 66 次",
              recurrenceCount: 66,
              suggestedAssetType: "workflow",
            },
          ],
        }),
      ),
      container,
    );

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".my-accumulation__segment"),
    );
    expect(tabs.map((tab) => tab.textContent?.replace(/\s+/g, ""))).toEqual([
      "全部3",
      "草稿0",
      "审核中1",
      "已入企业1",
      "需优化1",
    ]);
    expect(container.textContent).toContain("整理建议");

    tabs.find((tab) => tab.textContent?.includes("审核中"))?.click();
    expect(onChangeSegment).toHaveBeenCalledWith("reviewing");

    render(
      renderMyAccumulation(
        props({
          selectedCapability: null,
          activeSegment: "reviewing",
          items: [reviewing, registered, optimize],
          onChangeSegment,
          assetReviewSuggestions: [
            {
              fingerprint: "fp-1",
              label: "结构化任务",
              summary: "结构化任务 66 次",
              recurrenceCount: 66,
              suggestedAssetType: "workflow",
            },
          ],
        }),
      ),
      container,
    );
    expect(container.textContent).toContain("审核中的周报");
    expect(container.textContent).not.toContain("已入企业的周报");
    expect(container.textContent).not.toContain("可整理的工作模式");
  });

  it("shows at most three non-knowledge review suggestions", () => {
    const container = document.createElement("div");
    render(
      renderMyAccumulation(
        props({
          selectedCapability: null,
          items: [],
          assetReviewSuggestions: [
            {
              fingerprint: "knowledge-article",
              label: "知识/报告产出",
              summary: "知识/报告产出 17 次",
              recurrenceCount: 17,
              suggestedAssetType: "template",
            },
            {
              fingerprint: "structured-output",
              label: "结构化任务",
              summary: "结构化任务 8 次",
              recurrenceCount: 8,
              suggestedAssetType: "capability",
            },
            {
              fingerprint: "competitive-analysis",
              label: "竞品分析",
              summary: "竞品分析 6 次",
              recurrenceCount: 6,
              suggestedAssetType: "workflow",
            },
            {
              fingerprint: "customer-interview",
              label: "客户访谈整理",
              summary: "客户访谈整理 5 次",
              recurrenceCount: 5,
              suggestedAssetType: "workflow",
            },
            {
              fingerprint: "prd",
              label: "产品需求文档",
              summary: "产品需求文档 4 次",
              recurrenceCount: 4,
              suggestedAssetType: "template",
            },
          ],
          onAcceptAssetReviewSuggestion: vi.fn(),
          onDismissAssetReviewSuggestion: vi.fn(),
        }),
      ),
      container,
    );

    const rail = container.querySelector(".my-accumulation__suggestions");
    expect(rail?.textContent).toContain("3 项建议");
    expect(rail?.textContent).toContain("结构化任务");
    expect(rail?.textContent).toContain("竞品分析");
    expect(rail?.textContent).toContain("客户访谈整理");
    expect(rail?.textContent).not.toContain("知识/报告产出");
    expect(rail?.textContent).not.toContain("产品需求文档");
    expect(rail?.querySelectorAll(".my-accumulation__suggestion-row")).toHaveLength(3);
  });
});

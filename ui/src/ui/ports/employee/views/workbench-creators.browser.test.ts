/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  renderWorkbenchAgentCreatorDrawer,
  renderWorkbenchSpaceCreatorDrawer,
} from "./workbench-creators.ts";
import { emptyWorkbenchAgentDesignState } from "./workbench-design-card.ts";
import type { WorkbenchAgentCreatorState, WorkbenchSpaceCreatorState } from "./workbench-types.ts";

function createAgentCreatorState(
  overrides: Partial<WorkbenchAgentCreatorState> = {},
): WorkbenchAgentCreatorState {
  return {
    open: true,
    busy: false,
    error: null,
    name: "",
    emoji: "",
    design: emptyWorkbenchAgentDesignState(),
    templateId: "generic_worker",
    templates: [
      { templateId: "generic_worker", displayName: "通用助手", description: "" },
      { templateId: "sales_assistant", displayName: "销售助理机器人", description: "" },
    ],
    templatesLoading: false,
    workspaceKind: "local",
    localPath: "/Users/test/workspace",
    localValidation: {
      state: "valid",
      message: null,
      resolvedPath: "/Users/test/workspace",
      readable: true,
      writable: true,
    },
    localDirectoryBrowser: null,
    cloudProvider: "aliyun-oss",
    cloudRegion: "",
    cloudBucket: "",
    cloudRootPrefix: "",
    cloudEndpoint: "",
    cloudAccountName: "",
    cloudAccessKeyId: "",
    cloudSecretAccessKey: "",
    cloudGeneratedConfig: null,
    cloudConnection: {
      state: "idle",
      message: null,
      canRead: false,
      canWrite: false,
    },
    cloudDirectoryBrowser: null,
    cloudSelectedPath: "",
    ...overrides,
  };
}

function createSpaceCreatorState(
  overrides: Partial<WorkbenchSpaceCreatorState> = {},
): WorkbenchSpaceCreatorState {
  return {
    open: true,
    busy: false,
    error: null,
    title: "",
    avatar: "🛰️",
    purpose: "",
    currentMission: "",
    systemInstructions: "",
    groupId: "",
    step: "details",
    candidateHumans: [],
    candidateBots: [],
    selectedHumanIds: [],
    selectedBotIds: [],
    coordinatorBotId: "",
    ...overrides,
  };
}

function renderAgentCreator(
  state: WorkbenchAgentCreatorState,
  overrides: Partial<Parameters<typeof renderWorkbenchAgentCreatorDrawer>[0]> = {},
) {
  const container = document.createElement("div");
  render(
    renderWorkbenchAgentCreatorDrawer({
      state,
      onClose: vi.fn(),
      onNameChange: vi.fn(),
      onEmojiChange: vi.fn(),
      onTemplateChange: vi.fn(),
      onWorkspaceKindChange: vi.fn(),
      onLocalPathChange: vi.fn(),
      onValidateLocalWorkspace: vi.fn(),
      onOpenLocalBrowser: vi.fn(),
      onCloseLocalBrowser: vi.fn(),
      onNavigateLocalBrowser: vi.fn(),
      onSelectLocalDirectory: vi.fn(),
      onCloudProviderChange: vi.fn(),
      onCloudRegionChange: vi.fn(),
      onCloudBucketChange: vi.fn(),
      onCloudRootPrefixChange: vi.fn(),
      onCloudEndpointChange: vi.fn(),
      onCloudAccountNameChange: vi.fn(),
      onCloudAccessKeyIdChange: vi.fn(),
      onCloudSecretAccessKeyChange: vi.fn(),
      onGenerateCloudConfig: vi.fn(),
      onTestCloudConnection: vi.fn(),
      onOpenCloudBrowser: vi.fn(),
      onCloseCloudBrowser: vi.fn(),
      onNavigateCloudBrowser: vi.fn(),
      onSelectCloudDirectory: vi.fn(),
      onSubmit: vi.fn(),
      ...overrides,
    }),
    container,
  );
  return container;
}

describe("workbench-creators", () => {
  it("renders agent creator as in-place panel without backdrop overlay", () => {
    const container = renderAgentCreator(createAgentCreatorState());

    expect(container.querySelector(".employee-workbench__creator-panel")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__creator-panel--flat")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__creator-backdrop")).toBeNull();
    expect(container.textContent).not.toContain("AI 助理");
    expect(container.textContent).not.toContain("返回 AI 助手");
    expect(container.textContent).toContain("新建数字员工");
    expect(container.textContent).toContain("1. 描述需求");
    expect(container.textContent).toContain("生成设计");
    expect(container.textContent).toContain("从模板开始");
    expect(container.querySelector(".employee-workbench__creator-wizard-main")).not.toBeNull();
    expect(
      container
        .querySelector(".employee-workbench__creator-step-pill.is-active")
        ?.getAttribute("aria-current"),
    ).toBe("step");
    expect(container.textContent).not.toContain("选择角色模板");
    expect(container.textContent).not.toContain("通用助手");
    expect(
      container
        .querySelector(".employee-workbench__creator-panel-back")
        ?.getAttribute("aria-label"),
    ).toBe("返回");
  });

  it("enables create on managed workspace after switching to the template path", () => {
    const container = renderAgentCreator(
      createAgentCreatorState({
        name: "托管助手",
        managedWorkspace: true,
        step: "identity",
        roleSource: "template",
        localPath: "",
        localValidation: {
          state: "idle",
          message: null,
          resolvedPath: null,
          readable: false,
          writable: false,
        },
      }),
    );

    expect(container.textContent).toContain("由 OpenBot 自动管理");
    expect(container.textContent).toContain("选择角色模板");
    const submit = container.querySelector("button.primary[data-creator-primary='create']");
    expect((submit as HTMLButtonElement | null)?.disabled).toBe(false);
  });

  it("shows the confirmation mapping on the review step and uses a single confirm action", () => {
    const design = emptyWorkbenchAgentDesignState();
    design.intentText = "创建销售助理";
    design.canConfirm = true;
    design.mapping = {
      headline: "我理解的是…",
      requestItems: [{ label: "职责", text: "客户跟进" }],
      role: {
        display: "sales_assistant",
        resolutionKind: "published",
        blueprintId: "sales_assistant",
        evidence: ["销售助理"],
      },
      capabilities: [{ need: "sales-coach", status: "resolved", skillKey: "sales-coach" }],
      workMode: { taskPatterns: ["客户跟进"] },
      safetyBoundary: [{ id: "crm.write", effect: "disabled", risk: "high" }],
      gaps: { questions: [], missing: [], unresolved: [] },
    };
    const container = renderAgentCreator(createAgentCreatorState({ name: "销售助理", design }), {
      onCompileDesign: vi.fn(),
      onConfirmDesign: vi.fn(),
    });
    expect(container.textContent).toContain("2. 校对设计");
    expect(container.textContent).toContain("我理解的是…");
    expect(container.textContent).toContain("销售与客户");
    expect(container.textContent).toContain("销售助理");
    expect(container.textContent).toContain("销售辅导");
    expect(container.textContent).toContain("禁止改写客户资料");
    expect(container.textContent).toContain("改用预设模板");
    expect(container.textContent).not.toContain("用一句话调整");
    expect(container.textContent).not.toContain("crm.write");
    expect(container.textContent).not.toMatch(/我猜/);
    expect(container.querySelector(".employee-workbench__tag-card")).not.toBeNull();
    expect(container.querySelector("button.employee-workbench__tag-card-remove")).not.toBeNull();
    const wizardMain = container.querySelector(".employee-workbench__creator-wizard-main");
    const footer = container.querySelector(".employee-workbench__creator-actions");
    expect(wizardMain).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(
      Boolean(
        wizardMain &&
        footer &&
        (wizardMain.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      ),
    ).toBe(true);
    expect(container.textContent).not.toContain("选择角色模板");
    expect(
      container.querySelector("button.primary[data-creator-primary='confirm']")?.textContent,
    ).toContain("确认并继续");
    expect(container.querySelector("button.primary[data-creator-primary='create']")).toBeNull();
  });

  it("hides the template picker after AI design and only shows it on the template path", () => {
    const design = emptyWorkbenchAgentDesignState();
    design.confirmed = true;
    design.mapping = {
      headline: "我理解的是…",
      requestItems: [],
      role: {
        display: "销售助理",
        resolutionKind: "published",
        blueprintId: "sales_assistant",
        evidence: [],
      },
      capabilities: [{ need: "summarize", status: "resolved", skillKey: "summarize" }],
      workMode: { taskPatterns: [] },
      safetyBoundary: [],
      gaps: { questions: [], missing: [], unresolved: [] },
    };
    const aiContainer = renderAgentCreator(
      createAgentCreatorState({
        name: "销售助理",
        step: "identity",
        roleSource: "ai",
        design,
      }),
    );
    expect(aiContainer.textContent).toContain("创建机器人");
    expect(aiContainer.textContent).not.toContain("选择角色模板");
    expect(aiContainer.textContent).toContain("摘要整理");

    const templateContainer = renderAgentCreator(
      createAgentCreatorState({
        name: "通用助手",
        step: "identity",
        roleSource: "template",
      }),
    );
    expect(templateContainer.textContent).toContain("选择角色模板");
  });

  it("renders space creator as wide in-place panel with back anchor", () => {
    const container = document.createElement("div");
    render(
      renderWorkbenchSpaceCreatorDrawer({
        state: createSpaceCreatorState(),
        onClose: vi.fn(),
        onTitleChange: vi.fn(),
        onAvatarChange: vi.fn(),
        onPurposeChange: vi.fn(),
        onCurrentMissionChange: vi.fn(),
        onSystemInstructionsChange: vi.fn(),
        onGroupIdChange: vi.fn(),
        onBack: vi.fn(),
        onToggleHumanSelection: vi.fn(),
        onToggleBotSelection: vi.fn(),
        onCoordinatorChange: vi.fn(),
        onSubmit: vi.fn(),
      }),
      container,
    );

    expect(container.querySelector(".employee-workbench__creator-panel--wide")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__creator-panel--flat")).not.toBeNull();
    expect(container.querySelector(".employee-workbench__creator-backdrop")).toBeNull();
    expect(container.textContent).not.toContain("返回协作空间");
    expect(container.textContent).toContain("新建协作空间");
    expect(container.querySelector(".employee-workbench__creator-panel-kicker")).toBeNull();
    expect(
      container
        .querySelector(".employee-workbench__creator-panel-back")
        ?.getAttribute("aria-label"),
    ).toBe("返回");
  });
});

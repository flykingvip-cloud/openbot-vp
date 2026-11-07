// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderMyBotWorkspacePanel } from "./my-bot-workspace-panel.ts";
import type { MyBotWorkspacePanelProps } from "./my-bot-workspace-panel.ts";

function panel(snapshot: MyBotWorkspacePanelProps["userOperationalIdentitySnapshot"]): HTMLElement {
  const container = document.createElement("div");
  render(
    renderMyBotWorkspacePanel({
      entry: {
        id: "bot-a",
        sessionKey: "s",
        name: "项目助手",
        emoji: null,
        source: "owned",
        status: "running",
      },
      loading: false,
      error: null,
      saving: false,
      bot: null,
      identityDraft: null,
      activeTab: "auth",
      onTabChange: () => undefined,
      onIdentityDraftChange: () => undefined,
      onSaveIdentity: () => undefined,
      onExploreCapabilities: () => undefined,
      onOpenGroup: () => undefined,
      onSelectSession: () => undefined,
      userOperationalIdentitySnapshot: snapshot,
      onLoadRobotEnterpriseIdentities: () => undefined,
    }),
    container,
  );
  return container;
}

const bound = {
  identityId: "feishu-employee.001.emp-a.ou_a",
  provider: "feishu-personal",
  providerLabel: "飞书",
  displayName: "飞书 ou_a",
  status: "active" as const,
  grantCount: 0,
  createdAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z",
  enterpriseIm: {
    channel: "feishu" as const,
    accountId: "t_001_default",
    platformEnterpriseId: "tenant-key-1",
    platformUserId: "ou_a",
    userGrantedScopes: ["im:message"],
    authorizationLevel: "authorized" as const,
    localCredentialsDeleted: false,
    platformRevokeRecorded: false,
    statusLabel: "已授权",
  },
};

describe("robot operational auth Feishu checkbox", () => {
  it("hides Feishu when the enterprise channel is closed or the identity is unbound", () => {
    const closed = panel({
      identities: [bound],
      grants: [],
      usageHistory: [],
      pendingBindingRequests: [],
      providerCatalog: [],
      enterpriseAccessByAgent: { "bot-a": [] },
      feishuEmployeeChannel: {
        accountId: "t_001_default",
        employeeUiHint: "enterprise_not_open",
        loginEnabled: false,
        statusLabel: "企业尚未开通",
        platformEnterpriseId: null,
        childExecutionBlocked: true,
      },
    });
    expect(closed.querySelector("[data-provider='feishu-personal']")).toBeNull();
    const unbound = panel({
      identities: [],
      grants: [],
      usageHistory: [],
      pendingBindingRequests: [],
      providerCatalog: [],
      enterpriseAccessByAgent: { "bot-a": [] },
      feishuEmployeeChannel: {
        accountId: "t_001_default",
        employeeUiHint: "app_can_attempt",
        loginEnabled: true,
        statusLabel: "可绑定",
        platformEnterpriseId: "tenant-key-1",
        childExecutionBlocked: false,
      },
    });
    expect(unbound.querySelector("[data-provider='feishu-personal']")).toBeNull();
  });

  it("shows the bound Feishu identity under 企业身份 and confirms through the personal grant API", () => {
    const onApplyRobotIdentityGrants = vi.fn();
    const onApplyRobotEnterpriseIdentities = vi.fn();
    const container = document.createElement("div");
    render(
      renderMyBotWorkspacePanel({
        entry: {
          id: "bot-a",
          sessionKey: "s",
          name: "项目助手",
          emoji: null,
          source: "owned",
          status: "running",
        },
        loading: false,
        error: null,
        saving: false,
        bot: null,
        identityDraft: null,
        activeTab: "auth",
        onTabChange: () => undefined,
        onIdentityDraftChange: () => undefined,
        onSaveIdentity: () => undefined,
        onExploreCapabilities: () => undefined,
        onOpenGroup: () => undefined,
        onSelectSession: () => undefined,
        onApplyRobotIdentityGrants,
        onApplyRobotEnterpriseIdentities,
        onLoadRobotEnterpriseIdentities: () => undefined,
        userOperationalIdentitySnapshot: {
          identities: [bound],
          grants: [],
          usageHistory: [],
          pendingBindingRequests: [],
          providerCatalog: [
            {
              provider: "feishu-personal",
              label: "飞书",
              category: "communication",
              rolloutTier: "deferred",
              registrationReady: false,
              authMode: "oauth",
              operationalActions: [
                { action: "read", label: "读取" },
                { action: "draft", label: "起草" },
                { action: "send", label: "发送" },
              ],
              reauthHint: "",
              degradedHint: null,
            },
          ],
          enterpriseAccessByAgent: { "bot-a": [] },
          feishuEmployeeChannel: {
            accountId: "t_001_default",
            employeeUiHint: "app_can_attempt",
            loginEnabled: true,
            statusLabel: "可绑定",
            platformEnterpriseId: "tenant-key-1",
            childExecutionBlocked: false,
          },
        },
      }),
      container,
    );
    const box = container.querySelector<HTMLInputElement>("[data-provider='feishu-personal']");
    expect(box).not.toBeNull();
    expect(box?.closest(".wb-bots__auth")?.textContent).toContain("企业身份");
    expect(container.querySelector("[data-kind='personal']")).toBeNull();
    expect(box?.getAttribute("data-actions")).toBeNull();
    box!.checked = true;
    const row = box!.closest("li");
    row!.querySelector<HTMLInputElement>("[data-feishu-action='read']")!.checked = true;
    row!.querySelector<HTMLInputElement>("[data-feishu-action='send']")!.checked = true;
    row!.querySelector<HTMLSelectElement>("[data-feishu-confirm-mode]")!.value = "limited_auto";
    row!.querySelector<HTMLInputElement>("[data-feishu-groups]")!.value = "oc_group";
    row!.querySelector<HTMLInputElement>("[data-feishu-docs]")!.value = "docx_1";
    row!.querySelector<HTMLInputElement>("[data-feishu-expires]")!.value =
      "2026-12-01T00:00:00.000Z";
    container.querySelector<HTMLButtonElement>(".btn.btn--primary")?.click();
    expect(onApplyRobotIdentityGrants).toHaveBeenCalledWith({
      agentId: "bot-a",
      agentScope: "owned",
      desired: [
        {
          identityId: bound.identityId,
          allowedActions: ["read", "send"],
          resourceScope: { groups: ["oc_group"], docs: ["docx_1"], calendars: [] },
          confirmMode: "limited_auto",
          expiresAt: "2026-12-01T00:00:00.000Z",
        },
      ],
    });
    expect(onApplyRobotEnterpriseIdentities).toHaveBeenCalledWith({
      agentId: "bot-a",
      desiredIdentityIds: [],
    });
  });

  it("lets two robots submit different Feishu action sets", () => {
    const project = vi.fn();
    const knowledge = vi.fn();
    const snapshot = {
      identities: [bound],
      grants: [],
      usageHistory: [],
      pendingBindingRequests: [],
      providerCatalog: [],
      enterpriseAccessByAgent: { project: [], knowledge: [] },
      feishuEmployeeChannel: {
        accountId: "t_001_default",
        employeeUiHint: "app_can_attempt" as const,
        loginEnabled: true,
        statusLabel: "可绑定",
        platformEnterpriseId: "tenant-key-1",
        childExecutionBlocked: false,
      },
    };
    const renderRobot = (agentId: string, onApply: (input: unknown) => void) => {
      const container = document.createElement("div");
      render(
        renderMyBotWorkspacePanel({
          entry: {
            id: agentId,
            sessionKey: "s",
            name: agentId,
            emoji: null,
            source: "owned",
            status: "running",
          },
          loading: false,
          error: null,
          saving: false,
          bot: null,
          identityDraft: null,
          activeTab: "auth",
          onTabChange: () => undefined,
          onIdentityDraftChange: () => undefined,
          onSaveIdentity: () => undefined,
          onExploreCapabilities: () => undefined,
          onOpenGroup: () => undefined,
          onSelectSession: () => undefined,
          onApplyRobotIdentityGrants: onApply,
          onApplyRobotEnterpriseIdentities: () => undefined,
          onLoadRobotEnterpriseIdentities: () => undefined,
          userOperationalIdentitySnapshot: snapshot,
        }),
        container,
      );
      return container;
    };
    const projectView = renderRobot("project", project);
    const projectBox = projectView.querySelector<HTMLInputElement>(
      "[data-provider='feishu-personal']",
    )!;
    projectBox.checked = true;
    projectBox
      .closest("li")!
      .querySelector<HTMLInputElement>("[data-feishu-action='send']")!.checked = true;
    projectBox
      .closest("li")!
      .querySelector<HTMLSelectElement>("[data-feishu-confirm-mode]")!.value = "limited_auto";
    projectView.querySelector<HTMLButtonElement>(".btn.btn--primary")?.click();

    const knowledgeView = renderRobot("knowledge", knowledge);
    const knowledgeBox = knowledgeView.querySelector<HTMLInputElement>(
      "[data-provider='feishu-personal']",
    )!;
    knowledgeBox.checked = true;
    knowledgeBox
      .closest("li")!
      .querySelector<HTMLInputElement>("[data-feishu-action='read']")!.checked = true;
    knowledgeBox
      .closest("li")!
      .querySelector<HTMLInputElement>("[data-feishu-action='draft']")!.checked = true;
    knowledgeView.querySelector<HTMLButtonElement>(".btn.btn--primary")?.click();

    const projectActions = project.mock.calls[0]?.[0].desired[0].allowedActions;
    const knowledgeActions = knowledge.mock.calls[0]?.[0].desired[0].allowedActions;
    expect(projectActions).toEqual(["send"]);
    expect(knowledgeActions).toEqual(["read", "draft"]);
    expect(project.mock.calls[0]?.[0].agentId).toBe("project");
    expect(knowledge.mock.calls[0]?.[0].agentId).toBe("knowledge");
  });

  it("submits and redisplays send with draft_then_confirm", () => {
    const onApplyRobotIdentityGrants = vi.fn();
    const container = document.createElement("div");
    const base = {
      entry: {
        id: "bot-a",
        sessionKey: "s",
        name: "项目助手",
        emoji: null,
        source: "owned" as const,
        status: "running" as const,
      },
      loading: false,
      error: null,
      saving: false,
      bot: null,
      identityDraft: null,
      activeTab: "auth" as const,
      onTabChange: () => undefined,
      onIdentityDraftChange: () => undefined,
      onSaveIdentity: () => undefined,
      onExploreCapabilities: () => undefined,
      onOpenGroup: () => undefined,
      onSelectSession: () => undefined,
      onApplyRobotIdentityGrants,
      onApplyRobotEnterpriseIdentities: () => undefined,
      onLoadRobotEnterpriseIdentities: () => undefined,
    };
    render(
      renderMyBotWorkspacePanel({
        ...base,
        userOperationalIdentitySnapshot: {
          identities: [bound],
          grants: [],
          usageHistory: [],
          pendingBindingRequests: [],
          providerCatalog: [],
          enterpriseAccessByAgent: { "bot-a": [] },
          feishuEmployeeChannel: {
            accountId: "t_001_default",
            employeeUiHint: "app_can_attempt",
            loginEnabled: true,
            statusLabel: "可绑定",
            platformEnterpriseId: "tenant-key-1",
            childExecutionBlocked: false,
          },
        },
      }),
      container,
    );
    const box = container.querySelector<HTMLInputElement>("[data-provider='feishu-personal']")!;
    box.checked = true;
    const row = box.closest("li")!;
    row.querySelector<HTMLInputElement>("[data-feishu-action='draft']")!.checked = true;
    row.querySelector<HTMLInputElement>("[data-feishu-action='send']")!.checked = true;
    const mode = row.querySelector<HTMLSelectElement>("[data-feishu-confirm-mode]")!;
    expect(mode.value).toBe("draft_then_confirm");
    container.querySelector<HTMLButtonElement>(".btn.btn--primary")?.click();
    expect(onApplyRobotIdentityGrants).toHaveBeenCalledWith(
      expect.objectContaining({
        desired: [
          expect.objectContaining({
            allowedActions: ["draft", "send"],
            confirmMode: "draft_then_confirm",
          }),
        ],
      }),
    );

    render(
      renderMyBotWorkspacePanel({
        ...base,
        userOperationalIdentitySnapshot: {
          identities: [bound],
          grants: [
            {
              grantId: "g-send-confirm",
              identityId: bound.identityId,
              agentId: "bot-a",
              agentScope: "owned",
              allowedActions: ["draft", "send"],
              grantMode: "explicit",
              status: "active",
              confirmMode: "draft_then_confirm",
            },
          ],
          usageHistory: [],
          pendingBindingRequests: [],
          providerCatalog: [],
          enterpriseAccessByAgent: { "bot-a": [] },
          feishuEmployeeChannel: {
            accountId: "t_001_default",
            employeeUiHint: "app_can_attempt",
            loginEnabled: true,
            statusLabel: "可绑定",
            platformEnterpriseId: "tenant-key-1",
            childExecutionBlocked: false,
          },
        },
      }),
      container,
    );
    const shown = container.querySelector<HTMLInputElement>("[data-feishu-action='send']")!;
    const shownMode = container.querySelector<HTMLSelectElement>("[data-feishu-confirm-mode]")!;
    expect(shown.checked).toBe(true);
    expect(shownMode.value).toBe("draft_then_confirm");
    expect(shownMode.value).not.toBe("limited_auto");
    expect(container.textContent).toContain("起草后确认");
  });
});

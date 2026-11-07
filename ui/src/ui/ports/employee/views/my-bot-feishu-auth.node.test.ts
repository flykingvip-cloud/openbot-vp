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
    box!.checked = true;
    container.querySelector<HTMLButtonElement>(".btn.btn--primary")?.click();
    expect(onApplyRobotIdentityGrants).toHaveBeenCalledWith({
      agentId: "bot-a",
      agentScope: "owned",
      desired: [
        {
          identityId: bound.identityId,
          allowedActions: ["read", "draft", "send"],
        },
      ],
    });
    expect(onApplyRobotEnterpriseIdentities).toHaveBeenCalledWith({
      agentId: "bot-a",
      desiredIdentityIds: [],
    });
  });
});

// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderProviderIdentityEditorForm } from "./workbench-operational-identity-forms.ts";
import { renderPersonalAuthorizationPanel } from "./workbench-personal-authorization-panel.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

function settings(statusLabel: string, loginEnabled: boolean): SettingsContract {
  return {
    userOperationalIdentityNav: "add:feishu-personal",
    userOperationalIdentityEditorProvider: "feishu-personal",
    userOperationalIdentityEditorDisplayName: "",
    userOperationalIdentitySnapshot: {
      identities: [],
      grants: [],
      usageHistory: [],
      pendingBindingRequests: [],
      providerCatalog: [
        {
          provider: "feishu-personal",
          label: "飞书个人账号",
          category: "communication",
          rolloutTier: "deferred",
          registrationReady: false,
          authMode: "oauth",
          operationalActions: [],
          reauthHint: "",
          degradedHint: null,
        },
      ],
      feishuEmployeeChannel: {
        accountId: "t_001_default",
        employeeUiHint: loginEnabled
          ? "app_can_attempt"
          : statusLabel === "等待管理员开通权限"
            ? "waiting_admin_scopes"
            : "enterprise_not_open",
        loginEnabled,
        statusLabel,
        platformEnterpriseId: loginEnabled ? "tenant-key-1" : null,
        childExecutionBlocked: !loginEnabled && statusLabel === "企业尚未开通",
      },
    },
  } as unknown as SettingsContract;
}

describe("feishu employee authorization row", () => {
  it.each(["企业尚未开通", "等待管理员开通权限"] as const)(
    "shows %s and does not offer App ID or bind",
    (statusLabel) => {
      const container = document.createElement("div");
      render(renderProviderIdentityEditorForm(settings(statusLabel, false)), container);
      expect(container.textContent).toContain(statusLabel);
      expect(container.querySelector("input")).toBeNull();
      expect(container.querySelector("button.btn--primary")).toBeNull();
    },
  );

  it("displays the list projection for a bound row", () => {
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
    const show = (statusLabel: string, loginEnabled: boolean) => {
      const view = settings(loginEnabled ? "可绑定" : statusLabel, loginEnabled);
      view.userOperationalIdentitySnapshot = {
        ...view.userOperationalIdentitySnapshot!,
        identities: [
          {
            ...bound,
            status: statusLabel === "需重新认证" ? "reauth_required" : "active",
            enterpriseIm: { ...bound.enterpriseIm, statusLabel },
          },
        ],
      };
      const container = document.createElement("div");
      render(renderProviderIdentityEditorForm(view), container);
      expect(container.querySelector("[data-feishu-employee-status]")?.textContent).toContain(
        statusLabel,
      );
      expect(container.querySelector("input[type='password']")).toBeNull();
      return container;
    };
    expect(show("企业尚未开通", false).textContent).not.toContain("已授权");
    expect(show("等待管理员开通权限", false).textContent).not.toContain("已授权");
    const reauth = show("需重新认证", true);
    expect(reauth.textContent).toContain("重新认证");
    expect(reauth.textContent).not.toContain("已授权");
  });

  it("offers bind without app credentials when the enterprise app can attempt the checklist", () => {
    const container = document.createElement("div");
    render(renderPersonalAuthorizationPanel(settings("可绑定", true)), container);
    expect(container.textContent).toContain("飞书");
    render(renderProviderIdentityEditorForm(settings("可绑定", true)), container);
    expect(container.textContent).toContain("绑定");
    expect(container.querySelector("input[type='password']")).toBeNull();
    expect(container.querySelectorAll("input")).toHaveLength(1);
  });
});

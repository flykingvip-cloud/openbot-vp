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
  } as SettingsContract;
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

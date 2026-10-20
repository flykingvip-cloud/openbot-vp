// @vitest-environment jsdom

import { render } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import { zh_CN } from "../../../../i18n/locales/zh-CN.ts";
import { renderSettingsPage } from "./settings-page.ts";

beforeEach(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

describe("settings-page", () => {
  it("wraps settings with v2 test id and restricted empty state for members", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderSettingsPage({
        client: null,
        tenantId: "tenant-test",
        readModel: { membershipRole: "member" } as never,
        activePanel: "budget",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(container.querySelector('[data-testid="cost-budget-v2-settings-page"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="cost-budget-settings-restricted"]')).toBeTruthy();
  });

  it("shows disconnected hint when admin without gateway client", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderSettingsPage({
        client: null,
        tenantId: "tenant-test",
        readModel: { membershipRole: "enterprise-admin" } as never,
        activePanel: "budget",
        onNavigate: () => {},
        onRefresh: () => {},
      }),
      container,
    );
    expect(container.textContent).toContain("Gateway 未连接");
  });
});

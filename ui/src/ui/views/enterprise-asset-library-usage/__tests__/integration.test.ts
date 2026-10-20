// @vitest-environment jsdom
// Feature: enterprise-capability-usage-management → 已整合进「企业能力中心」
// Cross-module navigation tests after integration.

import { html, render } from "lit-html";
import { describe, expect, it } from "vitest";
import { matchTabRoute, pathForTab } from "../../../navigation.ts";

describe("Cross-module navigation", () => {
  it("pathForTab(enterpriseCapabilityCenter) generates correct URL for capability detail jump", () => {
    const path = pathForTab("enterpriseCapabilityCenter", "/openclaw", {
      tenantId: "acme",
      context: { capabilityId: "cap-001" },
    });
    expect(path).toMatch(/\/enterprise\/acme\/capabilities\/cap-001$/);
  });

  it("deprecated enterpriseUsageManagement tab now resolves to the capability center", () => {
    // 模块已整合：旧 tab 入口落到能力中心根路径。
    const path = pathForTab("enterpriseUsageManagement", "/openclaw", { tenantId: "acme" });
    expect(path).toBe("/openclaw/enterprise/acme/capabilities");
  });

  it("legacy enterpriseAgents tab also resolves to the capability center (compatibility)", () => {
    const path = pathForTab("enterpriseAgents", "/openclaw", { tenantId: "acme" });
    expect(path).toBe("/openclaw/enterprise/acme/capabilities");
  });

  it("old usage-management deep links redirect to capability-center routes", () => {
    expect(matchTabRoute("/enterprise/acme/usage-management/robots")?.tab).toBe(
      "enterpriseCapabilityCenter",
    );
    expect(matchTabRoute("/enterprise/acme/usage-management/analytics")?.context).toMatchObject({
      tenantId: "acme",
      enterpriseCapabilityRoute: "analytics",
    });
    expect(matchTabRoute("/enterprise/acme/usage-management/governance")?.context).toMatchObject({
      tenantId: "acme",
      enterpriseCapabilityRoute: "governance",
    });
    // installs → 能力安装管理
    expect(matchTabRoute("/enterprise/acme/usage-management/installs")?.context).toMatchObject({
      tenantId: "acme",
      enterpriseCapabilityRoute: "install-management",
    });
  });
});

describe("Platform governance link", () => {
  it("Usage governance page renders link to platform governance center", () => {
    const platformLinkHtml = html`
      <a href="/platform/agents" target="_blank" rel="noopener">前往平台资产管理中心查看技术详情</a>
    `;
    const container = document.createElement("div");
    render(platformLinkHtml, container);
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("/platform/agents");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});

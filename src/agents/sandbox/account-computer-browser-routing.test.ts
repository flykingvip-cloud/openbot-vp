import { describe, expect, it } from "vitest";
import {
  applyAccountComputerTurnRoute,
  buildAccountComputerBrowserPendingLines,
  buildAccountComputerBrowserRoutingLines,
  ensureAccountComputerControlTools,
  grantAccountComputerBrowserTool,
  policyExplicitlyDeniesTool,
  resolveAccountComputerWebRoute,
  shouldGrantAccountComputerBrowserTool,
} from "./account-computer-browser-routing.js";
import { DEFAULT_TOOL_ALLOW, DEFAULT_TOOL_DENY } from "./constants.js";
import { isToolAllowed } from "./tool-policy.js";

describe("account computer browser routing", () => {
  it("overrides the sandbox default deny and keeps other denies", () => {
    expect(
      shouldGrantAccountComputerBrowserTool({
        deny: [...DEFAULT_TOOL_DENY],
        sources: {
          allow: { source: "default", key: "tools.sandbox.tools.allow" },
          deny: { source: "default", key: "tools.sandbox.tools.deny" },
        },
      }),
    ).toBe(true);

    const granted = grantAccountComputerBrowserTool({
      allow: [...DEFAULT_TOOL_ALLOW],
      deny: [...DEFAULT_TOOL_DENY],
    });
    expect(isToolAllowed(granted, "browser")).toBe(true);
    expect(isToolAllowed(granted, "web_fetch")).toBe(true);
    expect(isToolAllowed(granted, "web_search")).toBe(true);
    expect(isToolAllowed(granted, "gateway")).toBe(false);

    const fetchDenied = grantAccountComputerBrowserTool({
      allow: ["read"],
      deny: ["web_fetch"],
    });
    expect(isToolAllowed(fetchDenied, "browser")).toBe(true);
    expect(isToolAllowed(fetchDenied, "web_fetch")).toBe(false);
  });

  it("keeps an explicit sandbox deny", () => {
    expect(
      shouldGrantAccountComputerBrowserTool({
        deny: ["browser"],
        sources: {
          allow: { source: "global", key: "tools.sandbox.tools.allow" },
          deny: { source: "global", key: "tools.sandbox.tools.deny" },
        },
      }),
    ).toBe(false);
    expect(
      shouldGrantAccountComputerBrowserTool({
        deny: ["canvas"],
        sources: {
          allow: { source: "agent", key: "agents.list[].tools.sandbox.tools.allow" },
          deny: { source: "agent", key: "agents.list[].tools.sandbox.tools.deny" },
        },
      }),
    ).toBe(true);
  });

  it("reinserts browser, secure_form, and public web tools unless an operator deny lists them", () => {
    const browserTool = { name: "browser" };
    const secureFormTool = { name: "secure_form" };
    const loginTool = { name: "account_computer_login" };
    const webFetchTool = { name: "web_fetch" };
    const webSearchTool = { name: "web_search" };
    const restored = ensureAccountComputerControlTools({
      tools: [{ name: "read" }],
      browserTool,
      secureFormTool,
      loginTool,
      webFetchTool,
      webSearchTool,
    });
    expect(restored.map((tool) => tool.name)).toEqual([
      "read",
      "web_fetch",
      "web_search",
      "browser",
      "secure_form",
      "account_computer_login",
    ]);

    const denied = ensureAccountComputerControlTools({
      tools: [{ name: "read" }],
      browserTool,
      secureFormTool,
      explicitDeny: { browser: true },
    });
    expect(denied.map((tool) => tool.name)).toEqual(["read", "secure_form"]);
    expect(policyExplicitlyDeniesTool({ deny: ["browser"] }, "browser")).toBe(true);
    expect(policyExplicitlyDeniesTool({ allow: ["read"] }, "browser")).toBe(false);
  });

  it("tells the model to use the desktop for login and public tools for open pages", () => {
    const lines = buildAccountComputerBrowserRoutingLines().join("\n");
    expect(lines).toContain('target="sandbox"');
    expect(lines).toContain("web_fetch");
    expect(lines).toContain("web_search");
    expect(lines).toContain("capability_gap:tool:browser-control");
    expect(lines).toContain("secure_form");
    expect(lines).toContain("account_computer_login");
    expect(lines).toContain("Do not ask the user to type a password");
    expect(lines).toContain("offer_save");
    expect(lines).not.toContain("Host browser control: blocked.");
    expect(lines).toContain("Host (this Mac) browser control: blocked.");
    expect(lines).toContain("does NOT limit the Account Computer");
    expect(lines).toContain("browser-scan-proxy");
    expect(lines).toContain("outdated");
    expect(lines).toContain("云电脑");
    expect(lines).toContain("MUST call web_fetch");
    expect(lines).toContain("Do not call browser");
    expect(lines).toContain("你好，请登录");
    expect(lines).toContain("secure_form");
    expect(lines).toContain("提交订单");
    expect(lines).toContain("商品、数量、价格、地址");
    expect(lines).toContain("绝不代付");
    expect(lines).toContain("不确定就停");
    expect(lines).toContain("更多支付");
    expect(lines).toContain("密码支付");
    expect(lines).toContain("立即支付");
    expect(lines).toContain("不要删除、清空购物车或取消订单");
    expect(lines).toContain("capability_gap:tool:browser-navigation-blocked-by-ssrf-policy");
    expect(lines).toContain("snapshot again before using a ref");
    expect(lines).toContain("SKU+size+price");
    expect(lines).toContain("只要最新挑选的这一双");
    expect(lines).toContain("Never blind-toggle checkbox indices");
  });

  it("treats a browser platform error as a cloud-PC fault and retries in place", () => {
    const lines = buildAccountComputerBrowserRoutingLines().join("\n");
    expect(lines).toContain("云电脑故障");
    expect(lines).toContain("引用这一行原因");
    expect(lines).toContain("retry once with navigate");
    expect(lines).toContain("不要让用户改用京东 App 或其他设备");

    const shopping = applyAccountComputerTurnRoute(
      [{ name: "browser" }],
      "帮我在云电脑上购买这个京东商品",
    );
    expect(shopping.turnPrompt).toContain("account_computer_login");
    expect(shopping.turnPrompt).toContain("Do not ask the user to type a password");
    expect(shopping.turnPrompt).toContain("云电脑故障");
    expect(shopping.turnPrompt).toContain("retry once with navigate");
    expect(shopping.turnPrompt).toContain("云电脑还在启动");
    expect(shopping.turnPrompt).toContain("不要让用户改用京东 App 或其他设备");
    expect(shopping.turnPrompt).toContain("SKU+size+price");
    expect(shopping.turnPrompt).toContain("只要最新挑选的这一双");
    expect(shopping.turnPrompt).toContain("更多支付");
    expect(shopping.turnPrompt).toContain("密码支付");
  });

  it("treats a leased desktop without a bridge as starting, not blocked", () => {
    const lines = buildAccountComputerBrowserPendingLines().join("\n");
    expect(lines).toContain("desktop picture can show before control is ready");
    expect(lines).toContain("Do not call the browser tool again this turn");
    expect(lines).not.toContain("Retry the browser tool");
    expect(lines).toContain("capability_gap:tool:browser-control");
    expect(lines).not.toContain("Host browser control: blocked.");
  });

  it("selects web_fetch for a public page and keeps browser for cloud-PC login", () => {
    const publicAsk = "抓取 https://example.com 公开首页标题，不要打开云电脑";
    expect(resolveAccountComputerWebRoute(publicAsk)).toBe("public_fetch");
    const routed = applyAccountComputerTurnRoute(
      [{ name: "read" }, { name: "web_fetch" }, { name: "web_search" }, { name: "browser" }],
      publicAsk,
    );
    expect(routed.tools.map((tool) => tool.name)).toEqual(["read", "web_fetch", "web_search"]);
    expect(routed.turnPrompt).toContain("web_fetch");
    expect(routed.turnPrompt).toContain("Do not call browser");

    const loginAsk = "我需要你直接打开云端电脑，登录京东";
    expect(resolveAccountComputerWebRoute(loginAsk)).toBe("account_computer");
    const login = applyAccountComputerTurnRoute(
      [{ name: "web_fetch" }, { name: "browser" }],
      loginAsk,
    );
    expect(login.tools.map((tool) => tool.name)).toEqual(["web_fetch", "browser"]);
    expect(login.turnPrompt).toContain("你好，请登录");
    expect(login.turnPrompt).toContain("secure_form");
    expect(login.turnPrompt).toContain("提交订单");
    expect(login.turnPrompt).toContain("更多支付");
    expect(login.turnPrompt).toContain("电脑");

    expect(resolveAccountComputerWebRoute("https://example.com/doc")).toBe("unspecified");
    expect(resolveAccountComputerWebRoute("查询知识库里的登录方式")).toBe("account_computer");
  });
});

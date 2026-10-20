import { beforeEach, describe, expect, it, vi } from "vitest";

const browserActionsMocks = vi.hoisted(() => ({
  browserAct: vi.fn(async (..._args: unknown[]) => ({ ok: true, targetId: "t1" })),
  browserArmDialog: vi.fn(async () => ({ ok: true })),
  browserArmFileChooser: vi.fn(async () => ({ ok: true })),
  browserNavigate: vi.fn(async () => ({ ok: true })),
  browserPdfSave: vi.fn(async () => ({ ok: true, path: "/tmp/test.pdf" })),
  browserScreenshotAction: vi.fn(async () => ({ ok: true, path: "/tmp/test.png" })),
}));
vi.mock("../../browser/client-actions.js", () => browserActionsMocks);

const browserClientMocks = vi.hoisted(() => ({
  browserCloseTab: vi.fn(async () => ({})),
  browserFocusTab: vi.fn(async () => ({})),
  browserOpenTab: vi.fn(async () => ({})),
  browserProfiles: vi.fn(async () => []),
  browserSnapshot: vi.fn(async () => ({
    ok: true,
    format: "aria",
    targetId: "t1",
    url: "https://shop.example/item",
    nodes: [
      { ref: "e1", role: "button", name: "加入购物车", depth: 0 },
      { ref: "e2", role: "button", name: "去结算", depth: 0 },
      { ref: "pay", role: "button", name: "立即支付", depth: 0 },
    ],
  })),
  browserStart: vi.fn(async () => ({})),
  browserStatus: vi.fn(async () => ({ running: true, enabled: true })),
  browserStop: vi.fn(async () => ({})),
  browserTabs: vi.fn(async () => []),
}));
vi.mock("../../browser/client.js", () => browserClientMocks);

vi.mock("../../browser/config.js", () => ({
  resolveBrowserConfig: () => ({ enabled: true }),
}));
vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ gateway: { nodes: { browser: { mode: "off" } } }, browser: {} }),
  resolveConfigPath: () => "/tmp/openbot.json",
}));
vi.mock("../../browser/account-browser-namespace.js", () => ({
  assertNoClientBrowserProfileOverride: () => undefined,
  isMultitenantManagedBrowser: () => false,
}));
vi.mock("./nodes-utils.js", async () => {
  const actual = await vi.importActual<typeof import("./nodes-utils.js")>("./nodes-utils.js");
  return {
    ...actual,
    listNodes: vi.fn(async () => []),
  };
});
vi.mock("./gateway.js", () => ({
  callGatewayTool: vi.fn(),
}));

import { createBrowserTool } from "./browser-tool.js";

describe("browser tool plan_once wiring", () => {
  beforeEach(() => {
    browserActionsMocks.browserAct.mockReset();
    browserClientMocks.browserSnapshot.mockReset();
    browserActionsMocks.browserAct.mockResolvedValue({ ok: true, targetId: "t1" });
    browserClientMocks.browserSnapshot.mockResolvedValue({
      ok: true,
      format: "aria",
      targetId: "t1",
      url: "https://shop.example/item",
      nodes: [
        { ref: "e1", role: "button", name: "加入购物车", depth: 0 },
        { ref: "e2", role: "button", name: "去结算", depth: 0 },
        { ref: "pay", role: "button", name: "立即支付", depth: 0 },
      ],
    });
  });

  it("action=plan_once runs Shape B through shared /snapshot+/act", async () => {
    const tool = createBrowserTool({
      allowHostControl: true,
      accountComputer: true,
      sandboxBridgeUrl: "http://127.0.0.1:9999",
    });
    const result = await tool.execute("c1", {
      action: "plan_once",
      finishes_task: true,
      summary: "add to cart only",
      constraints: ["Do not click 立即支付"],
      steps: [{ action: "click", target: "加入购物车" }],
      sessionPhase: "INTERACTIVE",
      ownershipPhase: "BACKGROUND_AGENT",
    });
    const details = result.details as Record<string, unknown>;
    expect(details.planOnce).toBe(true);
    expect(details.landing).toBe("BROWSER_PLAN_ONCE_LEGAL_DOM_WIRE");
    expect(browserClientMocks.browserSnapshot).toHaveBeenCalled();
    expect(browserActionsMocks.browserAct.mock.calls.length).toBeGreaterThanOrEqual(1);
    const clickCall = browserActionsMocks.browserAct.mock.calls.find((call) => {
      const body = call[1] as { kind?: string } | undefined;
      return body?.kind === "click";
    });
    expect(clickCall?.[1]).toMatchObject({ kind: "click", ref: "e1" });
  });

  it("action=act with steps[] routes to plan-once (Shape B)", async () => {
    const tool = createBrowserTool({ allowHostControl: true });
    const result = await tool.execute("c2", {
      action: "act",
      steps: [{ action: "click", target: "去结算" }],
      sessionPhase: "INTERACTIVE",
      ownershipPhase: "BACKGROUND_AGENT",
    });
    const details = result.details as Record<string, unknown>;
    expect(details.planOnce).toBe(true);
  });

  it("probe-level: 立即支付 → FAIL + forbidChatFinal (no auto-pay)", async () => {
    const tool = createBrowserTool({
      allowHostControl: true,
      accountComputer: true,
      sandboxBridgeUrl: "http://127.0.0.1:9999",
    });
    const result = await tool.execute("c3", {
      action: "plan_once",
      steps: [{ action: "click", target: "立即支付" }],
      sessionPhase: "INTERACTIVE",
      ownershipPhase: "BACKGROUND_AGENT",
    });
    const details = result.details as Record<string, unknown>;
    expect(details.status).toBe("FAIL");
    expect(details.allowsChatFinal).toBe(false);
    expect(details.forbidChatFinal).toBe(true);
    expect(browserActionsMocks.browserAct).not.toHaveBeenCalled();
  });

  it("probe-level: FIRST_FRAME gate → BLOCKED, no chat.final", async () => {
    const tool = createBrowserTool({ allowHostControl: true });
    const result = await tool.execute("c4", {
      action: "plan_once",
      steps: [{ action: "click", target: "加入购物车" }],
      sessionPhase: "FIRST_FRAME",
      ownershipPhase: "BACKGROUND_AGENT",
    });
    const details = result.details as Record<string, unknown>;
    expect(details.status).toBe("BLOCKED");
    expect(details.forbidChatFinal).toBe(true);
    expect(details.pause).toBe(true);
    expect(browserActionsMocks.browserAct).not.toHaveBeenCalled();
  });

  it("probe-level: humanTakeover cancels before execute", async () => {
    const tool = createBrowserTool({ allowHostControl: true });
    const result = await tool.execute("c5", {
      action: "plan_once",
      steps: [{ action: "click", target: "加入购物车" }],
      sessionPhase: "INTERACTIVE",
      ownershipPhase: "BACKGROUND_AGENT",
      humanTakeover: true,
    });
    const details = result.details as Record<string, unknown>;
    expect(details.status).toBe("BLOCKED");
    expect(String(details.reason)).toMatch(/接管/);
    expect(details.forbidChatFinal).toBe(true);
  });

  it("NEEDS_INPUT missing OTP forbids chat.final (M2)", async () => {
    browserClientMocks.browserSnapshot.mockResolvedValue({
      ok: true,
      format: "aria",
      targetId: "t1",
      url: "https://login.example",
      nodes: [{ ref: "otp", role: "textbox", name: "验证码", depth: 0 }],
    });
    const tool = createBrowserTool({ allowHostControl: true });
    const result = await tool.execute("c6", {
      action: "plan_once",
      steps: [{ action: "type", target: "验证码" }],
      sessionPhase: "INTERACTIVE",
      ownershipPhase: "BACKGROUND_AGENT",
    });
    const details = result.details as Record<string, unknown>;
    expect(details.status).toBe("NEEDS_INPUT");
    expect(details.allowsChatFinal).toBe(false);
    expect(details.forbidChatFinal).toBe(true);
    expect(details.pause).toBe(true);
  });

  it("omitting sessionPhase+ownershipPhase → BLOCKED (no silent allow)", async () => {
    const tool = createBrowserTool({ allowHostControl: true });
    const result = await tool.execute("c7", {
      action: "plan_once",
      steps: [{ action: "click", target: "加入购物车" }],
    });
    const details = result.details as Record<string, unknown>;
    expect(details.status).toBe("BLOCKED");
    expect(details.forbidChatFinal).toBe(true);
    expect(String(details.reason)).toMatch(/sessionPhase|ownershipPhase|production plan_once/);
    expect(details.phaseGatesLanding).toBe("BROWSER_PLAN_ONCE_PHASE_GATES");
    expect(browserActionsMocks.browserAct).not.toHaveBeenCalled();
  });
});

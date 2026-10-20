import { describe, expect, it } from "vitest";
import { assessBrowserScanProxyRoute } from "./skill-browser-scan-proxy-routing.js";
import {
  inferCapabilityVerbsFromText,
  matchCapabilityIntent,
} from "./skill-capability-contract.js";

const scanProxyCandidate = {
  id: "browser-scan-proxy",
  name: "浏览器扫码代理",
  summary: "用户扫码后由数字人代操作控制台",
  tags: ["扫码登录"],
  category: "browser",
  verbs: ["browser.scan-proxy"],
  installed: true,
  lifecycle: "published" as const,
};

describe("browser-scan-proxy routing", () => {
  it.each([
    ["你打开网页，我帮你进行扫码登录", true, "scan_login"],
    ["请重新启动你的浏览器，我来扫码", true, "restart_scan"],
    ["已经扫码完毕", true, "scan_done"],
    ["授权过期了，需要二次扫码", true, "auth_expired"],
    ["没有 AccessKey，只能上阿里云控制台改 DNS", true, "console_without_key"],
    ["找不到按钮，带我一步步点", false, "guidance"],
    ["请调研开源智能体平台的产品形态", false, "public_web"],
    ["个人微信扫码绑定数字人", false, "none"],
  ] as const)("%s → trigger=%s", (text, trigger, intent) => {
    const decision = assessBrowserScanProxyRoute(text);
    expect(decision.trigger, decision.reason).toBe(trigger);
    expect(decision.intent).toBe(intent);
  });

  it("infers browser.scan-proxy without the skill name", () => {
    expect(inferCapabilityVerbsFromText("你打开网页我来扫码")).toContain("browser.scan-proxy");
    expect(inferCapabilityVerbsFromText("请调研最新行业政策")).not.toContain("browser.scan-proxy");
  });

  it("boosts browser-scan-proxy when matching capability intent", () => {
    const matches = matchCapabilityIntent("请重新启动你的浏览器，我来扫码", [scanProxyCandidate]);
    expect(matches[0]?.id).toBe("browser-scan-proxy");
    expect(matches[0]?.score).toBeGreaterThanOrEqual(8);
  });
});

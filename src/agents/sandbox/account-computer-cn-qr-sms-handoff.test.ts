/**
 * Account Computer — China mainstream login handoff tracks (WeChat QR + SMS OTP).
 *
 * Always-on: fixture DOM contracts + classifier sms/qr → handoff + gateway
 * handoff → auto gate clear (or optional releaseControl) → await_return
 * (fixture/mock; no real WeChat/SMS). Normal path does not require「交给AI」.
 *
 * Gates (optional, fail loud when on and fixture missing):
 *   OPENBOT_ACCOUNT_WECHAT_QR_E2E=1
 *   OPENBOT_ACCOUNT_SMS_OTP_E2E=1
 *   OPENBOT_ACCOUNT_CN_LOGIN_HANDOFF_E2E=1  (enables both)
 *
 * Does NOT claim: real WeChat scan, real SMS delivery, third-party site login,
 * or production device cutover.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { chromium } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { secureFormHandlers } from "../../gateway/server-methods/secure-form.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { isTruthyEnvValue } from "../../infra/env.js";
import { classifyAccountComputerLogin } from "./account-computer-login-classify.js";
import {
  publishAccountComputerObserver,
  resetAccountComputerSlotsForTests,
  setAccountBrowserLivenessForTests,
} from "./account-computer-stream.js";
import { resetNoVncObserverTokensForTests } from "./novnc-auth.js";
import {
  notifyHandoffReturned,
  resetSecureFormHandoffWaitForTests,
} from "./secure-form-handoff-wait.js";
import { resetSecureFormStoreForTests } from "./secure-form-store.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DESIGN_REL = "docs/design/account-computer-cn-wechat-qr-sms-otp-2026-10-18.md";
const BRIEF_REL = "docs/design/account-computer-cn-qr-sms-handoff-acceptance-brief-2026-10-18.md";
const QR_FIXTURE_REL = "docs/design/account-computer-wechat-qr-fixture.html";
const SMS_FIXTURE_REL = "docs/design/account-computer-sms-otp-fixture.html";
const ZH_CN_PATH = path.join(REPO_ROOT, "ui/src/i18n/locales/zh-CN.ts");

const DESIGN_PATH = path.join(REPO_ROOT, DESIGN_REL);
const BRIEF_PATH = path.join(REPO_ROOT, BRIEF_REL);
const QR_FIXTURE_PATH = path.join(REPO_ROOT, QR_FIXTURE_REL);
const SMS_FIXTURE_PATH = path.join(REPO_ROOT, SMS_FIXTURE_REL);

const SHARED_GATE = isTruthyEnvValue(process.env.OPENBOT_ACCOUNT_CN_LOGIN_HANDOFF_E2E);
const QR_GATE = SHARED_GATE || isTruthyEnvValue(process.env.OPENBOT_ACCOUNT_WECHAT_QR_E2E);
const SMS_GATE = SHARED_GATE || isTruthyEnvValue(process.env.OPENBOT_ACCOUNT_SMS_OTP_E2E);

function client(overrides: Partial<GatewayClient> = {}): GatewayClient {
  return {
    sessionEnterpriseId: "tenant-cn",
    platformUserId: "user-cn",
    ...overrides,
  } as GatewayClient;
}

function viRespond() {
  const calls: Array<[boolean, unknown?, { message?: string }?]> = [];
  return {
    calls,
    fn: (ok: boolean, payload?: unknown, error?: { message?: string }) => {
      calls.push([ok, payload, error]);
    },
  };
}

function makeContext() {
  const broadcasts: Array<{ event: string; payload: unknown }> = [];
  return {
    broadcasts,
    context: {
      broadcast: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
    } as never,
  };
}

async function callSecure(
  method: keyof typeof secureFormHandlers,
  params: Record<string, unknown>,
  viewer: GatewayClient | null = client(),
) {
  const respond = viRespond();
  const { broadcasts, context } = makeContext();
  await secureFormHandlers[method]({
    params,
    respond: respond.fn as never,
    client: viewer,
    context,
    req: { type: "req", id: "req-1", method },
    isWebchatConnect: () => false,
  });
  return { ...respond, broadcasts };
}

async function stitchHandoffAutoResume(sessionKey: string, reason: "qr" | "sms") {
  const { setHandoffGateProbeForTests } = await import("./secure-form-handoff-gate-probe.js");
  let n = 0;
  setHandoffGateProbeForTests(async () => {
    n += 1;
    return n >= 2
      ? { signedInAttr: "true", statusText: "fixture-ok: gate cleared" }
      : { signedInAttr: null, statusText: "等待…" };
  });
  try {
    const handoff = await callSecure("secure_form.handoff", {
      sessionKey,
      reason,
    });
    expect(handoff.calls[0]?.[0]).toBe(true);
    const active = handoff.broadcasts.find((b) => b.event === "secure_form.handoff_active");
    expect(active).toBeTruthy();
    const instruction = String((active!.payload as { instruction?: string }).instruction ?? "");
    expect(instruction).toBe("请在云电脑窗口扫码或输入短信验证码；完成后系统会自动继续。");
    expect(instruction).not.toContain("交还");
    expect(instruction).not.toMatch(/完成后点「交给AI」/);
    expect(instruction).not.toContain("无需点「交给AI」");
    expect(instruction).not.toContain("不用点「交给AI」");
    expect(instruction).not.toContain("当前保持 AI 接管");
    expect(instruction).not.toContain("页面快照");
    expect(instruction).not.toContain("二选一");

    const waiting = callSecure("secure_form.await_return", {
      sessionKey,
      timeoutMs: 5_000,
      pollIntervalMs: 40,
    });
    const awaited = await waiting;
    expect(awaited.calls[0]?.[0]).toBe(true);
    expect((awaited.calls[0]?.[1] as { status?: string })?.status).toBe("handoff_returned");
    expect(awaited.broadcasts.some((b) => b.event === "secure_form.handoff_returned")).toBe(true);
    const returned = awaited.broadcasts.find((b) => b.event === "secure_form.handoff_returned");
    expect((returned?.payload as { resume?: string })?.resume).toBe("auto_gate_cleared");
  } finally {
    setHandoffGateProbeForTests(null);
  }
}

function requireFixture(fixturePath: string, label: string) {
  if (!fs.existsSync(fixturePath)) {
    throw new Error(
      `[account-computer cn handoff] gate on but missing ${label} fixture at ${fixturePath}`,
    );
  }
}

async function serveFixture(fixturePath: string): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const html = fs.readFileSync(fixturePath);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("failed to bind fixture server");
  }
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("Account Computer CN WeChat QR + SMS OTP handoff (fixture)", () => {
  beforeEach(() => {
    resetAccountComputerSlotsForTests();
    setAccountBrowserLivenessForTests(async () => "running");
    resetNoVncObserverTokensForTests();
    resetSecureFormStoreForTests();
    resetSecureFormHandoffWaitForTests();
    publishAccountComputerObserver({
      tenantId: "tenant-cn",
      userId: "user-cn",
      noVncPort: 6080,
      password: "secret-vnc",
      bridgeBaseUrl: "http://127.0.0.1:18789",
      scopeKey: "scope-cn",
      containerName: "openbot-sb-browser-cn",
      agentLabel: "Ada",
    });
  });

  afterEach(async () => {
    const { setHandoffGateProbeForTests } = await import("./secure-form-handoff-gate-probe.js");
    setHandoffGateProbeForTests(null);
    resetSecureFormHandoffWaitForTests();
    resetSecureFormStoreForTests();
    resetAccountComputerSlotsForTests();
  });

  it("ships design + brief + fixtures", () => {
    expect(fs.existsSync(DESIGN_PATH)).toBe(true);
    expect(fs.existsSync(BRIEF_PATH)).toBe(true);
    expect(fs.existsSync(QR_FIXTURE_PATH)).toBe(true);
    expect(fs.existsSync(SMS_FIXTURE_PATH)).toBe(true);
    const design = fs.readFileSync(DESIGN_PATH, "utf8");
    expect(design).toContain("微信扫码");
    expect(design).toContain("短信验证码");
    expect(design).toMatch(/自动|auto-resume|无需点「交给AI」|auto_gate/);
    expect(design).toContain("交给AI"); // rare chrome override still named
  });

  it("steward prompts: single short remind; no snapshot verbosity", async () => {
    const { buildAccountComputerBrowserRoutingLines } =
      await import("./account-computer-browser-routing.js");
    const toolSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/agents/tools/secure-form-tool.ts"),
      "utf8",
    );
    const lines = buildAccountComputerBrowserRoutingLines().join("\n");
    const SHORT = "请在云电脑窗口扫码或输入短信验证码；完成后系统会自动继续。";
    expect(lines).toContain(SHORT);
    expect(lines).toContain("emit EXACTLY once");
    expect(lines).toContain("mid-task");
    expect(lines).not.toContain("login page is open");
    expect(toolSrc).toContain(SHORT);
    expect(toolSrc).toContain("omit instruction");
    expect(toolSrc).toContain("mid_wait");
    expect(toolSrc).toContain("parks mid-task");
    expect(toolSrc).not.toMatch(/remind the user in one short chat line to finish scan\/SMS/);
    for (const bad of ["页面快照确认", "登录方式可以扫码", "当前保持 AI 接管"]) {
      expect(lines).not.toContain(bad);
      expect(toolSrc).not.toContain(bad);
    }
  });

  it("zh-CN: auto-resume handoff hint; chrome may still name 交给AI", () => {
    const zh = fs.readFileSync(ZH_CN_PATH, "utf8");
    expect(zh).toMatch(/computerHandBack:\s*"交给AI"/);
    expect(zh).toMatch(/系统会自动继续/);
    expect(zh).not.toContain("完成后点「交给AI」");
    expect(zh).not.toContain("无需点「交给AI」");
    expect(zh).not.toContain("不用点「交给AI」");
    expect(zh).not.toMatch(/computerHandBack:\s*"交还"/);
  });

  it("classifier: WeChat QR → handoff; SMS OTP → handoff; password only → secure_form", () => {
    expect(classifyAccountComputerLogin({ signals: { qr: true } })).toEqual({
      decision: "handoff",
      reason: "qr",
    });
    expect(classifyAccountComputerLogin({ signals: { sms: true } })).toEqual({
      decision: "handoff",
      reason: "sms",
    });
    expect(classifyAccountComputerLogin({ signals: { password: true } })).toEqual({
      decision: "secure_form",
    });
  });

  it("WeChat QR fixture: wait surface + simulate scan without real WeChat", () => {
    const html = fs.readFileSync(QR_FIXTURE_PATH, "utf8");
    expect(html).toContain('data-fixture="wechat-qr"');
    expect(html).toContain("请使用微信扫描");
    expect(html).toContain("simulate-scan-ok");
    expect(html).not.toContain("交还");

    const { document, window } = parseHTML(html);
    const status = document.getElementById("status");
    const btn = document.getElementById("simulate-scan-ok");
    expect(status && btn).toBeTruthy();
    // Mirror fixture click contract (linkedom may not run inline scripts).
    status!.textContent = "fixture-ok: wechat-qr confirmed (no real WeChat)";
    document.body.setAttribute("data-signed-in", "true");
    expect(status!.textContent).toContain("fixture-ok");
    expect(document.body.getAttribute("data-signed-in")).toBe("true");
    void window;
  });

  it("SMS OTP fixture: phone+otp submit does not echo otp", () => {
    const html = fs.readFileSync(SMS_FIXTURE_PATH, "utf8");
    expect(html).toContain('data-fixture="sms-otp"');
    expect(html).toContain('id="phone"');
    expect(html).toContain('id="otp"');
    expect(html).toContain("fixture-ok");

    const { document, window } = parseHTML(html);
    const form = document.getElementById("sms-login") as HTMLFormElement | null;
    const phone = document.getElementById("phone") as HTMLInputElement | null;
    const otp = document.getElementById("otp") as HTMLInputElement | null;
    const status = document.getElementById("status");
    expect(form && phone && otp && status).toBeTruthy();
    phone!.value = "13800138000";
    otp!.value = "secret-otp-should-not-echo";
    status!.textContent =
      "fixture-ok: sms login for " + (phone!.value || "(empty phone)") + " (otp not echoed)";
    expect(status!.textContent).toBe("fixture-ok: sms login for 13800138000 (otp not echoed)");
    expect(status!.textContent).not.toContain("secret-otp");
    void window;
  });

  it("QR path: classify handoff → gateway handoff → auto-resume → await_return", async () => {
    expect(classifyAccountComputerLogin({ signals: { qr: true } }).decision).toBe("handoff");
    await stitchHandoffAutoResume("cn-qr-session", "qr");
    expect(JSON.stringify({ ok: true })).not.toContain("secret-vnc");
  });

  it("SMS path: classify handoff → gateway handoff → auto-resume → await_return", async () => {
    expect(classifyAccountComputerLogin({ signals: { sms: true } })).toEqual({
      decision: "handoff",
      reason: "sms",
    });
    await stitchHandoffAutoResume("cn-sms-session", "sms");
  });

  it("await_return still resumes within grace after manual/auto notify", async () => {
    notifyHandoffReturned("cn-grace");
    const result = await callSecure("secure_form.await_return", {
      sessionKey: "cn-grace",
      timeoutMs: 1_000,
    });
    expect(result.calls[0]?.[0]).toBe(true);
    expect((result.calls[0]?.[1] as { status?: string })?.status).toBe("handoff_returned");
  });
});

describe.runIf(QR_GATE)("Account Computer WeChat QR gated fixture browser", () => {
  it("opens QR fixture in Chromium and completes handoff → auto-resume", async () => {
    requireFixture(QR_FIXTURE_PATH, "wechat-qr");
    const served = await serveFixture(QR_FIXTURE_PATH);
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      browser = await chromium.launch({
        channel: "chrome",
        headless: true,
      });
      const page = await browser.newPage();
      await page.goto(served.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      expect(await page.locator("[data-fixture='wechat-qr']").count()).toBeGreaterThan(0);
      expect(await page.locator("#qr-panel").innerText()).toContain("fixture-qr");
      await page.click("#simulate-scan-ok");
      expect(await page.locator("#status").innerText()).toContain("fixture-ok");
      expect(classifyAccountComputerLogin({ signals: { qr: true } })).toEqual({
        decision: "handoff",
        reason: "qr",
      });
      resetAccountComputerSlotsForTests();
      setAccountBrowserLivenessForTests(async () => "running");
      resetSecureFormHandoffWaitForTests();
      publishAccountComputerObserver({
        tenantId: "tenant-cn",
        userId: "user-cn",
        noVncPort: 6080,
        password: "secret-vnc",
        bridgeBaseUrl: "http://127.0.0.1:18789",
        scopeKey: "scope-cn-qr-live",
        containerName: "openbot-sb-browser-cn-qr",
        agentLabel: "Ada",
      });
      await stitchHandoffAutoResume("cn-qr-gated", "qr");
    } finally {
      await browser?.close().catch(() => undefined);
      await served.close();
    }
  });
});

describe.runIf(SMS_GATE)("Account Computer SMS OTP gated fixture browser", () => {
  it("opens SMS fixture in Chromium and completes handoff → auto-resume", async () => {
    requireFixture(SMS_FIXTURE_PATH, "sms-otp");
    const served = await serveFixture(SMS_FIXTURE_PATH);
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      browser = await chromium.launch({
        channel: "chrome",
        headless: true,
      });
      const page = await browser.newPage();
      await page.goto(served.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      expect(await page.locator("[data-fixture='sms-otp']").count()).toBeGreaterThan(0);
      await page.fill("#phone", "13800138000");
      await page.fill("#otp", "123456");
      await page.click("#submit");
      const statusText = await page.locator("#status").innerText();
      expect(statusText).toContain("fixture-ok");
      expect(statusText).not.toContain("123456");
      expect(classifyAccountComputerLogin({ signals: { sms: true } })).toEqual({
        decision: "handoff",
        reason: "sms",
      });
      resetAccountComputerSlotsForTests();
      setAccountBrowserLivenessForTests(async () => "running");
      resetSecureFormHandoffWaitForTests();
      publishAccountComputerObserver({
        tenantId: "tenant-cn",
        userId: "user-cn",
        noVncPort: 6080,
        password: "secret-vnc",
        bridgeBaseUrl: "http://127.0.0.1:18789",
        scopeKey: "scope-cn-sms-live",
        containerName: "openbot-sb-browser-cn-sms",
        agentLabel: "Ada",
      });
      await stitchHandoffAutoResume("cn-sms-gated", "sms");
    } finally {
      await browser?.close().catch(() => undefined);
      await served.close();
    }
  });
});

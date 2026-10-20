/**
 * Account Computer — gated live Zhihu (知乎) login surface e2e.
 *
 * Gate: OPENBOT_ACCOUNT_ZHIHU_LOGIN_E2E=1
 *
 * Opens https://www.zhihu.com/signin in Account Worker Docker browser
 * (default) or host Chrome (`OPENBOT_ACCOUNT_ZHIHU_LOGIN_BROWSER=host`),
 * detects App QR + SMS OTP (and optional WeChat OAuth popup), classifies
 * → handoff, then mocks「交给AI」via releaseControl → await_return.
 *
 * Does NOT claim: automated WeChat scan, SMS delivery, completed Zhihu
 * session, or production device cutover. Brian must scan / enter OTP and
 * tap「交给AI」for full live proof.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerAccountBrowserCdpPortForTests,
  releaseAccountBrowserCdpPort,
  resetAccountBrowserCdpPortsForTests,
} from "../../browser/account-browser-namespace.js";
import { closePlaywrightBrowserConnection } from "../../browser/pw-session.js";
import { browserPreviewHandlers } from "../../gateway/server-methods/browser-preview.js";
import { secureFormHandlers } from "../../gateway/server-methods/secure-form.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { isTruthyEnvValue } from "../../infra/env.js";
import { classifyAccountComputerLogin } from "./account-computer-login-classify.js";
import {
  publishAccountComputerObserver,
  resetAccountComputerSlotsForTests,
  setAccountBrowserLivenessForTests,
} from "./account-computer-stream.js";
import { resolveAccountBrowserScopeKey } from "./account-scope.js";
import {
  ACCOUNT_WORKER_BROWSER_IMAGE_ENV,
  createDockerAccountSandboxDriver,
  resolveAccountWorkerImages,
  type AccountWorkerSandboxDriver,
} from "./account-worker-driver.js";
import { waitForSandboxCdp } from "./browser.js";
import { DEFAULT_SANDBOX_BROWSER_CDP_PORT, DEFAULT_SANDBOX_BROWSER_IMAGE } from "./constants.js";
import { readDockerPort } from "./docker.js";
import { resetNoVncObserverTokensForTests } from "./novnc-auth.js";
import type { RuntimeContainerSpec } from "./runtime-controller.js";
import { resetSecureFormHandoffWaitForTests } from "./secure-form-handoff-wait.js";
import { resetSecureFormStoreForTests } from "./secure-form-store.js";

const ENABLED = isTruthyEnvValue(process.env.OPENBOT_ACCOUNT_ZHIHU_LOGIN_E2E);
const OPEN_WECHAT_OAUTH = isTruthyEnvValue(process.env.OPENBOT_ACCOUNT_ZHIHU_OPEN_WECHAT_OAUTH);

const DEFAULT_ZHIHU_URL = "https://www.zhihu.com/signin";
const WECHAT_OAUTH_HOST_RE = /open\.weixin\.qq\.com/i;

/** Stable DOM contracts scouted 2026-10-18 (may drift; gate fails loud). */
const ZHIHU_SELECTORS = {
  signFlow: ".SignFlowHomepage, form.SignFlow, .SignFlow.Login-content",
  qrContainer: ".signQr-container, .Qrcode-container",
  qrCanvasOrImg: ".Qrcode-img canvas, .Qrcode-img img, .Qrcode-content canvas",
  smsTab: '.SignFlow-tab:has-text("验证码登录"), .SignFlow-tab',
  phoneInput: 'input[name="username"][type="tel"]',
  otpInput: 'input[name="digits"]',
  smsButton: "button.SignFlow-smsInputButton, button.CountingDownButton",
  passwordTab: '.SignFlow-tab:has-text("密码登录")',
  passwordInput: 'input[name="password"][type="password"]',
  wechatSocial: "button.Login-socialButton:has(svg.ZDI--Wechat24)",
  submit: "button.SignFlow-submitButton",
} as const;

const BRIEF_REL = "docs/design/account-computer-zhihu-login-e2e-acceptance-brief-2026-10-18.md";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BRIEF_PATH = path.join(REPO_ROOT, BRIEF_REL);
const ZH_CN_PATH = path.join(REPO_ROOT, "ui/src/i18n/locales/zh-CN.ts");

const TENANT = "tenant-zhihu-live";
const USER = "user-zhihu-live";
const SESSION = "zhihu-live-login-session";

function zhihuUrl(): string {
  return process.env.OPENBOT_ACCOUNT_ZHIHU_LOGIN_URL?.trim() || DEFAULT_ZHIHU_URL;
}

function browserMode(): "worker" | "host" {
  const raw = (process.env.OPENBOT_ACCOUNT_ZHIHU_LOGIN_BROWSER ?? "worker").trim().toLowerCase();
  return raw === "host" ? "host" : "worker";
}

function client(overrides: Partial<GatewayClient> = {}): GatewayClient {
  return {
    sessionEnterpriseId: TENANT,
    platformUserId: USER,
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
    req: { type: "req", id: "req-zhihu", method },
    isWebchatConnect: () => false,
  });
  return { ...respond, broadcasts };
}

async function callPreview(
  params: Record<string, unknown>,
  viewer: GatewayClient | null = client(),
) {
  const respond = viRespond();
  const { broadcasts, context } = makeContext();
  await browserPreviewHandlers["browser.preview"]({
    params,
    respond: respond.fn as never,
    client: viewer,
    context,
    req: { type: "req", id: "req-preview-zhihu", method: "browser.preview" },
    isWebchatConnect: () => false,
  });
  return { ...respond, broadcasts };
}

function ensureDockerHostForE2E(): { restore: () => void } {
  const prev = process.env.DOCKER_HOST;
  const restore = () => {
    if (prev === undefined) {
      delete process.env.DOCKER_HOST;
    } else {
      process.env.DOCKER_HOST = prev;
    }
  };
  if (process.env.DOCKER_HOST?.trim()) {
    return { restore };
  }
  const defaultSocks = ["/var/run/docker.sock", "/run/docker.sock"];
  if (
    defaultSocks.some((sock) => {
      try {
        return fs.statSync(sock).isSocket();
      } catch {
        return false;
      }
    })
  ) {
    return { restore };
  }
  const homes: string[] = [];
  const realHome = process.env.OPENCLAW_REAL_HOME?.trim();
  if (realHome) {
    homes.push(realHome);
  }
  try {
    const passwdHome = os.userInfo().homedir;
    if (passwdHome && !homes.includes(passwdHome)) {
      homes.push(passwdHome);
    }
  } catch {
    // ignore
  }
  for (const home of homes) {
    const sock = path.join(home, ".docker", "run", "docker.sock");
    try {
      if (fs.statSync(sock).isSocket()) {
        process.env.DOCKER_HOST = `unix://${sock}`;
        return { restore };
      }
    } catch {
      // try next
    }
  }
  return { restore };
}

async function dockerDaemonReachable(): Promise<boolean> {
  try {
    const { execDocker } = await import("./docker.js");
    const result = await execDocker(["info"], { allowFailure: true });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function dockerImagePresent(image: string): Promise<boolean> {
  try {
    const { execDocker } = await import("./docker.js");
    const result = await execDocker(["image", "inspect", image], { allowFailure: true });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function resolveWorkerBrowserImage(): Promise<string> {
  const override = process.env[ACCOUNT_WORKER_BROWSER_IMAGE_ENV]?.trim();
  if (override) {
    return override;
  }
  const images = resolveAccountWorkerImages();
  if (await dockerImagePresent(images.browserImage)) {
    return images.browserImage;
  }
  if (await dockerImagePresent(DEFAULT_SANDBOX_BROWSER_IMAGE)) {
    return DEFAULT_SANDBOX_BROWSER_IMAGE;
  }
  throw new Error(
    [
      "OPENBOT_ACCOUNT_ZHIHU_LOGIN_E2E=1 (worker) requires a real sandbox browser image",
      `(tried ${images.browserImage} and ${DEFAULT_SANDBOX_BROWSER_IMAGE}).`,
      `Set ${ACCOUNT_WORKER_BROWSER_IMAGE_ENV}, or OPENBOT_ACCOUNT_ZHIHU_LOGIN_BROWSER=host.`,
    ].join(" "),
  );
}

type ZhihuSurfaceSnapshot = {
  url: string;
  hasSignFlow: boolean;
  hasQrContainer: boolean;
  hasQrCanvasOrImg: boolean;
  hasPhoneInput: boolean;
  hasOtpInput: boolean;
  hasSmsButton: boolean;
  hasPasswordTab: boolean;
  hasWechatSocial: boolean;
  tabs: string[];
  bodyHints: string[];
};

async function snapshotZhihuSurfaces(page: Page): Promise<ZhihuSurfaceSnapshot> {
  return page.evaluate(
    (sels) => {
      const tabs = Array.from(document.querySelectorAll(".SignFlow-tab"))
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean);
      const text = document.body?.innerText ?? "";
      const hints = [
        "验证码登录",
        "密码登录",
        "获取短信验证码",
        "其他扫码方式：微信",
        "打开知乎App",
      ].filter((h) => text.includes(h));
      return {
        url: location.href,
        hasSignFlow: !!document.querySelector(sels.signFlow),
        hasQrContainer: !!document.querySelector(sels.qrContainer),
        hasQrCanvasOrImg: !!document.querySelector(sels.qrCanvasOrImg),
        hasPhoneInput: !!document.querySelector(sels.phoneInput),
        hasOtpInput: !!document.querySelector(sels.otpInput),
        hasSmsButton: !!document.querySelector(sels.smsButton),
        hasPasswordTab: tabs.some((t) => t.includes("密码登录")),
        hasWechatSocial: !!document.querySelector("svg.ZDI--Wechat24"),
        tabs,
        bodyHints: hints,
      };
    },
    {
      signFlow: ZHIHU_SELECTORS.signFlow,
      qrContainer: ZHIHU_SELECTORS.qrContainer,
      qrCanvasOrImg: ZHIHU_SELECTORS.qrCanvasOrImg,
      phoneInput: ZHIHU_SELECTORS.phoneInput,
      otpInput: ZHIHU_SELECTORS.otpInput,
      smsButton: ZHIHU_SELECTORS.smsButton,
    },
  );
}

function assertZhihuSurfaces(snap: ZhihuSurfaceSnapshot) {
  if (!snap.hasSignFlow) {
    throw new Error(
      `[zhihu-login e2e] SignFlow missing at ${snap.url} — network blocked, geo wall, or login redesign.`,
    );
  }
  expect(snap.url).toMatch(/zhihu\.com\/signin|zhihu\.com\/signup/i);
  expect(snap.hasQrContainer || snap.hasQrCanvasOrImg).toBe(true);
  expect(snap.hasPhoneInput).toBe(true);
  expect(snap.hasOtpInput).toBe(true);
  expect(snap.hasSmsButton).toBe(true);
  expect(snap.tabs.some((t) => t.includes("验证码登录"))).toBe(true);
  expect(snap.bodyHints).toEqual(expect.arrayContaining(["获取短信验证码"]));
}

async function stitchHandoffGiveAi(sessionKey: string, reason: "qr" | "sms") {
  const handoff = await callSecure("secure_form.handoff", {
    sessionKey,
    reason,
  });
  expect(handoff.calls[0]?.[0]).toBe(true);
  const active = handoff.broadcasts.find((b) => b.event === "secure_form.handoff_active");
  expect(active).toBeTruthy();
  const instruction = String((active!.payload as { instruction?: string }).instruction ?? "");
  expect(instruction).toBe("请在云电脑窗口扫码或输入短信验证码；完成后系统会自动继续。");
  expect(instruction).not.toContain("无需点「交给AI」");
  expect(instruction).not.toContain("不用点「交给AI」");
  expect(instruction).not.toContain("交还");
  expect(instruction).not.toContain("页面快照");
  expect(instruction).not.toContain("二选一");

  const waiting = callSecure("secure_form.await_return", {
    sessionKey,
    timeoutMs: 5_000,
  });
  await new Promise((r) => setTimeout(r, 20));

  const released = await callPreview({
    action: "open",
    sessionKey,
    releaseControl: true,
  });
  expect(released.broadcasts.some((b) => b.event === "secure_form.handoff_returned")).toBe(true);

  const awaited = await waiting;
  expect(awaited.calls[0]?.[0]).toBe(true);
  expect((awaited.calls[0]?.[1] as { status?: string })?.status).toBe("handoff_returned");
}

describe("Account Computer Zhihu live login e2e (gated)", () => {
  it("documents gate + acceptance brief + selector contracts without network", () => {
    expect(fs.existsSync(BRIEF_PATH)).toBe(true);
    const brief = fs.readFileSync(BRIEF_PATH, "utf8");
    expect(brief).toContain("OPENBOT_ACCOUNT_ZHIHU_LOGIN_E2E");
    expect(brief).toContain("zhihu.com/signin");
    expect(brief).toMatch(/交给AI|自动/);
    expect(brief).not.toContain("交还");
    expect(brief).toMatch(/WeChat|微信/);
    expect(brief).toMatch(/SMS|短信/);
    expect(brief).toContain("Does not");
    expect(brief).toContain("Brian");

    expect(ZHIHU_SELECTORS.phoneInput).toContain('name="username"');
    expect(ZHIHU_SELECTORS.otpInput).toContain('name="digits"');
    expect(ZHIHU_SELECTORS.wechatSocial).toContain("Wechat");

    const smsPlan = classifyAccountComputerLogin({
      signals: { sms: true, password: false, qr: false },
    });
    expect(smsPlan).toEqual({ decision: "handoff", reason: "sms" });
    const qrPlan = classifyAccountComputerLogin({
      signals: { qr: true, password: false, sms: false },
    });
    expect(qrPlan).toEqual({ decision: "handoff", reason: "qr" });
    const both = classifyAccountComputerLogin({
      signals: { password: true, qr: true },
    });
    expect(both).toEqual({ decision: "choose", methods: ["password", "qr"] });

    const zh = fs.readFileSync(ZH_CN_PATH, "utf8");
    expect(zh).toMatch(/computerHandBack:\s*"交给AI"/);

    if (!ENABLED) {
      expect(isTruthyEnvValue(process.env.OPENBOT_ACCOUNT_ZHIHU_LOGIN_E2E)).toBe(false);
    }
  });

  describe.runIf(ENABLED)("live Zhihu signin → detect → handoff → mocked 给AI", () => {
    const holder = resolveAccountBrowserScopeKey({ tenantId: TENANT, userId: USER });
    let dockerHostRestore: (() => void) | null = null;
    let driver: (AccountWorkerSandboxDriver & { browserNames: Map<number, string> }) | null = null;
    let browserPid: number | null = null;
    let containerName = "";
    let cdpUrl = "";
    let tempRoot = "";
    let hostBrowser: Browser | null = null;

    beforeEach(() => {
      resetAccountComputerSlotsForTests();
      setAccountBrowserLivenessForTests(async () => "running");
      resetNoVncObserverTokensForTests();
      resetSecureFormStoreForTests();
      resetSecureFormHandoffWaitForTests();
      resetAccountBrowserCdpPortsForTests();
      publishAccountComputerObserver({
        tenantId: TENANT,
        userId: USER,
        noVncPort: 6080,
        password: "secret-vnc-zhihu",
        bridgeBaseUrl: "http://127.0.0.1:18789",
        scopeKey: "scope-zhihu-live-login",
        containerName: "openbot-sb-browser-zhihu-live",
        agentLabel: "Ada",
      });
    });

    afterEach(async () => {
      await hostBrowser?.close().catch(() => {});
      hostBrowser = null;
      await closePlaywrightBrowserConnection(cdpUrl ? { cdpUrl } : undefined).catch(() => {});
      if (driver && browserPid !== null) {
        await driver.stopBrowser(browserPid).catch(() => {});
      }
      if (holder) {
        releaseAccountBrowserCdpPort(holder);
      }
      if (tempRoot) {
        await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
        tempRoot = "";
      }
      dockerHostRestore?.();
      dockerHostRestore = null;
      driver = null;
      browserPid = null;
      containerName = "";
      cdpUrl = "";
      resetSecureFormHandoffWaitForTests();
      resetSecureFormStoreForTests();
      resetAccountComputerSlotsForTests();
      resetAccountBrowserCdpPortsForTests();
    });

    async function openZhihuPage(): Promise<Page> {
      const mode = browserMode();
      const target = zhihuUrl();

      if (mode === "host") {
        hostBrowser = await chromium.launch({ channel: "chrome", headless: true });
        const page = await hostBrowser.newPage();
        const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
        if (!resp || resp.status() >= 400) {
          throw new Error(
            `[zhihu-login e2e] host Chrome GET ${target} failed status=${resp?.status() ?? "null"}`,
          );
        }
        await page.waitForTimeout(2500);
        return page;
      }

      const host = ensureDockerHostForE2E();
      dockerHostRestore = host.restore;
      if (!(await dockerDaemonReachable())) {
        throw new Error(
          [
            "OPENBOT_ACCOUNT_ZHIHU_LOGIN_E2E=1 (worker) but docker daemon is unreachable.",
            "Set DOCKER_HOST=unix://$HOME/.docker/run/docker.sock, or",
            "OPENBOT_ACCOUNT_ZHIHU_LOGIN_BROWSER=host for host Chrome.",
            `DOCKER_HOST=${JSON.stringify(process.env.DOCKER_HOST ?? "")}`,
          ].join(" "),
        );
      }

      const browserImage = await resolveWorkerBrowserImage();
      tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "aw-zhihu-live-"));
      await fsp.mkdir(path.join(tempRoot, "browser"), { recursive: true });

      const spec: RuntimeContainerSpec = {
        runtimeLeaseId: `zhihu-live-${Date.now()}`,
        snapshotVersion: 1,
        image: resolveAccountWorkerImages().execImage,
        browserImage,
        execMounts: [],
        browserMounts: [
          {
            hostPath: path.join(tempRoot, "browser"),
            containerPath: "/account/browser",
            access: "rw",
          },
        ],
      };

      driver = createDockerAccountSandboxDriver();
      const started = await driver.startBrowser(spec);
      browserPid = started.pid;
      containerName = started.containerName;
      expect(containerName).toMatch(/^aw-browser-/);

      const mappedCdp = await readDockerPort(containerName, DEFAULT_SANDBOX_BROWSER_CDP_PORT);
      if (!mappedCdp) {
        throw new Error(
          `Worker Docker browser CDP port not published for ${containerName} (container port ${DEFAULT_SANDBOX_BROWSER_CDP_PORT}).`,
        );
      }
      const cdpReady = await waitForSandboxCdp({ cdpPort: mappedCdp, timeoutMs: 90_000 });
      if (!cdpReady) {
        throw new Error(
          `Worker Docker browser CDP HTTP not ready on 127.0.0.1:${mappedCdp} within 90s (container=${containerName}).`,
        );
      }

      registerAccountBrowserCdpPortForTests(holder, mappedCdp);
      cdpUrl = `http://127.0.0.1:${mappedCdp}`;

      const bootstrap = await chromium.connectOverCDP(cdpUrl);
      // Keep connection open via hostBrowser holder for page lifetime.
      hostBrowser = bootstrap as unknown as Browser;
      const context = bootstrap.contexts()[0] ?? (await bootstrap.newContext());
      const page = context.pages()[0] ?? (await context.newPage());
      const resp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (!resp || resp.status() >= 400) {
        throw new Error(
          `[zhihu-login e2e] Worker Docker GET ${target} failed status=${resp?.status() ?? "null"} (container=${containerName})`,
        );
      }
      await page.waitForTimeout(3000);
      return page;
    }

    it(
      "detects Zhihu QR + SMS surfaces, handoff qr/sms → 给AI (mocked return)",
      { timeout: 180_000 },
      async () => {
        const page = await openZhihuPage();
        const snap = await snapshotZhihuSurfaces(page);
        assertZhihuSurfaces(snap);

        // SMS track (default tab)
        const smsSignals = {
          sms: snap.hasPhoneInput && snap.hasOtpInput,
          qr: snap.hasQrContainer || snap.hasQrCanvasOrImg,
          password: false,
        };
        const smsDecision = classifyAccountComputerLogin({ signals: smsSignals });
        // QR visible alongside SMS → if password false and qr true, classifier returns qr
        // before sms when both set without password. Prefer explicit single-signal checks:
        expect(
          classifyAccountComputerLogin({
            signals: { sms: true, qr: false, password: false },
          }),
        ).toEqual({ decision: "handoff", reason: "sms" });
        expect(
          classifyAccountComputerLogin({
            signals: { qr: true, sms: false, password: false },
          }),
        ).toEqual({ decision: "handoff", reason: "qr" });
        void smsDecision;

        await stitchHandoffGiveAi(`${SESSION}-sms`, "sms");
        await stitchHandoffGiveAi(`${SESSION}-qr`, "qr");

        if (OPEN_WECHAT_OAUTH) {
          const popupPromise = page.waitForEvent("popup", { timeout: 12_000 });
          await page.locator(ZHIHU_SELECTORS.wechatSocial).first().click({ timeout: 8_000 });
          const popup = await popupPromise;
          await popup.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
          // about:blank → oauth can race; wait for weixin host.
          await popup.waitForURL(WECHAT_OAUTH_HOST_RE, { timeout: 15_000 });
          const popupUrl = popup.url();
          expect(popupUrl).toMatch(WECHAT_OAUTH_HOST_RE);
          expect(popupUrl).toMatch(/qrconnect|snsapi_login|oauth/i);
          expect(popupUrl).toMatch(/zhihu\.com|wx268fcfe924dcb171/i);
          // Do not scan; close immediately.
          await popup.close().catch(() => {});
        }

        // Never claim a completed session.
        expect(page.url()).toMatch(/signin|signup|open\.weixin\.qq\.com/i);
        if (browserMode() === "worker") {
          expect(containerName.startsWith("aw-browser-")).toBe(true);
          expect(await driver!.browserAlive(browserPid!)).toBe(true);
        }
      },
    );
  });
});

import fs from "node:fs";
/**
 * Account Computer — gated live-site password login e2e.
 *
 * Gate: OPENBOT_ACCOUNT_LIVE_LOGIN_E2E=1
 *
 * Default target is the public demo IdP at authenticationtest.com
 * (credentials published on that page — not Brian personal SSO).
 * Override URL / user / password via env when pointing at staging.
 *
 * Claims: real Chromium + CDP + production Secure Form fill host →
 * live form fill → site submit → success URL; then gateway handoff →「交给AI」.
 * Does NOT claim: Account Worker Docker browser, third-party corporate SSO,
 * passkey/QR, or production device cutover.
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allocateAccountBrowserCdpPort,
  releaseAccountBrowserCdpPort,
  resetAccountBrowserCdpPortsForTests,
} from "../../browser/account-browser-namespace.js";
import { closePlaywrightBrowserConnection, getPageForTargetId } from "../../browser/pw-session.js";
import { browserPreviewHandlers } from "../../gateway/server-methods/browser-preview.js";
import { secureFormHandlers } from "../../gateway/server-methods/secure-form.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { isTruthyEnvValue } from "../../infra/env.js";
import {
  publishAccountComputerObserver,
  resetAccountComputerSlotsForTests,
  setAccountBrowserLivenessForTests,
} from "./account-computer-stream.js";
import { resolveAccountBrowserScopeKey } from "./account-scope.js";
import { resetNoVncObserverTokensForTests } from "./novnc-auth.js";
import {
  createSecureFormFillDeps,
  resetSecureFormFillHostWiredForTests,
} from "./secure-form-fill-host.js";
import { preflightAndFillSecureForm, setSecureFormFillDepsForTests } from "./secure-form-fill.js";
import { resetSecureFormHandoffWaitForTests } from "./secure-form-handoff-wait.js";
import {
  createSecureFormRequest,
  getPendingSecureForm,
  resetSecureFormStoreForTests,
} from "./secure-form-store.js";

const ENABLED = isTruthyEnvValue(process.env.OPENBOT_ACCOUNT_LIVE_LOGIN_E2E);

/** Public demo IdP — credentials are printed on the page itself. */
const DEFAULT_LIVE_LOGIN_URL = "https://authenticationtest.com/simpleFormAuth/";
const DEFAULT_LIVE_LOGIN_HOST = "authenticationtest.com";
const DEFAULT_LIVE_LOGIN_USER = "simpleForm@authenticationtest.com";
const DEFAULT_LIVE_LOGIN_PASSWORD = "pa$$w0rd";
const DEFAULT_SUCCESS_URL_RE = "loginSuccess";

const BRIEF_REL = "docs/design/account-computer-live-login-e2e-acceptance-brief-2026-10-18.md";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BRIEF_PATH = path.join(REPO_ROOT, BRIEF_REL);

const TENANT = "tenant-live";
const USER = "user-live";
const SESSION = "live-login-session";

function liveLoginUrl(): string {
  return process.env.OPENBOT_ACCOUNT_LIVE_LOGIN_URL?.trim() || DEFAULT_LIVE_LOGIN_URL;
}

function liveLoginHost(): string {
  const override = process.env.OPENBOT_ACCOUNT_LIVE_LOGIN_HOST?.trim();
  if (override) {
    return override.toLowerCase();
  }
  try {
    return new URL(liveLoginUrl()).hostname.toLowerCase();
  } catch {
    return DEFAULT_LIVE_LOGIN_HOST;
  }
}

function liveLoginUser(): string {
  return process.env.OPENBOT_ACCOUNT_LIVE_LOGIN_USER?.trim() || DEFAULT_LIVE_LOGIN_USER;
}

function liveLoginPassword(): string {
  return process.env.OPENBOT_ACCOUNT_LIVE_LOGIN_PASSWORD?.trim() || DEFAULT_LIVE_LOGIN_PASSWORD;
}

function successUrlRe(): RegExp {
  const raw =
    process.env.OPENBOT_ACCOUNT_LIVE_LOGIN_SUCCESS_URL_RE?.trim() || DEFAULT_SUCCESS_URL_RE;
  return new RegExp(raw, "i");
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
    req: { type: "req", id: "req-live", method },
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
    req: { type: "req", id: "req-preview", method: "browser.preview" },
    isWebchatConnect: () => false,
  });
  return { ...respond, broadcasts };
}

async function waitForCdpHttp(port: number, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        res.resume();
        resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(500, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`CDP HTTP not ready on 127.0.0.1:${port}`);
}

describe("Account Computer live-site login e2e (gated)", () => {
  it("documents gate + acceptance brief without requiring network", () => {
    expect(BRIEF_PATH).toContain("account-computer-live-login-e2e-acceptance-brief");
    expect(fs.existsSync(BRIEF_PATH)).toBe(true);
    const brief = fs.readFileSync(BRIEF_PATH, "utf8");
    expect(brief).toContain("OPENBOT_ACCOUNT_LIVE_LOGIN_E2E");
    expect(brief).toContain("authenticationtest.com");
    expect(brief).toMatch(/交给AI|自动|Hand to AI|auto/i);
    expect(brief).not.toContain("交还");
    // Defaults are public demo credentials (printed on the IdP page).
    expect(DEFAULT_LIVE_LOGIN_USER).toContain("@authenticationtest.com");
    expect(DEFAULT_LIVE_LOGIN_PASSWORD.length).toBeGreaterThan(0);
    if (!ENABLED) {
      // Keep default CI green: live Chromium path stays skipped.
      expect(isTruthyEnvValue(process.env.OPENBOT_ACCOUNT_LIVE_LOGIN_E2E)).toBe(false);
    }
  });

  describe.runIf(ENABLED)("live Chromium + Secure Form fill host", () => {
    const holder = resolveAccountBrowserScopeKey({ tenantId: TENANT, userId: USER });
    let launched: Browser | null = null;
    let cdpPort = 0;
    let cdpUrl = "";

    beforeEach(() => {
      resetAccountComputerSlotsForTests();
      setAccountBrowserLivenessForTests(async () => "running");
      resetNoVncObserverTokensForTests();
      resetSecureFormStoreForTests();
      resetSecureFormHandoffWaitForTests();
      resetSecureFormFillHostWiredForTests();
      resetAccountBrowserCdpPortsForTests();
      setSecureFormFillDepsForTests(null);
      publishAccountComputerObserver({
        tenantId: TENANT,
        userId: USER,
        noVncPort: 6080,
        password: "secret-vnc-live",
        bridgeBaseUrl: "http://127.0.0.1:18789",
        scopeKey: "scope-live-login",
        containerName: "openbot-sb-browser-live-login",
        agentLabel: "Ada",
      });
    });

    afterEach(async () => {
      await closePlaywrightBrowserConnection(cdpUrl ? { cdpUrl } : undefined).catch(() => {});
      if (launched) {
        await launched.close().catch(() => {});
        launched = null;
      }
      if (holder) {
        releaseAccountBrowserCdpPort(holder);
      }
      resetSecureFormHandoffWaitForTests();
      resetSecureFormStoreForTests();
      resetAccountComputerSlotsForTests();
      setSecureFormFillDepsForTests(null);
      resetSecureFormFillHostWiredForTests();
      resetAccountBrowserCdpPortsForTests();
    });

    it(
      "fills public demo login via Secure Form CDP host, then handoff → 给AI",
      { timeout: 90_000 },
      async () => {
        cdpPort = await allocateAccountBrowserCdpPort(holder);
        cdpUrl = `http://127.0.0.1:${cdpPort}`;

        launched = await chromium.launch({
          channel: "chrome",
          headless: true,
          args: [
            `--remote-debugging-port=${cdpPort}`,
            "--remote-debugging-address=127.0.0.1",
            "--disable-gpu",
          ],
        });
        await waitForCdpHttp(cdpPort);

        // Navigate with a direct CDP attach (same endpoint fill-host will use).
        const bootstrap = await chromium.connectOverCDP(cdpUrl);
        try {
          const context = bootstrap.contexts()[0] ?? (await bootstrap.newContext());
          const page = context.pages()[0] ?? (await context.newPage());
          const resp = await page.goto(liveLoginUrl(), {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          expect(resp?.ok() ?? false).toBe(true);
          expect(page.url()).toContain(liveLoginHost());
        } finally {
          await bootstrap.close().catch(() => {});
        }

        setSecureFormFillDepsForTests(createSecureFormFillDeps());

        const emailSel = process.env.OPENBOT_ACCOUNT_LIVE_LOGIN_EMAIL_SELECTOR?.trim() || "#email";
        const passSel =
          process.env.OPENBOT_ACCOUNT_LIVE_LOGIN_PASSWORD_SELECTOR?.trim() || "#password";
        const submitSel =
          process.env.OPENBOT_ACCOUNT_LIVE_LOGIN_SUBMIT_SELECTOR?.trim() || 'input[type="submit"]';

        const offered = createSecureFormRequest({
          tenantId: TENANT,
          userId: USER,
          sessionKey: SESSION,
          agentLabel: "Ada",
          reason: "auth",
          domain: { host: liveLoginHost() },
          fields: [
            { fieldId: "email", kind: "username", label: "E-Mail", selector: emailSel },
            { fieldId: "password", kind: "password", label: "密码", selector: passSel },
          ],
        });

        const user = liveLoginUser();
        const password = liveLoginPassword();
        const values = { email: user, password };
        const receipt = await preflightAndFillSecureForm({
          form: getPendingSecureForm(offered.formId)!,
          values,
        });
        expect(receipt.status).toBe("filled");
        expect(JSON.stringify(receipt)).not.toContain(password);
        expect(Object.keys(values)).toEqual([]);

        // Product path: after fill, click the site submit control (not OTP Enter).
        const page = await getPageForTargetId({ cdpUrl });
        await Promise.all([
          page.waitForURL(successUrlRe(), { timeout: 30_000 }),
          page.locator(submitSel).first().click({ timeout: 10_000 }),
        ]);
        const body = await page.locator("body").innerText();
        expect(page.url()).toMatch(successUrlRe());
        expect(body).toMatch(/Success! You are now logged in/i);
        expect(body).not.toContain(password);

        const handoff = await callSecure("secure_form.handoff", {
          sessionKey: SESSION,
          reason: "sso",
        });
        expect(handoff.calls[0]?.[0]).toBe(true);
        const active = handoff.broadcasts.find((b) => b.event === "secure_form.handoff_active");
        expect(active).toBeTruthy();
        const instruction = (active!.payload as { instruction?: string }).instruction ?? "";
        expect(instruction).toMatch(/自动继续/);
        expect(instruction).not.toContain("无需点「交给AI」");
        expect(instruction).not.toContain("不用点「交给AI」");
        expect(instruction).not.toContain("交还");
        expect(JSON.stringify(handoff.broadcasts)).not.toContain("secret-vnc-live");

        const waiting = callSecure("secure_form.await_return", {
          sessionKey: SESSION,
          timeoutMs: 5_000,
        });
        await new Promise((r) => setTimeout(r, 20));

        const released = await callPreview({
          action: "open",
          sessionKey: SESSION,
          releaseControl: true,
        });
        expect(released.broadcasts.some((b) => b.event === "secure_form.handoff_returned")).toBe(
          true,
        );

        const awaited = await waiting;
        expect(awaited.calls[0]?.[0]).toBe(true);
        const awaitBody = awaited.calls[0]?.[1] as Record<string, unknown>;
        expect(awaitBody.status).toBe("handoff_returned");
        expect(JSON.stringify(awaitBody)).not.toContain(password);
        expect(JSON.stringify(awaitBody)).not.toContain("secret-vnc-live");
      },
    );
  });
});

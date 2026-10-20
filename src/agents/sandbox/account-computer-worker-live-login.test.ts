/**
 * Account Computer — gated Account Worker Docker browser live-login e2e.
 *
 * Gate: OPENBOT_ACCOUNT_WORKER_LIVE_LOGIN_E2E=1
 *
 * Default target is the public demo IdP at authenticationtest.com
 * (credentials published on that page — not Brian personal SSO).
 *
 * Claims: Account Worker Docker browser container + published CDP +
 * production Secure Form fill host → live form fill → site submit →
 * success URL; then gateway handoff →「交给AI」.
 * Does NOT claim: host Chrome alone, third-party corporate SSO,
 * passkey/QR, or production device cutover.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerAccountBrowserCdpPortForTests,
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

const ENABLED = isTruthyEnvValue(process.env.OPENBOT_ACCOUNT_WORKER_LIVE_LOGIN_E2E);

/** Public demo IdP — credentials are printed on the page itself. */
const DEFAULT_LIVE_LOGIN_URL = "https://authenticationtest.com/simpleFormAuth/";
const DEFAULT_LIVE_LOGIN_HOST = "authenticationtest.com";
const DEFAULT_LIVE_LOGIN_USER = "simpleForm@authenticationtest.com";
const DEFAULT_LIVE_LOGIN_PASSWORD = "pa$$w0rd";
const DEFAULT_SUCCESS_URL_RE = "loginSuccess";

const BRIEF_REL =
  "docs/design/account-computer-worker-live-login-e2e-acceptance-brief-2026-10-18.md";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BRIEF_PATH = path.join(REPO_ROOT, BRIEF_REL);

const TENANT = "tenant-worker-live";
const USER = "user-worker-live";
const SESSION = "worker-live-login-session";

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
    req: { type: "req", id: "req-worker-live", method },
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
    req: { type: "req", id: "req-preview-worker", method: "browser.preview" },
    isWebchatConnect: () => false,
  });
  return { ...respond, broadcasts };
}

/**
 * Vitest isolates HOME; Docker Desktop sock may need DOCKER_HOST.
 * When the gate is on: honor existing DOCKER_HOST; else auto-point at the
 * Desktop sock; unreachable daemon must fail loud (not soft-pass).
 */
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
      "OPENBOT_ACCOUNT_WORKER_LIVE_LOGIN_E2E=1 requires a real sandbox browser image",
      `(tried ${images.browserImage} and ${DEFAULT_SANDBOX_BROWSER_IMAGE}).`,
      "Alpine smoke is not enough for Chromium CDP login. Build/pull the browser image,",
      `or set ${ACCOUNT_WORKER_BROWSER_IMAGE_ENV}.`,
    ].join(" "),
  );
}

describe("Account Computer Worker Docker live-login e2e (gated)", () => {
  it("documents gate + acceptance brief without requiring Docker", () => {
    expect(BRIEF_PATH).toContain("account-computer-worker-live-login-e2e-acceptance-brief");
    expect(fs.existsSync(BRIEF_PATH)).toBe(true);
    const brief = fs.readFileSync(BRIEF_PATH, "utf8");
    expect(brief).toContain("OPENBOT_ACCOUNT_WORKER_LIVE_LOGIN_E2E");
    expect(brief).toContain("authenticationtest.com");
    expect(brief).toMatch(/交给AI|自动|Hand to AI|auto/i);
    expect(brief).not.toContain("交还");
    expect(brief).toMatch(/Account Worker Docker|worker Docker/i);
    expect(DEFAULT_LIVE_LOGIN_USER).toContain("@authenticationtest.com");
    expect(DEFAULT_LIVE_LOGIN_PASSWORD.length).toBeGreaterThan(0);
    if (!ENABLED) {
      expect(isTruthyEnvValue(process.env.OPENBOT_ACCOUNT_WORKER_LIVE_LOGIN_E2E)).toBe(false);
    }
  });

  describe.runIf(ENABLED)("Account Worker Docker browser + Secure Form fill host", () => {
    const holder = resolveAccountBrowserScopeKey({ tenantId: TENANT, userId: USER });
    let dockerHostRestore: (() => void) | null = null;
    let driver: (AccountWorkerSandboxDriver & { browserNames: Map<number, string> }) | null = null;
    let browserPid: number | null = null;
    let containerName = "";
    let cdpUrl = "";
    let tempRoot = "";

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
        password: "secret-vnc-worker-live",
        bridgeBaseUrl: "http://127.0.0.1:18789",
        scopeKey: "scope-worker-live-login",
        containerName: "openbot-sb-browser-worker-live-login",
        agentLabel: "Ada",
      });
    });

    afterEach(async () => {
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
      setSecureFormFillDepsForTests(null);
      resetSecureFormFillHostWiredForTests();
      resetAccountBrowserCdpPortsForTests();
    });

    it(
      "fills public demo login via Worker Docker CDP + Secure Form, then handoff → 给AI",
      { timeout: 180_000 },
      async () => {
        const host = ensureDockerHostForE2E();
        dockerHostRestore = host.restore;
        if (!(await dockerDaemonReachable())) {
          throw new Error(
            [
              "OPENBOT_ACCOUNT_WORKER_LIVE_LOGIN_E2E=1 but the docker daemon is unreachable.",
              "Honor an existing DOCKER_HOST, or set DOCKER_HOST=unix://$HOME/.docker/run/docker.sock",
              "for Docker Desktop, then re-run. Ungated suites stay green without a daemon.",
              `DOCKER_HOST=${JSON.stringify(process.env.DOCKER_HOST ?? "")}`,
            ].join(" "),
          );
        }

        const browserImage = await resolveWorkerBrowserImage();
        tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "aw-worker-live-login-"));
        await fsp.mkdir(path.join(tempRoot, "browser"), { recursive: true });

        const spec: RuntimeContainerSpec = {
          runtimeLeaseId: `worker-live-${Date.now()}`,
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
        expect(await driver.browserAlive(browserPid)).toBe(true);

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

        // Navigate inside the worker container Chromium (same CDP fill-host uses).
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
        expect(JSON.stringify(handoff.broadcasts)).not.toContain("secret-vnc-worker-live");

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
        expect(JSON.stringify(awaitBody)).not.toContain("secret-vnc-worker-live");

        // Still the worker container (not a host Chrome we launched).
        expect(await driver.browserAlive(browserPid)).toBe(true);
        expect(containerName.startsWith("aw-browser-")).toBe(true);
      },
    );
  });
});

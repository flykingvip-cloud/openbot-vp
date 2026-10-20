import { chromium } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SsrFBlockedError } from "../infra/net/ssrf.js";
import { withFetchPreconnect } from "../test-utils/fetch-mock.js";
import * as chromeModule from "./chrome.js";
import {
  ACCOUNT_COMPUTER_DESKTOP_PAGE_URL,
  InvalidBrowserNavigationUrlError,
} from "./navigation-guard.js";
import * as pwAiModule from "./pw-ai-module.js";
import * as pwAi from "./pw-ai.js";
import { closePlaywrightBrowserConnection } from "./pw-session.js";
import { registerBrowserAgentSnapshotRoutes } from "./routes/agent.snapshot.js";
import type {
  BrowserResponse,
  BrowserRouteHandler,
  BrowserRouteRegistrar,
} from "./routes/types.js";
import { createBrowserRouteContext } from "./server-context.js";
import { makeState } from "./server-context.remote-tab-ops.harness.js";

const originalFetch = globalThis.fetch;

function loopbackState() {
  const state = makeState("openclaw");
  state.resolved.ssrfPolicy = undefined;
  state.resolved.accountComputerWorkArea = true;
  return state;
}

function openLoopback(state = loopbackState()) {
  const ctx = createBrowserRouteContext({ getState: () => state });
  return { state, openclaw: ctx.forProfile("openclaw") };
}

function installBrowserMocks() {
  let currentUrl = "about:blank";
  const pageGoto = vi.fn(async (url: unknown): Promise<unknown> => {
    currentUrl = String(url);
    return null;
  });
  const page = {
    on: vi.fn(),
    goto: pageGoto,
    title: vi.fn(async () => "JD"),
    url: vi.fn(() => currentUrl),
    context: () => context,
  };
  const context = {
    pages: () => [],
    on: vi.fn(),
    newPage: vi.fn(async () => page),
    newCDPSession: vi.fn(async () => ({
      send: vi.fn(async (method: string) => {
        if (method === "Target.getTargetInfo") {
          return { targetInfo: { targetId: "TAB_JD" } };
        }
        return {};
      }),
      detach: vi.fn(async () => {}),
    })),
  };
  page.context = () => context;
  const browser = {
    contexts: () => [context],
    on: vi.fn(),
    close: vi.fn(async () => {}),
  };
  vi.spyOn(chromium, "connectOverCDP").mockResolvedValue(browser as never);
  vi.spyOn(chromeModule, "getChromeWebSocketUrl").mockResolvedValue(null);
  return { pageGoto };
}

afterEach(async () => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  await closePlaywrightBrowserConnection().catch(() => {});
});

describe("account computer openTab", () => {
  it("opens a public URL through Playwright when the loopback policy is strict", async () => {
    const createPageViaPlaywright = vi.fn(async (..._args: unknown[]) => ({
      targetId: "TAB_JD",
      title: "京东",
      url: "https://www.jd.com/",
      type: "page",
    }));
    vi.spyOn(pwAiModule, "getPwAiModule").mockResolvedValue({
      createPageViaPlaywright,
    } as unknown as Awaited<ReturnType<typeof pwAiModule.getPwAiModule>>);

    const { openclaw } = openLoopback();
    const opened = await openclaw.openTab("https://www.jd.com");

    expect(opened).toMatchObject({ targetId: "TAB_JD", url: "https://www.jd.com/" });
    expect(createPageViaPlaywright).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://www.jd.com",
        allowAccountComputerDesktopPage: true,
      }),
    );
    expect(createPageViaPlaywright.mock.calls[0]?.[0]).not.toHaveProperty("ssrfPolicy");
  });

  it("still blocks a redirect onto a private address", async () => {
    const { pageGoto } = installBrowserMocks();
    pageGoto.mockResolvedValueOnce({
      request: () => ({
        url: () => "https://93.184.216.34/final",
        redirectedFrom: () => ({
          url: () => "http://127.0.0.1:18080/internal-hop",
          redirectedFrom: () => ({
            url: () => "https://93.184.216.34/start",
            redirectedFrom: () => null,
          }),
        }),
      }),
    });

    const { openclaw } = openLoopback();
    await expect(openclaw.openTab("https://93.184.216.34/start")).rejects.toBeInstanceOf(
      SsrFBlockedError,
    );
    expect(pageGoto).toHaveBeenCalled();
  });

  it("allows only the Account Computer desktop file URL", async () => {
    const { pageGoto } = installBrowserMocks();
    const { openclaw } = openLoopback();

    const opened = await openclaw.openTab(ACCOUNT_COMPUTER_DESKTOP_PAGE_URL);
    expect(opened.targetId).toBe("TAB_JD");
    expect(pageGoto).toHaveBeenCalledWith(ACCOUNT_COMPUTER_DESKTOP_PAGE_URL, { timeout: 30_000 });

    await expect(openclaw.openTab("file:///etc/passwd")).rejects.toBeInstanceOf(
      InvalidBrowserNavigationUrlError,
    );

    const plain = makeState("openclaw");
    plain.resolved.ssrfPolicy = undefined;
    const { openclaw: withoutDesktop } = openLoopback(plain);
    await expect(withoutDesktop.openTab(ACCOUNT_COMPUTER_DESKTOP_PAGE_URL)).rejects.toBeInstanceOf(
      InvalidBrowserNavigationUrlError,
    );
  });

  it("throws the redirect-hop error only when Playwright is unavailable", async () => {
    vi.spyOn(pwAiModule, "getPwAiModule").mockResolvedValue(null);
    const { openclaw } = openLoopback();
    await expect(openclaw.openTab("https://www.jd.com")).rejects.toThrow(
      /Playwright-backed redirect-hop inspection/,
    );
  });

  it("navigates a fresh sandbox browser by opening about:blank under strict SSRF", async () => {
    installBrowserMocks();
    vi.spyOn(chromeModule, "isChromeReachable").mockResolvedValue(true);
    vi.spyOn(chromeModule, "isChromeCdpReady").mockResolvedValue(true);
    const navigateViaPlaywright = vi
      .spyOn(pwAi, "navigateViaPlaywright")
      .mockResolvedValue({ url: "https://www.jd.com/" });

    const blankTab = {
      id: "TAB_BLANK",
      title: "",
      url: "about:blank",
      webSocketDebuggerUrl: "ws://127.0.0.1:18800/devtools/page/TAB_BLANK",
      type: "page",
    };
    let listed = false;
    globalThis.fetch = withFetchPreconnect(async (url: unknown) => {
      const target = String(url);
      if (!target.includes("/json/list")) {
        throw new Error(`unexpected fetch: ${target}`);
      }
      const body = listed ? [blankTab] : [];
      listed = true;
      return { ok: true, json: async () => body } as unknown as Response;
    });

    const state = loopbackState();
    const ctx = createBrowserRouteContext({ getState: () => state });
    const routes = new Map<string, BrowserRouteHandler>();
    const app: BrowserRouteRegistrar = {
      get: () => {},
      delete: () => {},
      post: (path, handler) => {
        routes.set(path, handler);
      },
    };
    registerBrowserAgentSnapshotRoutes(app, ctx);

    let status = 200;
    let payload: unknown;
    const res: BrowserResponse = {
      status(code: number) {
        status = code;
        return res;
      },
      json(body: unknown) {
        payload = body;
      },
    };
    await routes.get("/navigate")?.(
      { params: {}, query: {}, body: { url: "https://www.jd.com" } },
      res,
    );

    expect(status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      targetId: "TAB_BLANK",
      url: "https://www.jd.com/",
    });
    expect(navigateViaPlaywright).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "TAB_BLANK",
        url: "https://www.jd.com",
      }),
    );
    expect(navigateViaPlaywright.mock.calls[0]?.[0]).not.toHaveProperty("ssrfPolicy");
  });
});

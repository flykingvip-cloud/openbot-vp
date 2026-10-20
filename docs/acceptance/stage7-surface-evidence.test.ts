/**
 * Stage 7 console probe.
 *
 * Renders the production channel surface and overview into a jsdom document.
 * The channel request is sent on a live in-process Gateway websocket after
 * hello-ok. The unauthorized overview uses the error string that same Gateway
 * returned. This is not a device browser and not a separate OS process.
 */
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  connectOk,
  connectReq,
  createGatewaySuiteHarness,
  installGatewayTestHooks,
  rpcReq,
  testState,
} from "../../src/gateway/test-helpers.ts";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../src/utils/message-channel.ts";
import type { OverviewProps } from "../../ui/src/ui/views/overview.ts";

function jsdomEntry(): string {
  const root = path.resolve("node_modules/.pnpm");
  const dir = fs.readdirSync(root).find((name) => name.startsWith("jsdom@"));
  if (!dir) {
    throw new Error("jsdom package is not installed");
  }
  return path.join(root, dir, "node_modules/jsdom/lib/api.js");
}

const litDir = path.dirname(fs.realpathSync(path.resolve("node_modules/lit")));
const jsdomModule = (await import(pathToFileURL(jsdomEntry()).href)) as {
  JSDOM: new (
    html: string,
    options?: { url?: string; pretendToBeVisual?: boolean },
  ) => { window: Window & typeof globalThis };
};
const dom = new jsdomModule.JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://127.0.0.1:18789/",
  pretendToBeVisual: true,
});
const view = globalThis as typeof globalThis & {
  window: Window & typeof globalThis;
  document: Document;
  HTMLElement: typeof HTMLElement;
  Node: typeof Node;
  Element: typeof Element;
  DocumentFragment: typeof DocumentFragment;
  Comment: typeof Comment;
  customElements: CustomElementRegistry;
  MutationObserver: typeof MutationObserver;
  getComputedStyle: typeof getComputedStyle;
  requestAnimationFrame: typeof requestAnimationFrame;
  cancelAnimationFrame: typeof cancelAnimationFrame;
};
view.window = dom.window;
view.document = dom.window.document;
view.HTMLElement = dom.window.HTMLElement;
view.Node = dom.window.Node;
view.Element = dom.window.Element;
view.DocumentFragment = dom.window.DocumentFragment;
view.Comment = dom.window.Comment;
view.customElements = dom.window.customElements;
view.MutationObserver = dom.window.MutationObserver;
view.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
view.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
view.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

await Promise.resolve(
  register(new URL("./stage7-lit-production-hook.mjs", import.meta.url).href, {
    parentURL: import.meta.url,
    data: {
      litHtml: path.join(litDir, "lit-html/lit-html.js"),
      reactive: path.join(litDir, "@lit/reactive-element/reactive-element.js"),
    },
  }),
);

installGatewayTestHooks({ scope: "suite" });

const TOKEN = "stage7-console-evidence-token";
const CONTROL_UI = {
  id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
  version: "1.0.0",
  platform: "test",
  mode: GATEWAY_CLIENT_MODES.UI,
};

function mount(): HTMLElement {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.append(container);
  return container;
}

function overviewProps(lastError: string): OverviewProps {
  return {
    connected: false,
    hello: null,
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "not-the-gateway-token",
      sessionKey: "main",
    } as OverviewProps["settings"],
    password: "",
    bootstrapAuthMode: null,
    bootstrapAuthSession: null,
    platformAuthState: null,
    lastError,
    lastErrorCode: "AUTH_TOKEN_MISMATCH",
    presenceCount: 0,
    sessionsCount: 0,
    cronEnabled: null,
    cronNext: null,
    lastChannelsRefresh: null,
    onSettingsChange: vi.fn(),
    onPasswordChange: vi.fn(),
    onSessionKeyChange: vi.fn(),
    onConnect: vi.fn(),
    onRefresh: vi.fn(),
    onPlatformAuthModeChange: vi.fn(),
    onPlatformAuthEmailChange: vi.fn(),
    onPlatformAuthPasswordChange: vi.fn(),
    onPlatformAuthDisplayNameChange: vi.fn(),
    onPlatformAuthPlatformAdminDisplayNameChange: vi.fn(),
    onPlatformAuthTenantNameChange: vi.fn(),
    onPlatformAuthSeatTitleChange: vi.fn(),
    onPlatformAuthInviteCodeChange: vi.fn(),
    onPlatformAuthCurrentPasswordChange: vi.fn(),
    onPlatformAuthNewPasswordChange: vi.fn(),
    onPlatformAuthPolicyTrialDaysChange: vi.fn(),
    onPlatformAuthPolicySeatCountChange: vi.fn(),
    onPlatformAuthPolicyUpgradeUrlChange: vi.fn(),
    onPlatformAuthPolicyContactAdvisorUrlChange: vi.fn(),
    onPlatformAuthInstanceEnterpriseIdChange: vi.fn(),
    onPlatformAuthInstanceTrialDaysChange: vi.fn(),
    onPlatformAuthInstanceSeatCountChange: vi.fn(),
    onPlatformAuthInstanceUpgradeUrlChange: vi.fn(),
    onPlatformAuthInstanceContactAdvisorUrlChange: vi.fn(),
    onPlatformAuthSubmit: vi.fn(),
    onPlatformAuthCreatePlatformAdmin: vi.fn(),
    onPlatformAuthLogout: vi.fn(),
    onPlatformAuthCreateInvite: vi.fn(),
    onPlatformAuthRevokeInvite: vi.fn(),
    onPlatformAuthRemoveMember: vi.fn(),
    onPlatformAuthChangePassword: vi.fn(),
    onPlatformAuthUpdateTrialPolicy: vi.fn(),
    onPlatformAuthUpdateTrialInstance: vi.fn(),
    platformAuthMode: "login",
    platformAuthBusy: false,
    platformAuthError: null,
    platformAuthNotice: null,
    platformAuthEmail: "",
    platformAuthPassword: "",
    platformAuthDisplayName: "",
    platformAuthPlatformAdminDisplayName: "",
    platformAuthTenantName: "",
    platformAuthSeatTitle: "",
    platformAuthInviteCode: "",
    platformAuthCurrentPassword: "",
    platformAuthNewPassword: "",
    platformAuthPolicyTrialDays: "",
    platformAuthPolicySeatCount: "",
    platformAuthPolicyUpgradeUrl: "",
    platformAuthPolicyContactAdvisorUrl: "",
    platformAuthInstanceEnterpriseId: "",
    platformAuthInstanceTrialDays: "",
    platformAuthInstanceSeatCount: "",
    platformAuthInstanceUpgradeUrl: "",
    platformAuthInstanceContactAdvisorUrl: "",
    platformAuthPlatformAdminEmail: "",
    platformAuthPlatformAdminPassword: "",
    platformAuthPlatformAdminScopes: [],
    onPlatformAuthPlatformAdminEmailChange: vi.fn(),
    onPlatformAuthPlatformAdminPasswordChange: vi.fn(),
    onPlatformAuthPlatformAdminScopesChange: vi.fn(),
  };
}

function useTokenAuth(): void {
  testState.gatewayAuth = { mode: "token", token: TOKEN };
  process.env.OPENCLAW_GATEWAY_TOKEN = TOKEN;
}

describe("stage 7 console surface", () => {
  afterAll(() => {
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
  });

  it("opens the channel surface and the live gateway handles channels.status", async () => {
    useTokenAuth();
    const harness = await createGatewaySuiteHarness();
    const ws = await harness.openWs({
      origin: `http://127.0.0.1:${harness.port}`,
    });
    try {
      const hello = await connectOk(ws, { client: CONTROL_UI });
      expect(hello.type).toBe("hello-ok");

      const calls: Array<{ method: string; params: unknown }> = [];
      const client = {
        request: async (method: string, params?: unknown) => {
          calls.push({ method, params });
          const res = await rpcReq(ws, method, params, 20_000);
          if (!res.ok) {
            throw new Error(res.error?.message ?? `${method} failed`);
          }
          return res.payload;
        },
      };

      const { render } = await import("lit");
      const { renderEnterpriseMessageChannelsSurface } =
        await import("../../ui/src/ui/ports/enterprise/views/enterprise-message-channels-surface.ts");
      const host = {};
      const container = mount();
      let draws = 0;
      const draw = () => {
        draws += 1;
        if (draws > 6) {
          throw new Error(`channel surface rerendered ${draws} times`);
        }
        render(
          renderEnterpriseMessageChannelsSurface({
            host,
            props: { client: client as never, tenantId: "tenant-a" },
            requestUpdate: draw,
          }),
          container,
        );
      };

      draw();
      await vi.waitFor(
        () => {
          expect(calls.some((call) => call.method === "channels.status")).toBe(true);
          expect(container.textContent).toContain("企业通道");
          expect(container.textContent).toContain("企业微信");
          expect(
            container.querySelector(".enterprise-channel-workspace__result--danger"),
          ).toBeNull();
        },
        { timeout: 20_000 },
      );

      const statusCall = calls.find((call) => call.method === "channels.status");
      expect(statusCall?.params).toMatchObject({ tenantId: "tenant-a" });
      expect(calls.some((call) => call.method === "config.get")).toBe(true);
      expect(draws).toBeLessThanOrEqual(6);
    } finally {
      ws.close();
      await harness.close();
    }
  });

  it("shows the gateway unauthorized error and does not enter the ok state", async () => {
    useTokenAuth();
    const harness = await createGatewaySuiteHarness();
    const ws = await harness.openWs({
      origin: `http://127.0.0.1:${harness.port}`,
    });
    try {
      const refused = await connectReq(ws, {
        token: "wrong-token",
        client: CONTROL_UI,
      });
      expect(refused.ok).toBe(false);
      expect(refused.payload?.type).not.toBe("hello-ok");
      const gatewayError = refused.error?.message ?? "";
      expect(gatewayError).toContain("gateway token mismatch");

      const { render } = await import("lit");
      const { renderOverview } = await import("../../ui/src/ui/views/overview.ts");
      const container = mount();
      render(renderOverview(overviewProps(gatewayError)), container);

      const danger = container.querySelector(".callout.danger");
      expect(danger?.textContent).toContain("gateway token mismatch");
      expect(danger?.textContent).toContain("unauthorized");
      const status = container.querySelector(".stat-value");
      expect(status?.classList.contains("ok")).toBe(false);
      expect(status?.classList.contains("warn")).toBe(true);
      expect(container.querySelector(".stat-value.ok")).toBeNull();
    } finally {
      ws.close();
      await harness.close();
    }
  });
});

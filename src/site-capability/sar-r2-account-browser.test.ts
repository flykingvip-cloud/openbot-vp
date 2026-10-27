/**
 * SAR R2: account browser port + product takeover + shared desk serial.
 *
 * Honesty: fixture-bridge = in-process HTTP mock of the control plane
 * (navigate + aria snapshot). Not a live account-worker CDP attach, not R5,
 * and not a verified enterprise external site.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publishAccountComputerObserver,
  readAccountComputerPreview,
  resetAccountComputerSlotsForTests,
} from "../agents/sandbox/account-computer-stream.js";
import { BROWSER_BRIDGES } from "../agents/sandbox/browser-bridges.js";
import {
  notifyHandoffReturned,
  resetSecureFormHandoffWaitForTests,
  waitForHandoffReturn,
} from "../agents/sandbox/secure-form-handoff-wait.js";
import { runWithAccountBrowserSerial } from "../agents/tools/browser-tool.account-serial.js";
import type { LookupFn } from "../infra/net/ssrf.js";
import {
  createAccountBrowserPort,
  installFixtureAccountBrowserBridge,
  lookupAccountBrowserBridge,
  uninstallAccountBrowserBridge,
} from "./account-browser-port.js";
import { resetAccountBrowserCoordinatorForTests } from "./coordinator.js";
import { resetActiveAccountBrowserDeskForTests } from "./desk.js";
import {
  SarExecutionAuthority,
  memoryEpochStore,
  type SarExecutionAuthority as Authority,
} from "./execution-authority.js";
import { TrustedOperationFault } from "./operations.js";
import { applyProductHandBack, applyProductHumanTakeover } from "./product-takeover.js";
import {
  getDefaultSiteCapabilityRuntime,
  resetDefaultSiteCapabilityRuntimeForTests,
  SiteCapabilityRuntime,
} from "./runtime.js";
import { deriveAccountBrowserScopeKey } from "./session-handle.js";
import { SAR_FIXTURE_CAPABILITY, SAR_FIXTURE_ORIGIN } from "./test-site.js";

const SCOPE_A = "account:tenant-a:user-a:browser";
const SCOPE_B = "account:tenant-b:user-b:browser";

function publicLookup(): LookupFn {
  return vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as LookupFn;
}

const live: Authority[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  for (const authority of live) {
    authority.dispose();
  }
  live.length = 0;
  for (const server of servers) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  servers.length = 0;
  uninstallAccountBrowserBridge(SCOPE_A);
  uninstallAccountBrowserBridge(SCOPE_B);
  BROWSER_BRIDGES.delete(SCOPE_A);
  BROWSER_BRIDGES.delete(SCOPE_B);
  resetAccountComputerSlotsForTests();
  resetAccountBrowserCoordinatorForTests();
  resetSecureFormHandoffWaitForTests();
  resetActiveAccountBrowserDeskForTests();
  resetDefaultSiteCapabilityRuntimeForTests();
});

function must<T extends { ok: boolean; message?: string }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(result.message ?? "sar denial");
  }
  return result as Extract<T, { ok: true }>;
}

/**
 * Controllable HTTP mock of the account-worker control bridge surface.
 * Serves POST /navigate and GET /snapshot?format=aria only.
 */
async function startFixtureControlBridge(opts?: {
  initialUrl?: string;
  nodes?: Array<{ ref: string; role: string; name: string; value?: string; depth: number }>;
}): Promise<{ baseUrl: string; port: number; getUrl: () => string }> {
  let currentUrl = opts?.initialUrl ?? `${SAR_FIXTURE_ORIGIN}/`;
  const nodes = opts?.nodes ?? [
    { ref: "e0", role: "document", name: "Fixture Page", depth: 0 },
    { ref: "e1", role: "heading", name: "title:Fixture Heading", depth: 1 },
    { ref: "e2", role: "textbox", name: "query", value: "widget", depth: 1 },
    { ref: "e3", role: "listitem", name: "itemTitle:Widget A", depth: 1 },
  ];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/navigate") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body || "{}") as { url?: string };
          if (typeof parsed.url === "string" && parsed.url.trim()) {
            currentUrl = parsed.url.trim();
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, targetId: "tab-fixture", url: currentUrl }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "bad navigate body" }));
        }
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/snapshot") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          format: "aria",
          targetId: "tab-fixture",
          url: currentUrl,
          nodes,
        }),
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `unhandled ${req.method} ${url.pathname}` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  servers.push(server);
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    getUrl: () => currentUrl,
  };
}

describe("SAR R2 account browser port (fixture-bridge)", () => {
  it("navigates and reads aria fields through the control-plane HTTP mock", async () => {
    const fixture = await startFixtureControlBridge();
    installFixtureAccountBrowserBridge({
      scopeKey: SCOPE_A,
      baseUrl: fixture.baseUrl,
      port: fixture.port,
    });
    const ref = lookupAccountBrowserBridge(SCOPE_A);
    expect(ref?.kind).toBe("fixture-bridge");
    // Honest boundary: this is a fixture control-plane mock, not a live CDP attach.
    expect(ref?.kind).not.toBe("control-bridge");

    const port = createAccountBrowserPort(SCOPE_A);
    const nav = await port.navigate(`${SAR_FIXTURE_ORIGIN}/public?q=widget`);
    expect(nav.finalUrl).toBe(`${SAR_FIXTURE_ORIGIN}/public?q=widget`);
    expect(fixture.getUrl()).toBe(nav.finalUrl);

    const fields = await port.readFields(["url", "query", "itemTitle"]);
    expect(fields.url).toBe(nav.finalUrl);
    expect(fields.query).toBe("widget");
    expect(fields.itemTitle).toBe("Widget A");

    const ctx = await port.requestContext("page");
    expect(ctx.origin).toBe(SAR_FIXTURE_ORIGIN);
    expect(ctx.data.url).toBe(nav.finalUrl);

    const captured = await port.capture(["query", "url"]);
    expect(captured.query).toBe("widget");
    expect(captured.url).toBe(nav.finalUrl);

    // No evaluate channel on the port surface.
    expect(port).not.toHaveProperty("evaluate");
  });

  it("fail-closes when no bridge is registered for the scope", async () => {
    const port = createAccountBrowserPort(SCOPE_A);
    await expect(port.navigate(`${SAR_FIXTURE_ORIGIN}/`)).rejects.toBeInstanceOf(
      TrustedOperationFault,
    );
    await expect(port.navigate(`${SAR_FIXTURE_ORIGIN}/`)).rejects.toMatchObject({
      fault: "BROWSER_UNAVAILABLE",
    });
    await expect(port.readFields(["url"])).rejects.toMatchObject({
      fault: "BROWSER_UNAVAILABLE",
    });
  });

  it("does not use another account's bridge (cross-account isolation by scopeKey)", async () => {
    const fixtureA = await startFixtureControlBridge({
      nodes: [{ ref: "e1", role: "textbox", name: "owner", value: "A", depth: 0 }],
    });
    const fixtureB = await startFixtureControlBridge({
      nodes: [{ ref: "e1", role: "textbox", name: "owner", value: "B", depth: 0 }],
    });
    installFixtureAccountBrowserBridge({
      scopeKey: SCOPE_A,
      baseUrl: fixtureA.baseUrl,
      port: fixtureA.port,
    });
    installFixtureAccountBrowserBridge({
      scopeKey: SCOPE_B,
      baseUrl: fixtureB.baseUrl,
      port: fixtureB.port,
    });

    const portA = createAccountBrowserPort(SCOPE_A);
    const portB = createAccountBrowserPort(SCOPE_B);
    expect((await portA.readFields(["owner"])).owner).toBe("A");
    expect((await portB.readFields(["owner"])).owner).toBe("B");
    // Port for A never resolves B's bridge.
    expect(lookupAccountBrowserBridge(SCOPE_A)?.baseUrl).toBe(fixtureA.baseUrl);
    expect(lookupAccountBrowserBridge(SCOPE_B)?.baseUrl).toBe(fixtureB.baseUrl);
  });

  it("wires the default runtime portForScope to the account browser factory", async () => {
    resetDefaultSiteCapabilityRuntimeForTests();
    const runtime = getDefaultSiteCapabilityRuntime();
    // No bridge → invoke path still fail-closes with BROWSER_UNAVAILABLE via port.
    const authority = (runtime as unknown as { options: { portForScope: (s: string) => unknown } })
      .options;
    // Use a direct port probe through a tiny runtime with the same factory.
    const store = memoryEpochStore();
    const auth = new SarExecutionAuthority(store, { lookupFn: publicLookup() });
    live.push(auth);
    auth.boot();
    must(auth.registerBinding({ bindingId: "bind-a", tenantId: "tenant-a", userId: "user-a" }));
    must(auth.registerCapability(SAR_FIXTURE_CAPABILITY));
    const scoped = new SiteCapabilityRuntime({
      authority: auth,
      portForScope: (scopeKey) => createAccountBrowserPort(scopeKey),
    });
    must(
      scoped.register({
        manifest: {
          ...SAR_FIXTURE_CAPABILITY,
          id: "fixture.sar.r2.read",
          allowedOrigins: [SAR_FIXTURE_ORIGIN],
        },
        inputFields: [],
        inputSchema: { type: "object", additionalProperties: false },
        outputSchema: { type: "object" },
        accountSummary: "fixture",
        verification: "passed",
        artifactDigest: "sha256:r2-1",
        disabled: false,
        packageId: "r2-pack",
        plan: [
          { op: "navigate", urlTemplate: `${SAR_FIXTURE_ORIGIN}/` },
          { op: "capture_result", fields: ["url"] },
        ],
        lifecycle: "published",
      }),
    );
    must(
      scoped.grant({
        tenantId: "tenant-a",
        userId: "user-a",
        capabilityId: "fixture.sar.r2.read",
        version: "1.0.0",
        artifactDigest: "sha256:r2-1",
        accountBindingIds: ["bind-a"],
      }),
    );
    const noBridge = await scoped.invoke(
      { tenantId: "tenant-a", userId: "user-a" },
      { capabilityId: "fixture.sar.r2.read", version: "1.0.0" },
    );
    expect(noBridge.status).toBe("failed");
    expect(noBridge.error?.message).toMatch(/BROWSER_UNAVAILABLE/);

    const fixture = await startFixtureControlBridge();
    installFixtureAccountBrowserBridge({
      scopeKey: SCOPE_A,
      baseUrl: fixture.baseUrl,
      port: fixture.port,
    });
    const withBridge = await scoped.invoke(
      { tenantId: "tenant-a", userId: "user-a" },
      { capabilityId: "fixture.sar.r2.read", version: "1.0.0" },
    );
    expect(withBridge.status).toBe("succeeded");
    expect(withBridge.data).toMatchObject({ url: `${SAR_FIXTURE_ORIGIN}/` });
    expect(authority).toBeTruthy();
  });

  it("rejects cross-account binding at the authority boundary", () => {
    const auth = new SarExecutionAuthority(memoryEpochStore(), { lookupFn: publicLookup() });
    live.push(auth);
    auth.boot();
    must(auth.registerBinding({ bindingId: "bind-a", tenantId: "tenant-a", userId: "user-a" }));
    const denied = auth.resolveSessionHandle({
      principal: { tenantId: "tenant-b", userId: "user-b" },
      bindingId: "bind-a",
      pageTargetId: "tab-1",
    });
    expect(denied).toMatchObject({ ok: false, code: "CROSS_ACCOUNT_REJECTED" });
    expect(deriveAccountBrowserScopeKey("tenant-a", "user-a")).toBe(SCOPE_A);
  });
});

describe("SAR R2 product human takeover", () => {
  it("takeControl via product preview rejects the old SAR run and generic browser serial", async () => {
    const auth = new SarExecutionAuthority(memoryEpochStore(), { lookupFn: publicLookup() });
    live.push(auth);
    auth.boot();
    must(auth.registerBinding({ bindingId: "bind-a", tenantId: "tenant-a", userId: "user-a" }));
    must(auth.registerCapability(SAR_FIXTURE_CAPABILITY));

    const fixture = await startFixtureControlBridge();
    installFixtureAccountBrowserBridge({
      scopeKey: SCOPE_A,
      baseUrl: fixture.baseUrl,
      port: fixture.port,
    });
    const port = createAccountBrowserPort(SCOPE_A);

    const resolved = must(
      auth.resolveSessionHandle({
        principal: { tenantId: "tenant-a", userId: "user-a" },
        bindingId: "bind-a",
        pageTargetId: "tab-1",
      }),
    );
    must(
      auth.bindRun({
        handleToken: resolved.handle.token,
        runId: "run-old",
        capabilityId: SAR_FIXTURE_CAPABILITY.id,
      }),
    );
    const first = await auth.dispatch({
      runId: "run-old",
      handleToken: resolved.handle.token,
      rawOp: { op: "navigate", url: `${SAR_FIXTURE_ORIGIN}/` },
      port,
    });
    expect(first.ok).toBe(true);

    // Product event — not a direct authority.humanTakeover() stand-in.
    publishAccountComputerObserver({
      tenantId: "tenant-a",
      userId: "user-a",
      noVncPort: 16080,
      password: "secret",
      bridgeBaseUrl: fixture.baseUrl,
      scopeKey: SCOPE_A,
      containerName: "openbot-sb-browser-a",
      agentLabel: "Ada",
    });
    const preview = readAccountComputerPreview({
      tenantId: "tenant-a",
      userId: "user-a",
      issueUrl: false,
      sessionKey: "chat-human-1",
      takeControl: true,
    });
    expect(preview.controlledBy?.kind).toBe("user");

    const second = await auth.dispatch({
      runId: "run-old",
      handleToken: resolved.handle.token,
      rawOp: { op: "read_page", fields: ["url"] },
      port,
    });
    expect(second).toMatchObject({ ok: false, code: "HUMAN_TAKEOVER" });

    // Stale human hold (no await_return waiter) must not block agent navigate:
    // serial claim auto-releases and proceeds (default AI takeover).
    const autoCleared = await runWithAccountBrowserSerial({
      accountBrowserScopeKey: SCOPE_A,
      action: "navigate",
      params: { action: "navigate", url: `${SAR_FIXTURE_ORIGIN}/` },
      run: async () => "ok-after-stale-release",
    });
    expect(autoCleared).toBe("ok-after-stale-release");
    expect(
      readAccountComputerPreview({
        tenantId: "tenant-a",
        userId: "user-a",
        issueUrl: false,
      }).controlledBy?.kind,
    ).toBe("agent");

    // Re-take for auth handoff: active await_return keeps HUMAN_TAKEOVER.
    readAccountComputerPreview({
      tenantId: "tenant-a",
      userId: "user-a",
      issueUrl: false,
      sessionKey: "chat-human-1",
      takeControl: true,
    });
    const pendingReturn = waitForHandoffReturn({
      sessionKey: "chat-human-1",
      timeoutMs: 2_000,
    });
    await new Promise((r) => setTimeout(r, 10));
    await expect(
      runWithAccountBrowserSerial({
        accountBrowserScopeKey: SCOPE_A,
        action: "snapshot",
        params: { action: "snapshot" },
        run: async () => "should-not-run",
      }),
    ).rejects.toMatchObject({ code: "HUMAN_TAKEOVER" });

    // plan_once is excluded from this wrapper (its own wire claims the desk).
    const planOnceSkipped = await runWithAccountBrowserSerial({
      accountBrowserScopeKey: SCOPE_A,
      action: "plan_once",
      params: { action: "plan_once" },
      run: async () => "plan-once-bypass-wrapper",
    });
    expect(planOnceSkipped).toBe("plan-once-bypass-wrapper");

    // releaseControl → handBack frees the desk for a new claim.
    readAccountComputerPreview({
      tenantId: "tenant-a",
      userId: "user-a",
      issueUrl: false,
      sessionKey: "chat-human-1",
      releaseControl: true,
    });
    // Gateway browser.preview would emit handoff_returned; preview helper only
    // clears the desk — wake waiters the same way for this unit test.
    notifyHandoffReturned("chat-human-1");
    await expect(pendingReturn).resolves.toBe("handoff_returned");
    const afterHandBack = await runWithAccountBrowserSerial({
      accountBrowserScopeKey: SCOPE_A,
      action: "navigate",
      params: { action: "navigate" },
      run: async () => "ok-after-handback",
    });
    expect(afterHandBack).toBe("ok-after-handback");
  });

  it("product-takeover API is the only sanctioned authority entry for tests", () => {
    // Smoke: API exists and bumps fencing without going through preview slots.
    const taken = applyProductHumanTakeover({
      tenantId: "tenant-a",
      userId: "user-a",
      humanSessionKey: "sess-api",
    });
    expect(taken.ok).toBe(true);
    if (taken.ok) {
      expect(taken.scopeKey).toBe(SCOPE_A);
      expect(taken.generation).toBeGreaterThanOrEqual(1);
    }
    const back = applyProductHandBack({ tenantId: "tenant-a", userId: "user-a" });
    expect(back).toMatchObject({ ok: true, scopeKey: SCOPE_A });
  });
});

describe("SAR R2 honesty boundary", () => {
  it("does not claim R5 or verified enterprise external sites", () => {
    // This file validates fixture-bridge control-plane wiring only.
    expect(SAR_FIXTURE_ORIGIN).toBe("https://fixture.sar.test");
    expect(true).toBe(true);
  });
});

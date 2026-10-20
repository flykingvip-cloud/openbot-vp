import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPlanOnceDepsFromBrowser,
  resetPlanOnceRunsForTests,
  runPlanOnceViaBrowser,
} from "../account-computer/browser-plan-once-wire.js";
import { DEFAULT_BROWSER_EVALUATE_ENABLED } from "../browser/constants.js";
import { SKILL_CAPABILITY_VERBS } from "../gateway/skill-capability-contract.js";
import type { LookupFn } from "../infra/net/ssrf.js";
import { SAR_P1_PRODUCT_TOOLS, SITE_EXECUTION_CONTRACT_ID } from "./contract.js";
import { AccountBrowserSerialDenied, resetActiveAccountBrowserDeskForTests } from "./desk.js";
import {
  SarExecutionAuthority,
  memoryEpochStore,
  type SarExecutionAuthority as Authority,
} from "./execution-authority.js";
import type { TrustedPagePort } from "./operations.js";
import { deriveAccountBrowserScopeKey, sessionHandleExposesOnlyToken } from "./session-handle.js";
import {
  SAR_FIXTURE_CAPABILITY,
  SAR_FIXTURE_CREDENTIALS,
  SAR_FIXTURE_GROUND_TRUTH,
  SAR_FIXTURE_ORIGIN,
  ControllableTestSite,
  createTestSitePort,
} from "./test-site.js";

const ADR_URL = new URL(
  "../../docs/design/sar-p0-controlled-execution-boundary-2026-10-17.md",
  import.meta.url,
);

function publicLookup(): LookupFn {
  return vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as LookupFn;
}

const live: Authority[] = [];

afterEach(() => {
  for (const authority of live) {
    authority.dispose();
  }
  live.length = 0;
  resetActiveAccountBrowserDeskForTests();
  resetPlanOnceRunsForTests();
});

function must<T extends { ok: boolean; message?: string }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(result.message ?? "sar denial");
  }
  return result as Extract<T, { ok: true }>;
}

function bootPair() {
  const store = memoryEpochStore();
  const authority = new SarExecutionAuthority(store, { lookupFn: publicLookup() });
  live.push(authority);
  const boot = authority.boot();
  must(authority.registerBinding({ bindingId: "bind-a", tenantId: "tenant-a", userId: "user-a" }));
  must(authority.registerBinding({ bindingId: "bind-b", tenantId: "tenant-b", userId: "user-b" }));
  must(
    authority.registerBinding({ bindingId: "bind-a2", tenantId: "tenant-a", userId: "user-other" }),
  );
  must(authority.registerCapability(SAR_FIXTURE_CAPABILITY));
  const site = new ControllableTestSite();
  const port = createTestSitePort(site);
  const resolved = must(
    authority.resolveSessionHandle({
      principal: { tenantId: "tenant-a", userId: "user-a" },
      bindingId: "bind-a",
      pageTargetId: "tab-1",
    }),
  );
  const bound = must(
    authority.bindRun({
      handleToken: resolved.handle.token,
      runId: "run-1",
      capabilityId: SAR_FIXTURE_CAPABILITY.id,
    }),
  );
  return { store, authority, boot, site, port, resolved, bound };
}

describe("P0-1 SessionHandle seam", () => {
  it("resolves an opaque handle onto the existing account-browser scope", () => {
    const { resolved, bound } = bootPair();
    expect(sessionHandleExposesOnlyToken(resolved.handle)).toBe(true);
    expect(resolved.handle).not.toHaveProperty("evaluate");
    expect(resolved.handle).not.toHaveProperty("cdpUrl");
    expect(JSON.parse(JSON.stringify(resolved.handle))).toEqual({
      token: expect.stringMatching(/^sarh_/),
    });
    expect(bound.scopeKey).toBe("account:tenant-a:user-a:browser");
    expect(deriveAccountBrowserScopeKey("tenant-a", "user-a")).toBe(bound.scopeKey);
    expect(SITE_EXECUTION_CONTRACT_ID).toBe("openbot.site-execution-contract");
    expect(SKILL_CAPABILITY_VERBS).not.toContain("site.invoke");
    expect(SAR_P1_PRODUCT_TOOLS.site_invoke).toBe("implemented");
  });

  it("documents the seam in the ADR and rejects raw CDP, profile, and host targets", () => {
    const adr = readFileSync(ADR_URL, "utf8");
    expect(adr).toContain("SessionHandle");
    expect(adr).toContain("skill-capability-contract");
    expect(adr).toContain("Bridge daemon");
    expect(adr).toContain("navigation-guard");

    const { authority } = bootPair();
    const cdp = authority.resolveSessionHandle({
      principal: { tenantId: "tenant-a", userId: "user-a" },
      bindingId: "bind-a",
      pageTargetId: "tab-1",
      adapterInput: { cdpUrl: "ws://127.0.0.1:9222/devtools/browser" },
    });
    expect(cdp).toMatchObject({ ok: false, code: "CDP_BYPASS_REJECTED" });

    const profile = authority.registerBinding({
      bindingId: "bind-x",
      tenantId: "tenant-a",
      userId: "user-a",
      userDataDir: "/tmp/profile",
    });
    expect(profile).toMatchObject({ ok: false, code: "PROFILE_OVERRIDE_REJECTED" });

    const host = authority.resolveSessionHandle({
      principal: { tenantId: "tenant-a", userId: "user-a" },
      bindingId: "bind-a",
      pageTargetId: "https://evil.example/cdp",
    });
    expect(host).toMatchObject({ ok: false, code: "HOST_TARGET_REJECTED" });
  });
});

describe("P0-2 finite server operations", () => {
  it("runs only declarative navigate, read, context, and capture", async () => {
    const { authority, site, port, resolved } = bootPair();
    const navigated = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "navigate", url: `${SAR_FIXTURE_ORIGIN}/search?q=widget` },
      port,
      productEvaluateEnabled: true,
    });
    expect(navigated.ok).toBe(true);
    if (navigated.ok) {
      expect(navigated.value).toMatchObject({ kind: "navigate" });
    }
    const captured = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "capture_result", fields: ["query", "items"] },
      port,
    });
    expect(captured.ok).toBe(true);
    if (captured.ok && captured.value.kind === "capture_result") {
      expect(captured.value.data.items).toEqual(SAR_FIXTURE_GROUND_TRUTH.search.items);
    }
    expect(site.search("widget").ok).toBe(true);

    const loginOp = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "login", username: SAR_FIXTURE_CREDENTIALS.username },
      port,
    });
    expect(loginOp).toMatchObject({ ok: false, code: "SAR_OP_NOT_IN_SET" });
  });
});

describe("P0-3 evaluate dual layer", () => {
  it("rejects out-of-set evaluation while the product default stays enabled", async () => {
    expect(DEFAULT_BROWSER_EVALUATE_ENABLED).toBe(true);
    const { authority, site, resolved } = bootPair();
    const evaluate = vi.fn(async (script: string) => script);
    const readFields = vi.fn(async (fields: readonly string[]) => site.readFields(fields));
    const port: TrustedPagePort & { evaluate: typeof evaluate } = {
      ...createTestSitePort(site),
      readFields,
      evaluate,
    };
    const script = "document.cookie";
    const denied = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "evaluate", fn: script },
      port,
      productEvaluateEnabled: DEFAULT_BROWSER_EVALUATE_ENABLED,
    });
    expect(denied).toMatchObject({
      ok: false,
      code: "SAR_EVALUATE_REJECTED",
      productEvaluateEnabled: true,
    });
    expect(evaluate).not.toHaveBeenCalled();
    expect(readFields).not.toHaveBeenCalled();

    const smuggled = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "read_page", fields: ["title"], script },
      port,
      productEvaluateEnabled: true,
    });
    expect(smuggled).toMatchObject({ ok: false, code: "SAR_EVALUATE_REJECTED" });
    expect(evaluate).not.toHaveBeenCalled();
    expect(readFields).not.toHaveBeenCalled();

    const manifest = authority.registerCapability({
      ...SAR_FIXTURE_CAPABILITY,
      id: "fixture.sar.eval",
      permissions: ["evaluate"],
    });
    expect(manifest).toMatchObject({ ok: false, code: "SAR_EVALUATE_REJECTED" });

    const source = readFileSync(new URL("./operations.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new Function/);
  });
});

describe("P0-4 server execution ownership", () => {
  it("refuses new actions from the old run after human takeover", async () => {
    const { authority, port, resolved, bound } = bootPair();
    const first = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "request_context", name: "page" },
      port,
    });
    expect(first.ok).toBe(true);
    const fencing = authority.humanTakeover(bound.scopeKey, "human-session");
    const second = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "read_page", fields: ["query"] },
      port,
      uiLeaseGeneration: fencing.generation,
      presentedEpoch: fencing.epoch,
      presentedGeneration: fencing.generation,
    });
    expect(second).toMatchObject({ ok: false, code: "HUMAN_TAKEOVER" });
    const observed = must(authority.observe("run-1"));
    expect(observed.completeCancel).toBe(false);
    expect(observed.inFlight[0]?.status).toBe("finished");
  });

  it("refuses new actions after the agent lease is revoked", async () => {
    const { authority, port, resolved, bound } = bootPair();
    authority.revokeLease(bound.scopeKey);
    const next = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "read_page", fields: ["query"] },
      port,
    });
    expect(next).toMatchObject({ ok: false, code: "STALE_GENERATION" });
  });
});

describe("P0-5 cancel and in-flight", () => {
  it("identifies operations that have not stopped and does not claim full cancel", async () => {
    const { authority, site, resolved } = bootPair();
    site.search("widget");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const port: TrustedPagePort = {
      ...createTestSitePort(site),
      readFields: async (fields) => {
        entered();
        await gate;
        return site.readFields(fields);
      },
    };
    const pending = authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "read_page", fields: ["query", "count"] },
      port,
    });
    await enteredPromise;
    const cancelled = must(authority.cancel("run-1"));
    expect(cancelled.completeCancel).toBe(false);
    expect(cancelled.newActionsAccepted).toBe(false);
    expect(cancelled.notStopped).toEqual([
      expect.objectContaining({ op: "read_page", status: "dispatched_not_stopped" }),
    ]);
    const mid = must(authority.observe("run-1"));
    expect(mid.inFlight[0]?.status).toBe("dispatched_not_stopped");
    expect(mid.completeCancel).toBe(false);

    const follow = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "request_context", name: "search" },
      port,
    });
    expect(follow).toMatchObject({ ok: false, code: "CANCEL_REQUESTED" });
    release();
    const finished = await pending;
    expect(finished.ok).toBe(true);
    if (finished.ok) {
      expect(finished.inFlightStatus).toBe("finished_after_cancel_request");
      expect(finished.completeCancel).toBe(false);
    }
  });
});

describe("P0-6 process restart fencing", () => {
  it("keeps the server epoch across boot and rejects UI counters", async () => {
    const store = memoryEpochStore();
    const first = new SarExecutionAuthority(store, { lookupFn: publicLookup() });
    live.push(first);
    const boot1 = first.boot();
    must(first.registerBinding({ bindingId: "bind-a", tenantId: "tenant-a", userId: "user-a" }));
    must(first.registerCapability(SAR_FIXTURE_CAPABILITY));
    const resolved = must(
      first.resolveSessionHandle({
        principal: { tenantId: "tenant-a", userId: "user-a" },
        bindingId: "bind-a",
        pageTargetId: "tab-1",
      }),
    );
    must(
      first.bindRun({
        handleToken: resolved.handle.token,
        runId: "run-old",
        capabilityId: SAR_FIXTURE_CAPABILITY.id,
      }),
    );
    first.dispose();

    const second = new SarExecutionAuthority(store, { lookupFn: publicLookup() });
    live.push(second);
    const boot2 = second.boot();
    expect(boot2.epoch).toBe(boot1.epoch);
    expect(boot2.previousEpoch).toBe(boot1.epoch);
    expect(boot2.generation).toBe(boot1.generation + 1);
    expect(store.peek()).toEqual({ epoch: boot1.epoch, generation: boot2.generation });

    const site = new ControllableTestSite();
    const denied = await second.dispatch({
      runId: "run-old",
      handleToken: resolved.handle.token,
      rawOp: { op: "read_page", fields: ["query"] },
      port: createTestSitePort(site),
      uiLeaseGeneration: boot2.generation,
      presentedEpoch: boot2.epoch,
      presentedGeneration: boot2.generation,
    });
    expect(denied).toMatchObject({ ok: false, code: "UI_FENCE_REJECTED" });
  });
});

describe("P0-7 account-browser serialization", () => {
  it("rejects undeclared parallel browser and SAR dispatch, including after takeover", async () => {
    const { authority, resolved, bound, port } = bootPair();
    const other = authority.bindRun({
      handleToken: resolved.handle.token,
      runId: "run-2",
      capabilityId: SAR_FIXTURE_CAPABILITY.id,
    });
    expect(other).toMatchObject({ ok: false, code: "SERIAL_CONFLICT" });

    const browserPort = {
      snapshot: vi.fn(async () => ({
        format: "aria" as const,
        url: SAR_FIXTURE_ORIGIN,
        nodes: [{ ref: "e1", role: "button", name: "Search" }],
      })),
      act: vi.fn(async () => ({ ok: true })),
    };
    const blocked = await runPlanOnceViaBrowser(
      { finishes_task: true, steps: [{ action: "click", target: "Search" }] },
      browserPort,
      {
        accountBrowserScopeKey: bound.scopeKey,
        runId: "browser-run",
        settleWaitOnly: true,
        settleOverrides: { quiet_ms: 0, settle_timeout_ms: 1 },
      },
    );
    expect(blocked.status).toBe("BLOCKED");
    expect(browserPort.act).not.toHaveBeenCalled();
    expect(browserPort.snapshot).not.toHaveBeenCalled();

    authority.humanTakeover(bound.scopeKey, "human-session");
    const sarAfter = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "request_context", name: "page" },
      port,
    });
    expect(sarAfter).toMatchObject({ ok: false, code: "HUMAN_TAKEOVER" });

    const deps = createPlanOnceDepsFromBrowser(browserPort, {
      accountBrowserScopeKey: bound.scopeKey,
      serialRunId: "browser-after-takeover",
    });
    await expect(deps.execute({ action: "click", id: "e1" })).rejects.toBeInstanceOf(
      AccountBrowserSerialDenied,
    );
    expect(browserPort.act).not.toHaveBeenCalled();
  });

  it("fails closed when an account-browser scope has no coordinator", async () => {
    const { authority, bound } = bootPair();
    authority.releaseRun("run-1");
    authority.dispose();
    const browserPort = {
      snapshot: vi.fn(async () => ({ format: "aria" as const, url: "https://example", nodes: [] })),
      act: vi.fn(async () => ({ ok: true })),
    };
    const blocked = await runPlanOnceViaBrowser(
      { finishes_task: false, steps: [{ action: "wait" }] },
      browserPort,
      { accountBrowserScopeKey: bound.scopeKey, runId: "browser-uncoordinated" },
    );
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.reason).toMatch(/coordinator/);
    expect(browserPort.act).not.toHaveBeenCalled();
  });

  it("lets the generic browser hold the desk and then release it", async () => {
    const { authority, bound, resolved } = bootPair();
    authority.releaseRun("run-1");
    expect(authority.claim(bound.scopeKey, "browser", "browser-hold").ok).toBe(true);
    const whileHeld = authority.bindRun({
      handleToken: resolved.handle.token,
      runId: "run-late",
      capabilityId: SAR_FIXTURE_CAPABILITY.id,
    });
    expect(whileHeld).toMatchObject({ ok: false, code: "SERIAL_CONFLICT" });
    authority.release(bound.scopeKey, "browser", "browser-hold");
    const nextHandle = must(
      authority.resolveSessionHandle({
        principal: { tenantId: "tenant-a", userId: "user-a" },
        bindingId: "bind-a",
        pageTargetId: "tab-2",
      }),
    );
    const rebound = authority.bindRun({
      handleToken: nextHandle.handle.token,
      runId: "run-late",
      capabilityId: SAR_FIXTURE_CAPABILITY.id,
    });
    expect(rebound.ok).toBe(true);
  });
});

describe("P0-8 controllable test site", () => {
  it("serves search, detail, and login ground truth and can reset injected faults", async () => {
    const site = new ControllableTestSite();
    expect(site.search("widget")).toEqual({
      ok: true,
      items: SAR_FIXTURE_GROUND_TRUTH.search.items,
    });
    expect(site.detail("item-1")).toEqual({
      ok: true,
      item: SAR_FIXTURE_GROUND_TRUTH.detail["item-1"],
    });
    expect(site.login("someone@personal.example", "real-looking-secret")).toEqual({
      ok: false,
      fault: "AUTH_REQUIRED",
    });
    expect(site.login(SAR_FIXTURE_CREDENTIALS.username, SAR_FIXTURE_CREDENTIALS.password)).toEqual({
      ok: true,
      displayName: SAR_FIXTURE_GROUND_TRUTH.login.displayName,
    });
    expect(SAR_FIXTURE_CREDENTIALS).toEqual({ username: "fixture-user", password: "fixture-pass" });

    site.injectError("detail", "STRUCTURE_CHANGED");
    expect(site.detail("item-1")).toEqual({ ok: false, fault: "STRUCTURE_CHANGED" });
    site.reset();
    expect(site.session()).toEqual({ authenticated: false, displayName: "" });
    expect(site.detail("item-1").ok).toBe(true);

    const { authority, resolved } = bootPair();
    const faulted = new ControllableTestSite();
    faulted.injectError("search", "UPSTREAM_TIMEOUT");
    const failed = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "navigate", url: `${SAR_FIXTURE_ORIGIN}/search?q=widget` },
      port: createTestSitePort(faulted),
    });
    expect(failed).toMatchObject({
      ok: false,
      code: "OPERATION_FAULT",
      message: "UPSTREAM_TIMEOUT",
    });

    const loggedIn = new ControllableTestSite();
    expect(
      loggedIn.login(SAR_FIXTURE_CREDENTIALS.username, SAR_FIXTURE_CREDENTIALS.password).ok,
    ).toBe(true);
    const sessionPort = createTestSitePort(loggedIn);
    const account = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "navigate", url: `${SAR_FIXTURE_ORIGIN}/account` },
      port: sessionPort,
    });
    expect(account.ok).toBe(true);
    const fields = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "read_page", fields: ["authenticated", "displayName"] },
      port: sessionPort,
    });
    expect(fields.ok).toBe(true);
    if (fields.ok && fields.value.kind === "read_page") {
      expect(fields.value.fields).toEqual({
        authenticated: "true",
        displayName: SAR_FIXTURE_GROUND_TRUTH.login.displayName,
      });
    }
  });
});

describe("P0-9 cross-account rejection", () => {
  it("refuses another tenant and another user on the same tenant", () => {
    const { authority } = bootPair();
    const otherTenant = authority.resolveSessionHandle({
      principal: { tenantId: "tenant-b", userId: "user-b" },
      bindingId: "bind-a",
      pageTargetId: "tab-1",
    });
    expect(otherTenant).toMatchObject({ ok: false, code: "CROSS_ACCOUNT_REJECTED" });

    const otherUser = authority.resolveSessionHandle({
      principal: { tenantId: "tenant-a", userId: "user-a" },
      bindingId: "bind-a2",
      pageTargetId: "tab-9",
    });
    expect(otherUser).toMatchObject({ ok: false, code: "CROSS_ACCOUNT_REJECTED" });

    const own = authority.resolveSessionHandle({
      principal: { tenantId: "tenant-b", userId: "user-b" },
      bindingId: "bind-b",
      pageTargetId: "tab-b",
    });
    expect(own.ok).toBe(true);
  });
});

describe("P0-10 navigation and network policy", () => {
  it("does not bypass the existing navigation guard or origin allowlist", async () => {
    const { authority, port, resolved } = bootPair();
    const javascriptUrl = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "navigate", url: "javascript:alert(1)" },
      port,
    });
    expect(javascriptUrl).toMatchObject({ ok: false, code: "POLICY_DENIED" });

    const fileUrl = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "navigate", url: "file:///etc/passwd" },
      port,
    });
    expect(fileUrl).toMatchObject({ ok: false, code: "POLICY_DENIED" });

    const loopback = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "navigate", url: "http://127.0.0.1:8080" },
      port,
    });
    expect(loopback).toMatchObject({ ok: false, code: "POLICY_DENIED" });

    const outsideOrigin = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: { op: "navigate", url: "https://evil.example/search" },
      port,
    });
    expect(outsideOrigin).toMatchObject({ ok: false, code: "POLICY_DENIED" });

    const bypass = await authority.dispatch({
      runId: "run-1",
      handleToken: resolved.handle.token,
      rawOp: {
        op: "navigate",
        url: "http://127.0.0.1:8080",
        skipNavigationGuard: true,
        ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
      },
      port,
    });
    expect(bypass).toMatchObject({ ok: false, code: "POLICY_DENIED" });
  });
});

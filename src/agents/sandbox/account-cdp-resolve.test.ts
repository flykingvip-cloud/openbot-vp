import { afterEach, describe, expect, it, vi } from "vitest";
import {
  peekAccountBrowserCdpPort,
  registerAccountBrowserCdpPort,
  resetAccountBrowserCdpPortsForTests,
} from "../../browser/account-browser-namespace.js";
import {
  ensureAccountBrowserCdpPort,
  peekAccountCdpUrlFromMemory,
  resetAccountCdpResolveForTests,
  resolveAccountBrowserCdpUrl,
  setAccountCdpRediscoverForTests,
} from "./account-cdp-resolve.js";
import { BROWSER_BRIDGES } from "./browser-bridges.js";
import {
  createAccountHandoffGateProbe,
  setHandoffGateProbeForTests,
} from "./secure-form-handoff-gate-probe.js";
import { isHandoffGateClearedFromDom } from "./secure-form-handoff-gate.js";
import {
  resetSecureFormHandoffWaitForTests,
  waitForHandoffReturn,
  peekHandoffResumeReason,
} from "./secure-form-handoff-wait.js";

const getPageMock = vi.hoisted(() => vi.fn());

vi.mock("../../browser/pw-session.js", () => ({
  getPageForTargetId: (...args: unknown[]) => getPageMock(...args),
}));

afterEach(() => {
  resetAccountCdpResolveForTests();
  resetAccountBrowserCdpPortsForTests();
  setAccountCdpRediscoverForTests(null);
  setHandoffGateProbeForTests(null);
  resetSecureFormHandoffWaitForTests();
  getPageMock.mockReset();
  BROWSER_BRIDGES.clear();
});

describe("account-cdp-resolve", () => {
  it("returns in-memory peek without rediscover", async () => {
    registerAccountBrowserCdpPort("account:t1:u1:browser", 19111);
    expect(peekAccountCdpUrlFromMemory({ tenantId: "t1", userId: "u1" })).toBe(
      "http://127.0.0.1:19111",
    );
    const rediscover = vi.fn(async () => 19999);
    setAccountCdpRediscoverForTests(rediscover);
    await expect(resolveAccountBrowserCdpUrl({ tenantId: "t1", userId: "u1" })).resolves.toBe(
      "http://127.0.0.1:19111",
    );
    expect(rediscover).not.toHaveBeenCalled();
  });

  it("rediscovers and registers when maps were empty after restart", async () => {
    expect(peekAccountBrowserCdpPort("account:t1:u1:browser")).toBeUndefined();
    const rediscover = vi.fn(async () => 19222);
    setAccountCdpRediscoverForTests(rediscover);
    await expect(ensureAccountBrowserCdpPort({ tenantId: "t1", userId: "u1" })).resolves.toBe(
      19222,
    );
    expect(peekAccountBrowserCdpPort("account:t1:u1:browser")).toBe(19222);
    expect(rediscover).toHaveBeenCalledTimes(1);
    // Second call uses memory — no second rediscover.
    await expect(resolveAccountBrowserCdpUrl({ tenantId: "t1", userId: "u1" })).resolves.toBe(
      "http://127.0.0.1:19222",
    );
    expect(rediscover).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent rediscover for the same scope", async () => {
    let resolvePort!: (n: number) => void;
    const gate = new Promise<number>((r) => {
      resolvePort = r;
    });
    const rediscover = vi.fn(async () => gate);
    setAccountCdpRediscoverForTests(rediscover);
    const a = ensureAccountBrowserCdpPort({ tenantId: "t1", userId: "u1" });
    const b = ensureAccountBrowserCdpPort({ tenantId: "t1", userId: "u1" });
    resolvePort(19333);
    await expect(Promise.all([a, b])).resolves.toEqual([19333, 19333]);
    expect(rediscover).toHaveBeenCalledTimes(1);
  });

  it("returns null when rediscover fails; next call may retry", async () => {
    const rediscover = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(19444);
    setAccountCdpRediscoverForTests(rediscover);
    await expect(ensureAccountBrowserCdpPort({ tenantId: "t1", userId: "u1" })).resolves.toBeNull();
    await expect(ensureAccountBrowserCdpPort({ tenantId: "t1", userId: "u1" })).resolves.toBe(
      19444,
    );
    expect(rediscover).toHaveBeenCalledTimes(2);
  });
});

describe("handoff gate probe after CDP reattach", () => {
  it("auto_gate_cleared once rediscover recovers an empty bridge map", async () => {
    // Simulate post-restart: empty maps, then rediscover yields port; page is signed-in.
    setAccountCdpRediscoverForTests(async () => 19555);
    getPageMock.mockResolvedValue({
      url: () => "https://www.zhihu.com/",
      evaluate: async () => ({
        signedInAttr: null,
        statusText: "",
        signedInHeuristic: true,
        leftAuthPath: true,
      }),
    });

    const probe = createAccountHandoffGateProbe({ tenantId: "t1", userId: "u1" });
    const snap = await probe();
    expect(snap).toEqual(
      expect.objectContaining({
        href: "https://www.zhihu.com/",
        signedInHeuristic: true,
        leftAuthPath: true,
      }),
    );
    expect(isHandoffGateClearedFromDom(snap!)).toBe(true);
    expect(peekAccountBrowserCdpPort("account:t1:u1:browser")).toBe(19555);
    expect(getPageMock).toHaveBeenCalledWith({ cdpUrl: "http://127.0.0.1:19555" });

    const waiting = waitForHandoffReturn({
      sessionKey: "agent:main:employee:u1",
      timeoutMs: 5_000,
      pollIntervalMs: 20,
      pollGateCleared: probe,
    });
    await expect(waiting).resolves.toBe("handoff_returned");
    expect(peekHandoffResumeReason("agent:main:employee:u1")).toBe("auto_gate_cleared");
  });

  it("keeps polling null while CDP is empty then resumes after rediscover", async () => {
    let port: number | null = null;
    setAccountCdpRediscoverForTests(async () => port);
    getPageMock.mockImplementation(async ({ cdpUrl }: { cdpUrl: string }) => {
      if (!cdpUrl.includes("19666")) {
        throw new Error("unexpected");
      }
      return {
        url: () => "https://fixture.example/home",
        evaluate: async () => ({
          signedInAttr: "true",
          statusText: "fixture-ok",
          signedInHeuristic: true,
          leftAuthPath: true,
        }),
      };
    });

    const probe = createAccountHandoffGateProbe({ tenantId: "t1", userId: "u1" });
    expect(await probe()).toBeNull();

    const waiting = waitForHandoffReturn({
      sessionKey: "agent:main:employee:recover",
      timeoutMs: 3_000,
      pollIntervalMs: 40,
      pollGateCleared: probe,
    });
    await new Promise((r) => setTimeout(r, 80));
    port = 19666;
    await expect(waiting).resolves.toBe("handoff_returned");
    expect(peekHandoffResumeReason("agent:main:employee:recover")).toBe("auto_gate_cleared");
  });
});

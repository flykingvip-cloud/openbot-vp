import { afterEach, describe, expect, it } from "vitest";
import {
  peekAccountBrowserCdpPort,
  resetAccountBrowserCdpPortsForTests,
} from "../../browser/account-browser-namespace.js";
import { stopBrowserBridgeServer } from "../../browser/bridge-server.js";
import {
  ACCOUNT_WORKER_CDP_PROBE_MS,
  attachAccountWorkerBrowserControl,
  resetAccountWorkerCdpPrewarmForTests,
  resolveAccountWorkerBrowserControl,
  setAccountWorkerBrowserControlAttacherForTests,
} from "./account-worker-browser-bridge.js";
import { ACCOUNT_WORKER_DOCKER_DRIVER_FLAG } from "./account-worker-driver.js";
import { BROWSER_BRIDGES } from "./browser-bridges.js";

describe("account worker browser control bridge", () => {
  afterEach(async () => {
    setAccountWorkerBrowserControlAttacherForTests(null);
    resetAccountWorkerCdpPrewarmForTests();
    for (const entry of BROWSER_BRIDGES.values()) {
      await stopBrowserBridgeServer(entry.bridge.server).catch(() => undefined);
    }
    BROWSER_BRIDGES.clear();
    resetAccountBrowserCdpPortsForTests();
  });

  it("attaches an attach-only bridge to the published CDP port and reuses it", async () => {
    const first = await attachAccountWorkerBrowserControl({
      tenantId: "tenant-a",
      userId: "user-a",
      containerName: "aw-browser-lease-1",
      config: {},
      env: {},
      readCdpPort: async () => 19222,
    });
    expect(first?.bridgeUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(first?.containerName).toBe("aw-browser-lease-1");
    const stored = BROWSER_BRIDGES.get("account:tenant-a:user-a:browser");
    expect(stored?.bridge.state.resolved.attachOnly).toBe(true);
    expect(stored?.bridge.state.resolved.accountComputerWorkArea).toBe(true);
    expect(stored?.bridge.state.resolved.profiles.openclaw?.cdpPort).toBe(19222);
    expect(peekAccountBrowserCdpPort("account:tenant-a:user-a:browser")).toBe(19222);

    const second = await attachAccountWorkerBrowserControl({
      tenantId: "tenant-a",
      userId: "user-a",
      containerName: "aw-browser-lease-1",
      config: {},
      env: {},
      readCdpPort: async () => 19222,
    });
    expect(second?.bridgeUrl).toBe(first?.bridgeUrl);
    expect(BROWSER_BRIDGES.size).toBe(1);
  });

  it("does not invent a bridge when the CDP port is unpublished", async () => {
    const missing = await attachAccountWorkerBrowserControl({
      tenantId: "tenant-a",
      userId: "user-a",
      containerName: "aw-browser-lease-1",
      config: {},
      env: {},
      readCdpPort: async () => null,
    });
    expect(missing).toBeNull();
    expect(BROWSER_BRIDGES.size).toBe(0);
  });

  it("stays unwired without the docker driver and honors a test attacher", async () => {
    const unwired = await resolveAccountWorkerBrowserControl({
      tenantId: "tenant-a",
      userId: "user-a",
      containerName: "aw-browser-lease-1",
      config: {},
      // Explicit off — unset defaults ON (P6b), which would attempt attach.
      env: { [ACCOUNT_WORKER_DOCKER_DRIVER_FLAG]: "0" },
    });
    expect(unwired).toEqual({ status: "skipped" });

    setAccountWorkerBrowserControlAttacherForTests(async () => null);
    const unpublished = await resolveAccountWorkerBrowserControl({
      tenantId: "tenant-a",
      userId: "user-a",
      containerName: "aw-browser-lease-1",
      env: {},
    });
    expect(unpublished).toEqual({ status: "unavailable", reason: "CDP port not published" });

    setAccountWorkerBrowserControlAttacherForTests(async () => ({
      bridgeUrl: "http://127.0.0.1:18792",
      containerName: "aw-browser-lease-1",
    }));
    const attached = await resolveAccountWorkerBrowserControl({
      tenantId: "tenant-a",
      userId: "user-a",
      containerName: "aw-browser-lease-1",
      env: {},
    });
    expect(attached).toEqual({
      status: "attached",
      browser: {
        bridgeUrl: "http://127.0.0.1:18792",
        containerName: "aw-browser-lease-1",
      },
    });
  });

  it("returns a startup sentence when CDP is not listening, inside the probe budget", async () => {
    const attached = await attachAccountWorkerBrowserControl({
      tenantId: "tenant-a",
      userId: "user-a",
      containerName: "aw-browser-lease-1",
      config: {},
      env: {},
      readCdpPort: async () => 19222,
    });
    const stored = BROWSER_BRIDGES.get("account:tenant-a:user-a:browser");
    expect(attached?.bridgeUrl).toBeTruthy();
    expect(stored?.authToken).toBeTruthy();
    const started = Date.now();
    const res = await fetch(`${attached?.bridgeUrl}/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${stored?.authToken ?? ""}` },
    });
    const elapsed = Date.now() - started;
    const body = (await res.json()) as { error?: string };
    expect(res.status).toBe(409);
    expect(body.error).toContain("云电脑还在启动，画面可以先看");
    expect(body.error).toContain("Do not call the browser tool again this turn");
    expect(body.error).not.toContain("Retry the browser tool");
    expect(elapsed).toBeLessThan(ACCOUNT_WORKER_CDP_PROBE_MS + 2_500);
  });
});

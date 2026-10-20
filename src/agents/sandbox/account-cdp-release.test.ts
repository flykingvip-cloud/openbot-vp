import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  allocateAccountBrowserCdpPort,
  peekAccountBrowserCdpPort,
  releaseAccountBrowserCdpForSandboxKey,
  resetAccountBrowserCdpPortsForTests,
  resolveAccountBrowserScopeKeyFromSandboxKey,
} from "../../browser/account-browser-namespace.js";
import { BROWSER_BRIDGES } from "./browser-bridges.js";

const registryMocks = vi.hoisted(() => ({
  readBrowserRegistry: vi.fn(),
  removeBrowserRegistryEntry: vi.fn(async () => {}),
}));

vi.mock("./docker.js", () => ({
  execDocker: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
  dockerContainerState: vi.fn(),
}));

vi.mock("./registry.js", () => ({
  readBrowserRegistry: registryMocks.readBrowserRegistry,
  readRegistry: vi.fn(async () => ({ entries: [] })),
  removeBrowserRegistryEntry: registryMocks.removeBrowserRegistryEntry,
  removeRegistryEntry: vi.fn(async () => {}),
}));

vi.mock("../../browser/bridge-server.js", () => ({
  stopBrowserBridgeServer: vi.fn(async () => {}),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

const { removeSandboxBrowserContainer } = await import("./manage.js");

describe("account browser CDP release on stop", () => {
  beforeEach(() => {
    resetAccountBrowserCdpPortsForTests();
    BROWSER_BRIDGES.clear();
    registryMocks.readBrowserRegistry.mockReset();
    registryMocks.removeBrowserRegistryEntry.mockClear();
  });

  it("maps an exec sandbox key onto the shared browser holder", () => {
    expect(resolveAccountBrowserScopeKeyFromSandboxKey("account:tenant-a:user-a:agent:bot")).toBe(
      "account:tenant-a:user-a:browser",
    );
    expect(resolveAccountBrowserScopeKeyFromSandboxKey("account:tenant-a:user-a:browser")).toBe(
      "account:tenant-a:user-a:browser",
    );
    expect(resolveAccountBrowserScopeKeyFromSandboxKey("agent:bot:main")).toBeUndefined();
  });

  it("releases the browser CDP port when the container is removed", async () => {
    const holder = "account:tenant-a:user-a:browser";
    const port = await allocateAccountBrowserCdpPort(holder);
    expect(peekAccountBrowserCdpPort(holder)).toBe(port);
    registryMocks.readBrowserRegistry.mockResolvedValue({
      entries: [
        {
          containerName: "sbx-browser-a",
          sessionKey: "account:tenant-a:user-a:agent:bot",
          createdAtMs: 1,
          lastUsedAtMs: 1,
          image: "browser",
          cdpPort: port,
        },
      ],
    });
    BROWSER_BRIDGES.set("account:tenant-a:user-a:agent:bot", {
      bridge: { server: {} } as never,
      containerName: "sbx-browser-a",
    });

    await removeSandboxBrowserContainer("sbx-browser-a");

    expect(peekAccountBrowserCdpPort(holder)).toBeUndefined();
    expect(BROWSER_BRIDGES.size).toBe(0);
  });

  it("releases from the in-memory bridge key when the registry has no row", async () => {
    const holder = "account:tenant-b:user-b:browser";
    await allocateAccountBrowserCdpPort(holder);
    registryMocks.readBrowserRegistry.mockResolvedValue({ entries: [] });
    BROWSER_BRIDGES.set("account:tenant-b:user-b:agent:main", {
      bridge: { server: {} } as never,
      containerName: "sbx-browser-b",
    });

    await removeSandboxBrowserContainer("sbx-browser-b");

    expect(peekAccountBrowserCdpPort(holder)).toBeUndefined();
  });

  it("releases an exec key without touching an unrelated holder", async () => {
    await allocateAccountBrowserCdpPort("account:tenant-a:user-a:browser");
    await allocateAccountBrowserCdpPort("account:other:user:browser");
    releaseAccountBrowserCdpForSandboxKey("account:tenant-a:user-a:agent:bot");
    expect(peekAccountBrowserCdpPort("account:tenant-a:user-a:browser")).toBeUndefined();
    expect(peekAccountBrowserCdpPort("account:other:user:browser")).toBeTypeOf("number");
  });
});

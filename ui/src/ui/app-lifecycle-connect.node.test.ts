import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { applySettingsFromUrlMock, connectGatewayMock, loadBootstrapMock, syncTabWithLocationMock } =
  vi.hoisted(() => ({
    applySettingsFromUrlMock: vi.fn(),
    connectGatewayMock: vi.fn(),
    loadBootstrapMock: vi.fn(),
    syncTabWithLocationMock: vi.fn(),
  }));

vi.mock("./app-gateway.ts", () => ({
  connectGateway: connectGatewayMock,
}));

vi.mock("./controllers/control-ui-bootstrap.ts", () => ({
  loadControlUiBootstrapConfig: loadBootstrapMock,
}));

vi.mock("./app-settings.ts", () => ({
  applySettingsFromUrl: applySettingsFromUrlMock,
  attachThemeListener: vi.fn(),
  detachThemeListener: vi.fn(),
  inferBasePath: vi.fn(() => "/"),
  syncTabWithLocation: syncTabWithLocationMock,
  syncThemeWithSettings: vi.fn(),
}));

vi.mock("./app-polling.ts", () => ({
  startLogsPolling: vi.fn(),
  startNodesPolling: vi.fn(),
  stopLogsPolling: vi.fn(),
  stopNodesPolling: vi.fn(),
  startDebugPolling: vi.fn(),
  stopDebugPolling: vi.fn(),
}));

vi.mock("./app-scroll.ts", () => ({
  observeTopbar: vi.fn(),
  scheduleChatScroll: vi.fn(),
  scheduleLogsScroll: vi.fn(),
}));

import { handleConnected, setAppLifecycleTestHooks } from "./app-lifecycle.ts";

function createHost() {
  return {
    basePath: "",
    settings: {
      customBrandLogoDataUrl: undefined,
    },
    client: null,
    connectGeneration: 0,
    connected: false,
    tab: "chat",
    assistantName: "OpenBot",
    assistantAvatar: null,
    assistantAgentId: null,
    serverVersion: null,
    bootstrapAuthMode: null,
    bootstrapAuthSession: null,
    platformAuthState: null,
    chatHasAutoScrolled: false,
    chatManualRefreshInFlight: false,
    chatLoading: false,
    chatMessages: [],
    chatToolMessages: [],
    chatStream: "",
    logsAutoFollow: false,
    logsAtBottom: true,
    logsEntries: [],
    popStateHandler: vi.fn(),
    hashChangeHandler: vi.fn(),
    topbarObserver: null,
  };
}

describe("handleConnected", () => {
  beforeEach(() => {
    applySettingsFromUrlMock.mockReset();
    connectGatewayMock.mockReset();
    loadBootstrapMock.mockReset();
    syncTabWithLocationMock.mockReset();
    setAppLifecycleTestHooks({
      connectGateway: connectGatewayMock,
      loadControlUiBootstrapConfig: loadBootstrapMock,
      applySettingsFromUrl: applySettingsFromUrlMock,
      inferBasePath: vi.fn(() => "/"),
      syncTabWithLocation: syncTabWithLocationMock,
      syncThemeWithSettings: vi.fn(),
      attachThemeListener: vi.fn(),
      detachThemeListener: vi.fn(),
      startLogsPolling: vi.fn(),
      startNodesPolling: vi.fn(),
      stopLogsPolling: vi.fn(),
      stopNodesPolling: vi.fn(),
      startDebugPolling: vi.fn(),
      stopDebugPolling: vi.fn(),
      observeTopbar: vi.fn(),
      scheduleChatScroll: vi.fn(),
      scheduleLogsScroll: vi.fn(),
      syncBrandHeadAssets: vi.fn(),
    });
  });

  afterEach(() => {
    setAppLifecycleTestHooks(null);
  });

  it("waits for bootstrap load before first gateway connect", async () => {
    let resolveBootstrap!: () => void;
    loadBootstrapMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveBootstrap = resolve;
      }),
    );
    connectGatewayMock.mockReset();
    const host = createHost();

    handleConnected(host as never);
    expect(connectGatewayMock).not.toHaveBeenCalled();

    resolveBootstrap();
    await Promise.resolve();
    expect(connectGatewayMock).toHaveBeenCalledTimes(1);
    expect(syncTabWithLocationMock).toHaveBeenCalledTimes(2);
  });

  it("skips deferred connect when disconnected before bootstrap resolves", async () => {
    let resolveBootstrap!: () => void;
    loadBootstrapMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveBootstrap = resolve;
      }),
    );
    connectGatewayMock.mockReset();
    const host = createHost();

    handleConnected(host as never);
    expect(connectGatewayMock).not.toHaveBeenCalled();

    host.connectGeneration += 1;
    resolveBootstrap();
    await Promise.resolve();

    expect(connectGatewayMock).not.toHaveBeenCalled();
  });

  it("scrubs URL settings before starting the bootstrap fetch", () => {
    loadBootstrapMock.mockResolvedValueOnce(undefined);
    const host = createHost();

    handleConnected(host as never);

    expect(applySettingsFromUrlMock).toHaveBeenCalledTimes(1);
    expect(loadBootstrapMock).toHaveBeenCalledTimes(1);
    expect(applySettingsFromUrlMock.mock.invocationCallOrder[0]).toBeLessThan(
      loadBootstrapMock.mock.invocationCallOrder[0],
    );
  });
});

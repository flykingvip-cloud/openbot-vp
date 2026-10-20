import type { OpenClawPluginApi } from "openclaw/plugin-sdk/media-monitor";
import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

function fakeApi(overrides: Partial<OpenClawPluginApi> = {}): OpenClawPluginApi {
  return {
    id: "media-monitor",
    name: "Media Monitor",
    source: "test",
    config: {},
    pluginConfig: {
      adapterCommand: ["node", "fixtures/fake-adapter.mjs"],
      enabled: true,
    },
    runtime: {} as OpenClawPluginApi["runtime"],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerTool: vi.fn(),
    registerService: vi.fn(),
    registerChannel: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerCli: vi.fn(),
    registerHook: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerCommand: vi.fn(),
    registerProvider: vi.fn(),
    registerContextEngine: vi.fn(),
    on: vi.fn(),
    resolvePath: (p: string) => p,
    ...overrides,
  } as unknown as OpenClawPluginApi;
}

describe("media-monitor plugin register", () => {
  it("registers service, tool, and gateway methods", () => {
    const api = fakeApi();
    plugin.register(api);
    expect(api.registerService).toHaveBeenCalledTimes(1);
    expect(api.registerTool).toHaveBeenCalledTimes(1);
    const methods = (api.registerGatewayMethod as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0],
    );
    expect(methods).toContain("mediaMonitor.addTarget");
    expect(methods).toContain("mediaMonitor.runTarget");
    expect(methods).toContain("mediaMonitor.tickDue");
    expect(methods).toContain("mediaMonitor.flushOutbox");
    expect(methods).toContain("mediaMonitor.status");
  });
});

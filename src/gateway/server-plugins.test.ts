import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PluginRegistry } from "../plugins/registry.js";
import type { PluginRuntime } from "../plugins/runtime/types.js";
import type { PluginDiagnostic } from "../plugins/types.js";
import type { GatewayRequestContext, GatewayRequestOptions } from "./server-methods/types.js";

const loadOpenBotPlugins = vi.hoisted(() => vi.fn());
type HandleGatewayRequestOptions = GatewayRequestOptions & {
  extraHandlers?: Record<string, unknown>;
};
const handleGatewayRequest = vi.hoisted(() =>
  vi.fn(async (_opts: HandleGatewayRequestOptions) => {}),
);

vi.mock("../plugins/loader.js", () => ({
  loadOpenBotPlugins,
}));

vi.mock("./server-methods.js", () => ({
  handleGatewayRequest,
}));

const createRegistry = (diagnostics: PluginDiagnostic[]): PluginRegistry => ({
  plugins: [],
  tools: [],
  hooks: [],
  typedHooks: [],
  channels: [],
  commands: [],
  providers: [],
  gatewayHandlers: {},
  httpRoutes: [],
  cliRegistrars: [],
  services: [],
  diagnostics,
});

type ServerPluginsModule = typeof import("./server-plugins.js");

function createTestContext(label: string): GatewayRequestContext {
  return { label } as unknown as GatewayRequestContext;
}

function getLastDispatchedContext(): GatewayRequestContext | undefined {
  const call = handleGatewayRequest.mock.calls.at(-1)?.[0];
  return call?.context;
}

async function importServerPluginsModule(): Promise<ServerPluginsModule> {
  return import("./server-plugins.js");
}

type LoadParams = Parameters<ServerPluginsModule["loadGatewayPlugins"]>[0];

function createSubagentRuntime(
  serverPlugins: ServerPluginsModule,
  overrides: Partial<LoadParams> = {},
): PluginRuntime["subagent"] {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  loadOpenBotPlugins.mockReturnValue(createRegistry([]));
  serverPlugins.loadGatewayPlugins({
    cfg: {},
    workspaceDir: "/tmp",
    log,
    coreGatewayHandlers: {},
    baseMethods: [],
    ...overrides,
  });
  const call = loadOpenBotPlugins.mock.calls.at(-1)?.[0] as
    | { runtimeOptions?: { subagent?: PluginRuntime["subagent"] } }
    | undefined;
  if (!call?.runtimeOptions?.subagent) {
    throw new Error("Expected loadGatewayPlugins to provide subagent runtime");
  }
  return call.runtimeOptions.subagent;
}

beforeEach(() => {
  loadOpenBotPlugins.mockReset();
  handleGatewayRequest.mockReset();
  handleGatewayRequest.mockImplementation(async (opts: HandleGatewayRequestOptions) => {
    switch (opts.req.method) {
      case "agent":
        opts.respond(true, { runId: "run-1" });
        return;
      case "agent.wait":
        opts.respond(true, { status: "ok" });
        return;
      case "sessions.get":
        opts.respond(true, { messages: [] });
        return;
      case "sessions.delete":
        opts.respond(true, {});
        return;
      default:
        opts.respond(true, {});
    }
  });
});

afterEach(() => {
  vi.resetModules();
});

describe("loadGatewayPlugins", () => {
  test("logs plugin errors with details", async () => {
    const { loadGatewayPlugins } = await importServerPluginsModule();
    const diagnostics: PluginDiagnostic[] = [
      {
        level: "error",
        pluginId: "telegram",
        source: "/tmp/telegram/index.ts",
        message: "failed to load plugin: boom",
      },
    ];
    loadOpenBotPlugins.mockReturnValue(createRegistry(diagnostics));

    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    loadGatewayPlugins({
      cfg: {},
      workspaceDir: "/tmp",
      log,
      coreGatewayHandlers: {},
      baseMethods: [],
    });

    expect(log.error).toHaveBeenCalledWith(
      "[plugins] failed to load plugin: boom (plugin=telegram, source=/tmp/telegram/index.ts)",
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  test("provides subagent runtime with sessions.get method aliases", async () => {
    const { loadGatewayPlugins } = await importServerPluginsModule();
    loadOpenBotPlugins.mockReturnValue(createRegistry([]));

    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    loadGatewayPlugins({
      cfg: {},
      workspaceDir: "/tmp",
      log,
      coreGatewayHandlers: {},
      baseMethods: [],
    });

    const call = loadOpenBotPlugins.mock.calls.at(-1)?.[0];
    const subagent = call?.runtimeOptions?.subagent;
    expect(typeof subagent?.getSessionMessages).toBe("function");
    expect(typeof subagent?.getSession).toBe("function");
  });

  test("loadGatewayPlugins returns the explicit holder it was given", async () => {
    const serverPlugins = await importServerPluginsModule();
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    loadOpenBotPlugins.mockReturnValue(createRegistry([]));

    const holder = serverPlugins.createFallbackGatewayContextHolder();
    const result = serverPlugins.loadGatewayPlugins({
      cfg: {},
      workspaceDir: "/tmp",
      log,
      coreGatewayHandlers: {},
      baseMethods: [],
      fallbackContextHolder: holder,
    });
    expect(result.fallbackContextHolder).toBe(holder);
  });

  test("subagent runtime captures the explicit holder by reference", async () => {
    const serverPlugins = await importServerPluginsModule();
    const holder = serverPlugins.createFallbackGatewayContextHolder();
    const runtime = createSubagentRuntime(serverPlugins, {
      fallbackContextHolder: holder,
    });

    const firstContext = createTestContext("first");
    const secondContext = createTestContext("second");

    holder.set(firstContext);
    await runtime.run({ sessionKey: "s-1", message: "hello" });
    expect(getLastDispatchedContext()).toBe(firstContext);

    holder.set(secondContext);
    await runtime.run({ sessionKey: "s-1", message: "again" });
    expect(getLastDispatchedContext()).toBe(secondContext);

    holder.clear();
    await expect(runtime.run({ sessionKey: "s-1", message: "no ctx" })).rejects.toThrow(
      /requires a gateway request scope/i,
    );
  });

  test("explicit holders are isolated across gateway lifecycles", async () => {
    const serverPlugins = await importServerPluginsModule();
    const holderA = serverPlugins.createFallbackGatewayContextHolder();
    const holderB = serverPlugins.createFallbackGatewayContextHolder();
    const runtimeA = createSubagentRuntime(serverPlugins, { fallbackContextHolder: holderA });
    const runtimeB = createSubagentRuntime(serverPlugins, { fallbackContextHolder: holderB });

    const ctxA = createTestContext("A");
    const ctxB = createTestContext("B");
    holderA.set(ctxA);
    holderB.set(ctxB);

    await runtimeA.run({ sessionKey: "s-A", message: "from A" });
    expect(getLastDispatchedContext()).toBe(ctxA);

    await runtimeB.run({ sessionKey: "s-B", message: "from B" });
    expect(getLastDispatchedContext()).toBe(ctxB);
  });

  test("legacy module-level setFallbackGatewayContext still works for callers without an explicit holder", async () => {
    const serverPlugins = await importServerPluginsModule();
    const runtime = createSubagentRuntime(serverPlugins);
    const firstContext = createTestContext("legacy-1");
    const secondContext = createTestContext("legacy-2");

    serverPlugins.setFallbackGatewayContext(firstContext);
    await runtime.run({ sessionKey: "s-2", message: "legacy 1" });
    expect(getLastDispatchedContext()).toBe(firstContext);

    serverPlugins.setFallbackGatewayContext(secondContext);
    await runtime.run({ sessionKey: "s-2", message: "legacy 2" });
    expect(getLastDispatchedContext()).toBe(secondContext);
  });

  test("reflects fallback context object mutation at dispatch time", async () => {
    const serverPlugins = await importServerPluginsModule();
    const holder = serverPlugins.createFallbackGatewayContextHolder();
    const runtime = createSubagentRuntime(serverPlugins, {
      fallbackContextHolder: holder,
    });
    const context = { marker: "before-mutation" } as GatewayRequestContext & {
      marker: string;
    };

    holder.set(context);
    context.marker = "after-mutation";

    await runtime.run({ sessionKey: "s-3", message: "mutated context" });
    const dispatched = getLastDispatchedContext() as
      | (GatewayRequestContext & { marker: string })
      | undefined;
    expect(dispatched?.marker).toBe("after-mutation");
  });
});

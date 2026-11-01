import { describe, expectTypeOf, it } from "vitest";
import { createPluginRuntime } from "./index.js";
import type { PluginRuntime } from "./types.js";

describe("plugin runtime type contract", () => {
  it("createPluginRuntime returns the declared PluginRuntime shape", () => {
    const runtime = createPluginRuntime();
    expectTypeOf(runtime).toMatchTypeOf<PluginRuntime>();
    expectTypeOf<PluginRuntime>().toMatchTypeOf(runtime);
  });

  it("PluginMemoryToolFactory continuity fields (DEF-001) are accepted by runtime tools", () => {
    const runtime = createPluginRuntime();
    // Producer (memory-core) passes authenticatedUserId + securityProfile; the
    // plugin SDK factory type must accept them so excess-property checks match
    // createMemorySearchTool / createMemoryGetTool runtime options.
    const search = runtime.tools.createMemorySearchTool({
      authenticatedUserId: "user-alice",
      securityProfile: "managed_enterprise",
      gatewayClientUser: "user-alice",
      gatewayClientSessionDomain: "enterprise",
    });
    const get = runtime.tools.createMemoryGetTool({
      authenticatedUserId: "user-alice",
      securityProfile: "personal_local",
    });
    // Factories may return null without memory config; type acceptance is the gate.
    expectTypeOf(search).toEqualTypeOf<
      ReturnType<PluginRuntime["tools"]["createMemorySearchTool"]>
    >();
    expectTypeOf(get).toEqualTypeOf<ReturnType<PluginRuntime["tools"]["createMemoryGetTool"]>>();
  });
});

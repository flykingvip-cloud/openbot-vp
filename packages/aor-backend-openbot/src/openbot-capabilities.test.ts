import type { ToolInvoker } from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import { createOpenBotCapabilityRegistry } from "./openbot-capabilities.js";

const invoker: ToolInvoker = {
  invoke: async () => ({ ok: true, result: {} }),
};

describe("createOpenBotCapabilityRegistry", () => {
  it("registers lobster.pipeline and plugin.tool skills", () => {
    const registry = createOpenBotCapabilityRegistry(invoker);
    expect(registry.get("lobster.pipeline")).toBeDefined();
    expect(registry.get("plugin.tool")).toBeDefined();
    expect(registry.resolveForTaskType("lobster.pipeline")?.id).toBe("lobster.pipeline");
  });
});

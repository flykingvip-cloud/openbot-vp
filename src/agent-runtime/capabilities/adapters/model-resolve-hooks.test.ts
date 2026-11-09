import { describe, expect, it, vi } from "vitest";
import { resolveModelHookResult } from "./model-resolve-hooks.js";

describe("model resolution hook adapter", () => {
  it("preserves ordering, per-field precedence and the cached legacy prompt result", async () => {
    const order: string[] = [];
    const legacy = {
      providerOverride: "legacy-provider",
      modelOverride: "legacy-model",
      prependContext: "legacy context",
    };
    const ctx = { sessionId: "session-test" };
    const runBeforeModelResolve = vi.fn(async () => {
      order.push("model");
      return { providerOverride: "preferred-provider" };
    });
    const runBeforeAgentStart = vi.fn(async () => {
      order.push("legacy");
      return legacy;
    });
    const result = await resolveModelHookResult({
      prompt: "task",
      hookCtx: ctx,
      warn: vi.fn(),
      hookRunner: { hasHooks: () => true, runBeforeModelResolve, runBeforeAgentStart },
    });
    expect(order).toEqual(["model", "legacy"]);
    expect(result.modelResolveOverride).toEqual({
      providerOverride: "preferred-provider",
      modelOverride: "legacy-model",
    });
    expect(result.legacyBeforeAgentStartResult).toBe(legacy);
    expect(runBeforeModelResolve).toHaveBeenCalledExactlyOnceWith({ prompt: "task" }, ctx);
    expect(runBeforeAgentStart).toHaveBeenCalledExactlyOnceWith({ prompt: "task" }, ctx);
  });

  it("continues through failed hooks and preserves successful model overrides", async () => {
    const warn = vi.fn();
    const result = await resolveModelHookResult({
      prompt: "task",
      hookCtx: {},
      warn,
      hookRunner: {
        hasHooks: () => true,
        runBeforeModelResolve: async () => ({ modelOverride: "preferred" }),
        runBeforeAgentStart: async () => {
          throw new Error("legacy unavailable");
        },
      },
    });
    expect(result.modelResolveOverride).toEqual({ modelOverride: "preferred" });
    expect(result.legacyBeforeAgentStartResult).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("still evaluates legacy overrides after model-hook failure", async () => {
    const warn = vi.fn();
    const result = await resolveModelHookResult({
      prompt: "task",
      hookCtx: {},
      warn,
      hookRunner: {
        hasHooks: () => true,
        runBeforeModelResolve: async () => {
          throw new Error("model unavailable");
        },
        runBeforeAgentStart: async () => ({ modelOverride: "legacy" }),
      },
    });
    expect(result.modelResolveOverride?.modelOverride).toBe("legacy");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not invoke absent hooks", async () => {
    const runBeforeModelResolve = vi.fn();
    const runBeforeAgentStart = vi.fn();
    const result = await resolveModelHookResult({
      prompt: "task",
      hookCtx: {},
      warn: vi.fn(),
      hookRunner: { hasHooks: () => false, runBeforeModelResolve, runBeforeAgentStart },
    });
    expect(result.modelResolveOverride).toBeUndefined();
    expect(runBeforeModelResolve).not.toHaveBeenCalled();
    expect(runBeforeAgentStart).not.toHaveBeenCalled();
  });
});

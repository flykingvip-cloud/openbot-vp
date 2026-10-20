import { describe, expect, it } from "vitest";
import type { ExecutionBackend } from "./backend.js";
import { LobsterPipelineSkill, PluginToolSkill } from "./openbot-skills.js";
import type { ToolInvoker, ToolInvokeResult } from "./tool-invoker.js";
import type { ModelRef } from "./types.js";

class FakeInvoker implements ToolInvoker {
  last?: { tool: string; args?: Record<string, unknown> };
  constructor(private readonly result: ToolInvokeResult) {}
  invoke(req: { tool: string; args?: Record<string, unknown> }): Promise<ToolInvokeResult> {
    this.last = req;
    return Promise.resolve(this.result);
  }
}

const stubBackend = { id: "stub" } as ExecutionBackend;
const model: ModelRef = { provider: "openai", id: "gpt-5.4-mini" };

describe("LobsterPipelineSkill", () => {
  it("invokes the lobster plugin tool via ToolInvoker", async () => {
    const invoker = new FakeInvoker({
      ok: true,
      result: { ok: true, status: "ok", output: ["step done"] },
    });
    const skill = new LobsterPipelineSkill();
    const result = await skill.run({
      task: {
        goal: "run triage",
        type: "lobster.pipeline",
        params: { pipeline: "triage.lobster" },
      },
      model,
      backend: stubBackend,
      toolInvoker: invoker,
    });
    expect(invoker.last?.tool).toBe("lobster");
    expect(invoker.last?.args?.pipeline).toBe("triage.lobster");
    expect(result.output.text).toContain("step done");
  });
});

describe("PluginToolSkill", () => {
  it("invokes a named plugin tool", async () => {
    const invoker = new FakeInvoker({ ok: true, result: "pong" });
    const skill = new PluginToolSkill();
    const result = await skill.run({
      task: {
        goal: "list sessions",
        type: "plugin.tool",
        params: { toolName: "sessions_list", toolArgs: {}, toolAction: "json" },
      },
      model,
      backend: stubBackend,
      toolInvoker: invoker,
    });
    expect(invoker.last?.tool).toBe("sessions_list");
    expect(result.output.text).toBe("pong");
  });
});

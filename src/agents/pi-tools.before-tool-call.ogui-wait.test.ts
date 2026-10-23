import { afterEach, describe, expect, it } from "vitest";
import {
  clearOguiWaitRegistryForTests,
  replaceOguiSessionWaits,
} from "../config/sessions/ogui-decision-wait-registry.js";
import {
  runBeforeToolCallHook,
  wrapToolWithBeforeToolCallHook,
} from "./pi-tools.before-tool-call.js";
import { filterToolsByPolicy } from "./pi-tools.policy.js";
import type { AnyAgentTool } from "./pi-tools.types.js";

afterEach(() => {
  clearOguiWaitRegistryForTests();
});

describe("before-tool-call OGUI WAIT recheck (Ev6)", () => {
  it("blocks a tool that has not started after WAIT is registered", async () => {
    replaceOguiSessionWaits("agent:main:decision", ["ogd_waiting"]);
    const outcome = await runBeforeToolCallHook({
      toolName: "bash",
      params: { command: "echo independent" },
      ctx: { sessionKey: "agent:main:decision" },
    });
    expect(outcome.blocked).toBe(true);
    if (outcome.blocked) {
      expect(outcome.reason).toContain("WAIT is active");
    }
  });

  it("blocks execution when WAIT is registered after the name filter assembled the tool (Ev6)", async () => {
    let started = false;
    const bash = {
      name: "bash",
      description: "bash",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        started = true;
        return { content: [], details: undefined };
      },
    } as AnyAgentTool;
    const assembled = filterToolsByPolicy([bash], { allow: ["bash", "read"] });
    expect(assembled.map((tool) => tool.name)).toContain("bash");
    const wrapped = wrapToolWithBeforeToolCallHook(assembled[0], {
      sessionKey: "agent:main:decision",
    });
    replaceOguiSessionWaits("agent:main:decision", ["ogd_after_assembly"]);
    await expect(
      wrapped.execute("call-1", { command: "echo independent" }, undefined, undefined, undefined),
    ).rejects.toThrow(/WAIT is active/);
    expect(started).toBe(false);
  });
});

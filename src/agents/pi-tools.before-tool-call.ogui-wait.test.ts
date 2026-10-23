import { afterEach, describe, expect, it } from "vitest";
import {
  clearOguiWaitRegistryForTests,
  replaceOguiSessionWaits,
} from "../config/sessions/ogui-decision-wait-registry.js";
import { runBeforeToolCallHook } from "./pi-tools.before-tool-call.js";

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
});

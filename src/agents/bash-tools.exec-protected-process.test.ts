import { describe, expect, it } from "vitest";
import {
  assertProtectedGatewayProcessCommandAllowed,
  resolveConfiguredExecHost,
} from "./bash-tools.exec-protected-process.js";
import { createExecTool } from "./bash-tools.exec.js";

describe("exec host default", () => {
  it("routes unsandboxed execution through gateway approvals", () => {
    expect(resolveConfiguredExecHost({ sandboxAvailable: false })).toBe("gateway");
  });

  it("uses the sandbox when one is available", () => {
    expect(resolveConfiguredExecHost({ sandboxAvailable: true })).toBe("sandbox");
  });

  it("preserves an explicit host", () => {
    expect(resolveConfiguredExecHost({ configuredHost: "node", sandboxAvailable: false })).toBe(
      "node",
    );
  });

  it("enforces gateway policy instead of directly executing without a sandbox", async () => {
    const tool = createExecTool({ security: "deny", ask: "off", allowBackground: false });

    await expect(
      tool.execute("default-host-regression", { command: "echo must-not-run" }),
    ).rejects.toThrow(/exec denied/i);
  });
});

describe("protected gateway process exec guard", () => {
  it.each([
    "kill -TERM 1",
    "  kill -s TERM 1",
    "echo before; kill -HUP 1",
    "/usr/bin/kill --signal TERM 1",
    "sh -c 'kill -TERM 1'",
    "env kill -TERM 1",
    "kill -TERM 2 1",
    "kill -9 -1",
    "pkill openbot-gateway",
    "sh -c 'pkill openbot-gateway'",
    "killall openclaw-gateway",
  ])("denies production gateway termination: %s", (command) => {
    expect(() =>
      assertProtectedGatewayProcessCommandAllowed({ command, host: "gateway", runtimePid: 1 }),
    ).toThrow("agents cannot signal the production gateway process");
  });

  it("allows ordinary gateway commands", () => {
    expect(() =>
      assertProtectedGatewayProcessCommandAllowed({
        command: "openbot status --all",
        host: "gateway",
        runtimePid: 1,
      }),
    ).not.toThrow();
  });

  it("does not apply the gateway PID guard inside a sandbox", () => {
    expect(() =>
      assertProtectedGatewayProcessCommandAllowed({
        command: "kill -TERM 1",
        host: "sandbox",
        runtimePid: 1,
      }),
    ).not.toThrow();
  });
});

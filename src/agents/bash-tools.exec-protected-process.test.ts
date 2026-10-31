import { describe, expect, it } from "vitest";
import {
  assertProtectedGatewayProcessCommandAllowed,
  preferBoundSandboxExecHost,
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

describe("preferBoundSandboxExecHost", () => {
  it("keeps agent host=gateway on sandbox when a session sandbox is bound", () => {
    expect(
      preferBoundSandboxExecHost({
        host: "gateway",
        sandboxAvailable: true,
        requestedHost: null,
        elevatedRequested: false,
      }),
    ).toBe("sandbox");
  });

  it("does not remap when no sandbox is bound", () => {
    expect(
      preferBoundSandboxExecHost({
        host: "gateway",
        sandboxAvailable: false,
        requestedHost: null,
        elevatedRequested: false,
      }),
    ).toBe("gateway");
  });

  it("keeps elevated break-glass on gateway", () => {
    expect(
      preferBoundSandboxExecHost({
        host: "gateway",
        sandboxAvailable: true,
        requestedHost: null,
        elevatedRequested: true,
      }),
    ).toBe("gateway");
  });

  it("remaps an explicit model-requested gateway host onto bound sandbox", () => {
    expect(
      preferBoundSandboxExecHost({
        host: "gateway",
        sandboxAvailable: true,
        requestedHost: "gateway",
        elevatedRequested: false,
      }),
    ).toBe("sandbox");
  });

  it("remaps sticky host=node onto bound sandbox", () => {
    expect(
      preferBoundSandboxExecHost({
        host: "node",
        sandboxAvailable: true,
        requestedHost: null,
        elevatedRequested: false,
      }),
    ).toBe("sandbox");
  });

  it("remaps explicit model-requested host=node onto bound sandbox", () => {
    expect(
      preferBoundSandboxExecHost({
        host: "node",
        sandboxAvailable: true,
        requestedHost: "node",
        elevatedRequested: false,
      }),
    ).toBe("sandbox");
  });

  it("keeps intentional Desktop local-computer host=node allow", () => {
    expect(
      preferBoundSandboxExecHost({
        host: "node",
        sandboxAvailable: true,
        requestedHost: "node",
        elevatedRequested: false,
        localComputerAllow: true,
      }),
    ).toBe("node");
  });

  it("leaves sandbox host unchanged", () => {
    expect(
      preferBoundSandboxExecHost({
        host: "sandbox",
        sandboxAvailable: true,
        requestedHost: null,
        elevatedRequested: false,
      }),
    ).toBe("sandbox");
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

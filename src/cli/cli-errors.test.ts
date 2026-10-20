import { CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  CLI_EXIT_GATEWAY_REJECT,
  CLI_EXIT_USAGE,
  classifyCliError,
  exitCodeForCliErrorKind,
  formatCliErrorMessage,
  isCommanderUsageError,
  isGatewayRejectError,
  reportCliError,
} from "./cli-errors.js";

describe("cli-errors (usage vs gateway reject)", () => {
  it("classifies CommanderError as usage with exit 2", () => {
    const err = new CommanderError(1, "commander.unknownOption", "unknown option '--nope'");
    expect(isCommanderUsageError(err)).toBe(true);
    expect(classifyCliError(err)).toBe("usage");
    expect(exitCodeForCliErrorKind("usage")).toBe(CLI_EXIT_USAGE);
    expect(CLI_EXIT_USAGE).toBe(2);
    expect(formatCliErrorMessage("usage", err.message)).toBe("usage: unknown option '--nope'");
  });

  it("classifies GatewayClientRequestError-shaped errors as gateway reject with exit 1", () => {
    const err = Object.assign(new Error("unauthorized"), {
      name: "GatewayClientRequestError",
      gatewayCode: "INVALID_REQUEST",
    });
    expect(isGatewayRejectError(err)).toBe(true);
    expect(classifyCliError(err)).toBe("gateway_reject");
    expect(exitCodeForCliErrorKind("gateway_reject")).toBe(CLI_EXIT_GATEWAY_REJECT);
    expect(CLI_EXIT_GATEWAY_REJECT).toBe(1);
    expect(formatCliErrorMessage("gateway_reject", err.message)).toBe(
      "gateway reject: unauthorized",
    );
  });

  it("classifies callGateway connection messages as gateway reject", () => {
    expect(classifyCliError(new Error("gateway closed (1006): no close reason"))).toBe(
      "gateway_reject",
    );
    expect(classifyCliError(new Error("gateway timeout after 5000ms"))).toBe("gateway_reject");
    expect(classifyCliError(new Error("gateway token mismatch"))).toBe("gateway_reject");
  });

  it("classifies local --flag must be validation as usage", () => {
    expect(
      classifyCliError(new Error("--timeout must be a positive integer (milliseconds)")),
    ).toBe("usage");
  });

  it("reportCliError writes distinguishable stderr and exit codes", () => {
    const runtime = { error: vi.fn(), exit: vi.fn() };
    reportCliError(runtime, "usage", "unknown option '--x'");
    reportCliError(runtime, "gateway_reject", "gateway closed (1006)");
    expect(runtime.error.mock.calls.map((c) => c[0])).toEqual([
      "usage: unknown option '--x'",
      "gateway reject: gateway closed (1006)",
    ]);
    expect(runtime.exit.mock.calls.map((c) => c[0])).toEqual([2, 1]);
    // stderr prefixes differ; exit codes differ
    expect(runtime.error.mock.calls[0][0].startsWith("usage:")).toBe(true);
    expect(runtime.error.mock.calls[1][0].startsWith("gateway reject:")).toBe(true);
    expect(runtime.exit.mock.calls[0][0]).not.toBe(runtime.exit.mock.calls[1][0]);
  });
});

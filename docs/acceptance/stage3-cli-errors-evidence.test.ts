/**
 * Stage 3 six-column **CLI errors** slice (narrow E1/E2).
 *
 * Proposition (§5.2 CLI errors): non-zero exit and stderr can distinguish
 * usage errors from gateway rejects.
 * Product contract: `usage:` + exit 2 vs `gateway reject:` + exit 1.
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 *
 * Anchors: `src/cli/cli-errors.ts`, `src/cli/program/help.ts` (Commander
 * outputError + exitOverride), `src/cli/gateway-cli/register.ts`
 * (`runGatewayCommand`), `src/cli/program/register.status-health-sessions.ts`
 * (invalid `--timeout`). Not a full argv spawn / live Gateway suite.
 */
import { readFileSync } from "node:fs";
import { CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  CLI_EXIT_GATEWAY_REJECT,
  CLI_EXIT_USAGE,
  classifyCliError,
  formatCliErrorMessage,
  reportCliError,
} from "../../src/cli/cli-errors.js";

describe("Stage 3 CLI errors (E1/E2 narrow)", () => {
  it("product contract: usage exit 2 + usage: prefix; gateway reject exit 1 + gateway reject: prefix", () => {
    expect(CLI_EXIT_USAGE).toBe(2);
    expect(CLI_EXIT_GATEWAY_REJECT).toBe(1);
    expect(CLI_EXIT_USAGE).not.toBe(CLI_EXIT_GATEWAY_REJECT);

    const usageMsg = formatCliErrorMessage("usage", "unknown option '--nope'");
    const gatewayMsg = formatCliErrorMessage(
      "gateway_reject",
      "gateway closed (1006): no close reason",
    );
    expect(usageMsg.startsWith("usage:")).toBe(true);
    expect(gatewayMsg.startsWith("gateway reject:")).toBe(true);
    expect(usageMsg).not.toEqual(gatewayMsg);
  });

  it("classifies Commander usage vs GatewayClientRequestError-shaped rejects differently", () => {
    const usage = new CommanderError(1, "commander.unknownOption", "unknown option '--nope'");
    const gateway = Object.assign(new Error("unauthorized"), {
      name: "GatewayClientRequestError",
      gatewayCode: "INVALID_REQUEST",
    });
    expect(classifyCliError(usage)).toBe("usage");
    expect(classifyCliError(gateway)).toBe("gateway_reject");

    const runtime = { error: vi.fn(), exit: vi.fn() };
    reportCliError(runtime, "usage", usage.message);
    reportCliError(runtime, "gateway_reject", gateway.message);
    expect(runtime.error.mock.calls[0][0]).toMatch(/^usage:/);
    expect(runtime.error.mock.calls[1][0]).toMatch(/^gateway reject:/);
    expect(runtime.exit.mock.calls[0][0]).toBe(2);
    expect(runtime.exit.mock.calls[1][0]).toBe(1);
  });

  it("Commander help path formats usage: and remaps exit to CLI_EXIT_USAGE", () => {
    const helpSrc = readFileSync("src/cli/program/help.ts", "utf8");
    expect(helpSrc).toMatch(/formatCliErrorMessage\("usage"/);
    expect(helpSrc).toMatch(/exitOverride/);
    expect(helpSrc).toMatch(/CLI_EXIT_USAGE/);
    expect(helpSrc).toMatch(/isCommanderUsageError/);
  });

  it("Gateway CLI runGatewayCommand reports gateway_reject (never usage exit)", () => {
    const registerSrc = readFileSync("src/cli/gateway-cli/register.ts", "utf8");
    expect(registerSrc).toMatch(/reportCliError/);
    expect(registerSrc).toMatch(/"gateway_reject"/);
    expect(registerSrc).toMatch(/function runGatewayCommand/);
  });

  it("invalid --timeout local validation uses usage: + exit 2", () => {
    const registerSrc = readFileSync(
      "src/cli/program/register.status-health-sessions.ts",
      "utf8",
    );
    expect(registerSrc).toMatch(/reportCliError/);
    expect(registerSrc).toMatch(/"usage"/);
    expect(registerSrc).toMatch(/--timeout must be a positive integer/);
  });
});

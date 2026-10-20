/**
 * Stage 3 six-column **CLI backward compat** slice (narrow E1/E2).
 *
 * Proposition (§5.2 CLI backward): root help text lists the same command names
 * as the core + subcli registries, and marks `hasSubcommands` roots with ` *`.
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 *
 * Anchors: `command-registry.ts` / `register.subclis.ts` descriptors,
 * `configureProgramHelp` `subcommandTerm` + Commands hint.
 * Not a full argv spawn suite; not docs/cli page drift (see schema E1 sample).
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCoreCliCommandNames,
  getCoreCliCommandsWithSubcommands,
  registerCoreCliCommands,
} from "../../src/cli/program/command-registry.js";
import type { ProgramContext } from "../../src/cli/program/context.js";
import { configureProgramHelp } from "../../src/cli/program/help.js";
import {
  getSubCliCommandsWithSubcommands,
  getSubCliEntries,
  registerSubCliCommands,
} from "../../src/cli/program/register.subclis.js";
import { stripAnsi } from "../../src/terminal/ansi.js";

const ctx: ProgramContext = {
  programVersion: "0.0.0-inventory",
  channelOptions: ["telegram"],
  messageChannelOptions: "telegram",
  agentChannelOptions: "last|telegram",
};

function captureRootHelp(): string {
  const argv = ["node", "openbot", "--help"];
  process.argv = argv;
  const program = new Command();
  // Match buildProgram order: help config first, then command registration.
  configureProgramHelp(program, ctx);
  registerCoreCliCommands(program, ctx, argv);
  registerSubCliCommands(program, argv);

  let help = "";
  const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    help += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  try {
    program.outputHelp();
  } finally {
    writeSpy.mockRestore();
  }
  return stripAnsi(help);
}

describe("Stage 3 CLI backward compat (E1/E2 narrow)", () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("root help lists every core + subcli registry command name", () => {
    const help = captureRootHelp();
    const core = getCoreCliCommandNames();
    const sub = getSubCliEntries().map((entry) => entry.name);
    expect(core.length).toBeGreaterThan(5);
    expect(sub.length).toBeGreaterThan(5);

    for (const name of [...core, ...sub]) {
      expect(help, `help missing registry command ${name}`).toMatch(
        new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`),
      );
    }
  });

  it("root help suffixes * only for hasSubcommands registry roots", () => {
    const help = captureRootHelp();
    const core = getCoreCliCommandNames();
    const sub = getSubCliEntries().map((entry) => entry.name);
    const starred = new Set([
      ...getCoreCliCommandsWithSubcommands(),
      ...getSubCliCommandsWithSubcommands(),
    ]);

    expect(help).toContain("Hint: commands suffixed with * have subcommands");
    for (const name of starred) {
      expect(help, `expected ${name} *`).toContain(`${name} *`);
    }
    for (const name of [...core, ...sub].filter((n) => !starred.has(n))) {
      expect(help, `unexpected ${name} *`).not.toContain(`${name} *`);
    }
  });

  it("root help examples use openbot display name (not openclaw)", () => {
    const help = captureRootHelp();
    expect(help).toMatch(/Examples:/);
    expect(help).toMatch(/\bopenbot gateway\b/);
    expect(help).toMatch(/\bopenbot models --help\b/);
    expect(help).not.toMatch(/\bopenclaw\b/);
  });
});

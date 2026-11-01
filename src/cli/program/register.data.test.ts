import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerDataCli } from "./register.data.js";

function buildDataCommand(): Command {
  const program = new Command();
  program.name("openbot");
  program.exitOverride(); // throw instead of process.exit on parse errors
  registerDataCli(program);
  const data = program.commands.find((c) => c.name() === "data");
  if (!data) {
    throw new Error("data command not registered");
  }
  return data;
}

describe("registerDataCli", () => {
  it("registers the data command group with info/migrate/forget subcommands", () => {
    const data = buildDataCommand();
    const names = data.commands.map((c) => c.name()).toSorted();
    expect(names).toEqual(["forget", "info", "migrate"].toSorted());
  });

  it("requires --scope and --id for data forget", () => {
    const data = buildDataCommand();
    const forget = data.commands.find((c) => c.name() === "forget");
    expect(forget).toBeDefined();
    const scopeOption = forget?.options.find((o) => o.long === "--scope");
    const idOption = forget?.options.find((o) => o.long === "--id");
    expect(scopeOption?.required).toBe(true);
    expect(idOption?.required).toBe(true);
  });

  it("exposes migrate --target as required and forget dry-run/--yes flags", () => {
    const data = buildDataCommand();
    const migrate = data.commands.find((c) => c.name() === "migrate");
    const forget = data.commands.find((c) => c.name() === "forget");
    expect(migrate).toBeDefined();
    expect(forget).toBeDefined();
    const targetOption = migrate?.options.find((o) => o.long === "--target");
    expect(targetOption?.required).toBe(true);
    const flags = (forget?.options ?? []).map((o) => o.long);
    expect(flags).toEqual(expect.arrayContaining(["--dry-run", "--yes", "--purge-temp"]));
  });
});

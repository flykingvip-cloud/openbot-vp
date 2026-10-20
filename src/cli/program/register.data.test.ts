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
  it("registers the data command group with export/restore/readiness subcommands", () => {
    const data = buildDataCommand();
    const names = data.commands.map((c) => c.name()).toSorted();
    expect(names).toEqual(
      ["export", "info", "migrate", "restore", "verify-migration-readiness"].toSorted(),
    );
  });

  it("requires --archive for data restore", () => {
    const data = buildDataCommand();
    const restore = data.commands.find((c) => c.name() === "restore");
    expect(restore).toBeDefined();
    const archiveOption = restore?.options.find((o) => o.long === "--archive");
    expect(archiveOption?.required).toBe(true);
  });

  it("exposes the legacy-workspace gate flag on verify-migration-readiness", () => {
    const data = buildDataCommand();
    const verify = data.commands.find((c) => c.name() === "verify-migration-readiness");
    const flags = (verify?.options ?? []).map((o) => o.long);
    expect(flags).toContain("--fail-on-legacy-workspace");
    expect(flags).toContain("--json");
  });
});

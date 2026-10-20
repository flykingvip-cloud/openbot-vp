import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPlatformCli } from "./register.platform.js";

function buildPlatformCommand(): Command {
  const program = new Command();
  program.name("openbot");
  program.exitOverride();
  registerPlatformCli(program);
  const platform = program.commands.find((c) => c.name() === "platform");
  if (!platform) {
    throw new Error("platform command not registered");
  }
  return platform;
}

async function runCli(scratch: string, args: string[]): Promise<void> {
  const program = new Command();
  program.name("openbot");
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerPlatformCli(program);
  await program.parseAsync(["platform", ...args], { from: "user" });
}

describe("registerPlatformCli", () => {
  it("registers platform with tenant-provision and a tenant-import subgroup", () => {
    const platform = buildPlatformCommand();
    const names = platform.commands.map((c) => c.name()).toSorted();
    expect(names).toContain("tenant-provision");
    expect(names).toContain("tenant-import");

    const tenantImport = platform.commands.find((c) => c.name() === "tenant-import");
    const subNames = (tenantImport?.commands ?? []).map((c) => c.name()).toSorted();
    expect(subNames).toEqual(["package", "preflight", "run"].toSorted());
  });

  it("requires --archive and --target on tenant-import run", () => {
    const platform = buildPlatformCommand();
    const run = platform.commands
      .find((c) => c.name() === "tenant-import")
      ?.commands.find((c) => c.name() === "run");
    const required = (run?.options ?? []).filter((o) => o.required).map((o) => o.long);
    expect(required).toContain("--archive");
    expect(required).toContain("--target");
  });
});

describe("platform tenant-import (functional)", () => {
  let scratch = "";
  let sourceRoot = "";
  let tenantsRoot = "";

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platcli-"));
    sourceRoot = path.join(scratch, "src-root");
    tenantsRoot = path.join(scratch, "tenants");
    // Collected source layout: control-plane/ + users/<uid>/OpenBot/
    await fs.mkdir(path.join(sourceRoot, "control-plane"), { recursive: true });
    await fs.writeFile(
      path.join(sourceRoot, "control-plane", "seat-assets.json"),
      JSON.stringify({ seats: [{ seatId: "s1", agentId: "main" }] }),
    );
    const openbotDir = path.join(sourceRoot, "users", "u1", "OpenBot");
    await fs.mkdir(path.join(openbotDir, "agents", "main", "workspace"), { recursive: true });
    await fs.writeFile(path.join(openbotDir, "agents", "main", "workspace", "note.md"), "hello");
    await fs.mkdir(path.join(openbotDir, ".meta"), { recursive: true });
    await fs.writeFile(path.join(openbotDir, ".meta", "manifest.json"), "{}");
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("packages a source root then runs the import into the tenant tree", async () => {
    const pkg = path.join(scratch, "pkg.zip");
    await runCli(scratch, [
      "tenant-import",
      "package",
      "--source-root",
      sourceRoot,
      "--source-tenant",
      "src",
      "--target",
      "acme",
      "--out",
      pkg,
    ]);
    await expect(fs.access(pkg)).resolves.toBeUndefined();

    await runCli(scratch, [
      "tenant-import",
      "run",
      "--archive",
      pkg,
      "--target",
      "acme",
      "--tenants-root",
      tenantsRoot,
      "--job-id",
      "job-1",
    ]);
    // The control-plane slice was committed into the tenant tree.
    await expect(
      fs.access(path.join(tenantsRoot, "acme", "control-plane", "seat-assets.json")),
    ).resolves.toBeUndefined();
  });
});

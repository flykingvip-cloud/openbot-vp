import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
  writeConfigFile: vi.fn(async () => undefined),
}));

const { preflightMigration, startMigration, clearMigrationJobForTests } =
  await import("./migration-engine.js");

describe("migration-engine", () => {
  const sourceRoot = path.join(os.tmpdir(), `openbot-mig-src-${Date.now()}`);
  const targetParent = path.join(os.tmpdir(), `openbot-mig-dst-${Date.now()}`);

  afterEach(async () => {
    clearMigrationJobForTests();
    await fs.rm(sourceRoot, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(targetParent, { recursive: true, force: true }).catch(() => undefined);
  });

  it("preflight rejects empty target path", async () => {
    const cfg = { data: { root: sourceRoot, mode: "local", schemaVersion: 1 } } as OpenBotConfig;
    await fs.mkdir(path.join(sourceRoot, "agents"), { recursive: true });
    const result = await preflightMigration({ targetPath: "", cfg });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不能为空");
  });

  it("migrates core bundle to target OpenBot folder", async () => {
    const cfg = { data: { root: sourceRoot, mode: "local", schemaVersion: 1 } } as OpenBotConfig;
    await fs.mkdir(path.join(sourceRoot, "agents", "main"), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, "agents", "main", "note.txt"), "hello");
    await fs.mkdir(targetParent, { recursive: true });

    const preflight = await preflightMigration({ targetPath: targetParent, cfg });
    expect(preflight.ok).toBe(true);

    const job = await startMigration({ targetPath: targetParent, cfg });
    expect(job.phase).toBe("done");
    const targetRoot = job.targetRoot;
    await expect(
      fs.readFile(path.join(targetRoot, "agents", "main", "note.txt"), "utf-8"),
    ).resolves.toBe("hello");
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDataExportArchive, restoreDataExportArchive } from "./data-export.js";
import { estimateMigrationBundleSize, formatBytesHuman } from "./migration-bundle.js";

describe("migration-bundle", () => {
  const root = path.join(os.tmpdir(), `openbot-bundle-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  it("estimates bundle size for core paths", async () => {
    await fs.mkdir(path.join(root, "agents", "main"), { recursive: true });
    await fs.writeFile(path.join(root, "agents", "main", "a.txt"), "abc");
    const result = estimateMigrationBundleSize(root);
    expect(result.bytes).toBeGreaterThan(0);
    expect(formatBytesHuman(result.bytes)).toContain("B");
  });
});

describe("data-export", () => {
  const root = path.join(os.tmpdir(), `openbot-export-${Date.now()}`);
  const restoreRoot = path.join(os.tmpdir(), `openbot-restore-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(restoreRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("creates and restores export without credentials paths", async () => {
    await fs.mkdir(path.join(root, "agents", "main", "conversations", "archive"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, "agents", "main", "conversations", "archive", "sess.jsonl"),
      '{"role":"user"}\n',
    );
    await fs.mkdir(path.join(root, ".meta"), { recursive: true });
    await fs.writeFile(path.join(root, ".meta", "manifest.json"), "{}");

    const exported = await createDataExportArchive({
      cfg: { data: { root, mode: "local", schemaVersion: 1 } },
      outputDir: path.join(root, "out"),
    });
    expect(exported.manifest.excluded).toContain("credentials");
    expect(exported.bytes).toBeGreaterThan(0);

    const restored = await restoreDataExportArchive({
      archivePath: exported.exportPath,
      targetRoot: restoreRoot,
    });
    const archived = path.join(restoreRoot, "agents/main/conversations/archive/sess.jsonl");
    await expect(fs.readFile(archived, "utf-8")).resolves.toContain("user");
    expect(restored.targetRoot).toBe(path.resolve(restoreRoot));
  });
});

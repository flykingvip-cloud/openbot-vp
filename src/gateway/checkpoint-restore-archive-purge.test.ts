import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHECKPOINT_RESTORE_ARCHIVE_RETENTION_MS,
  purgeCheckpointRestoreArchives,
} from "./checkpoint-restore-archive-purge.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("purgeCheckpointRestoreArchives", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeRoot(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-restore-archive-"));
    tempDirs.push(dir);
    return dir;
  }

  async function touchMtime(filePath: string, mtimeMs: number): Promise<void> {
    const atime = new Date();
    const mtime = new Date(mtimeMs);
    await fs.utimes(filePath, atime, mtime);
  }

  it("keeps archives younger than 7 days and deletes older ones", async () => {
    const root = await makeRoot();
    const archiveDir = path.join(root, "sess-main.jsonl.archive");
    await fs.mkdir(archiveDir, { recursive: true });
    const fresh = path.join(archiveDir, "cp-fresh.jsonl");
    const stale = path.join(archiveDir, "cp-stale.jsonl");
    await fs.writeFile(fresh, '{"id":"a"}\n', "utf8");
    await fs.writeFile(stale, '{"id":"b"}\n', "utf8");
    const now = Date.now();
    await touchMtime(fresh, now - 2 * DAY_MS);
    await touchMtime(stale, now - 8 * DAY_MS);

    const result = await purgeCheckpointRestoreArchives({
      directories: [root],
      olderThanMs: CHECKPOINT_RESTORE_ARCHIVE_RETENTION_MS,
      nowMs: now,
    });

    expect(result.removedFiles).toBe(1);
    expect(await fs.readFile(fresh, "utf8")).toContain("a");
    await expect(fs.stat(stale)).rejects.toThrow();
  });

  it("removes empty archive dirs after purge and leaves non-archive paths alone", async () => {
    const root = await makeRoot();
    const archiveDir = path.join(root, "sess-main.jsonl.archive");
    await fs.mkdir(archiveDir, { recursive: true });
    const stale = path.join(archiveDir, "cp-old.jsonl");
    await fs.writeFile(stale, "x\n", "utf8");
    const now = Date.now();
    await touchMtime(stale, now - 10 * DAY_MS);

    const keepTranscript = path.join(root, "sess-main.jsonl");
    const keepOtherDir = path.join(root, "not-an-archive");
    await fs.writeFile(keepTranscript, "live\n", "utf8");
    await fs.mkdir(keepOtherDir);
    await fs.writeFile(path.join(keepOtherDir, "file.txt"), "keep\n", "utf8");

    const result = await purgeCheckpointRestoreArchives({
      directories: [root],
      nowMs: now,
    });

    expect(result.removedFiles).toBe(1);
    expect(result.removedEmptyDirs).toBe(1);
    await expect(fs.stat(archiveDir)).rejects.toThrow();
    expect(await fs.readFile(keepTranscript, "utf8")).toBe("live\n");
    expect(await fs.readFile(path.join(keepOtherDir, "file.txt"), "utf8")).toBe("keep\n");
  });

  it("is a no-op for missing dirs and non-positive retention", async () => {
    const missing = path.join(os.tmpdir(), `cp-restore-missing-${Date.now()}`);
    expect(await purgeCheckpointRestoreArchives({ directories: [missing] })).toEqual({
      scannedDirs: 0,
      scannedFiles: 0,
      removedFiles: 0,
      removedEmptyDirs: 0,
    });
    const root = await makeRoot();
    expect(await purgeCheckpointRestoreArchives({ directories: [root], olderThanMs: -1 })).toEqual({
      scannedDirs: 0,
      scannedFiles: 0,
      removedFiles: 0,
      removedEmptyDirs: 0,
    });
  });
});

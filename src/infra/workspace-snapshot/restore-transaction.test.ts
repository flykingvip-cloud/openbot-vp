import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPlainRelativePath,
  runRestoreTransaction,
  withWorkspaceRestoreLock,
  WorkspaceRestoreBusyError,
  WorkspaceRestoreError,
} from "./restore-transaction.js";
import type { SnapshotManifestEntry } from "./types.js";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

async function makeRoot(): Promise<{ root: string; store: string; blobs: Map<string, string> }> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-restore-txn-"));
  const root = path.join(tempDir, "workspace");
  const store = path.join(tempDir, "store");
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(store, { recursive: true });
  return { root, store, blobs: new Map() };
}

async function putBlob(
  store: string,
  blobs: Map<string, string>,
  content: string | Buffer,
): Promise<string> {
  const data = typeof content === "string" ? Buffer.from(content) : content;
  const sha = crypto.createHash("sha256").update(data).digest("hex");
  const abs = path.join(store, sha);
  await fs.writeFile(abs, data);
  blobs.set(sha, abs);
  return sha;
}

function entry(pathRel: string, sha: string, size: number, mode = 0o644): SnapshotManifestEntry {
  return { path: pathRel, sha256: sha, size, mode };
}

async function write(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

async function listFiles(root: string): Promise<Array<{ relPosix: string; abs: string }>> {
  const out: Array<{ relPosix: string; abs: string }> = [];
  async function walk(dir: string): Promise<void> {
    for (const name of await fs.readdir(dir)) {
      const abs = path.join(dir, name);
      const st = await fs.lstat(abs);
      if (st.isDirectory()) {
        await walk(abs);
      } else if (st.isFile()) {
        out.push({
          relPosix: path.relative(root, abs).split(path.sep).join("/"),
          abs,
        });
      }
    }
  }
  await walk(root);
  return out;
}

describe("assertPlainRelativePath", () => {
  it("rejects traversal and absolute paths", () => {
    expect(() => assertPlainRelativePath("../x")).toThrow(/unsafe/);
    expect(() => assertPlainRelativePath("/abs")).toThrow(/unsafe/);
    expect(() => assertPlainRelativePath("a/../b")).toThrow(/unsafe/);
    expect(() => assertPlainRelativePath("ok/file.txt")).not.toThrow();
  });
});

describe("runRestoreTransaction", () => {
  it("skips unchanged files (size + sha256) as a fast path", async () => {
    const { root, store, blobs } = await makeRoot();
    const shaA = await putBlob(store, blobs, "A");
    const shaB = await putBlob(store, blobs, "B");
    await write(root, "a.txt", "A");
    await write(root, "dir/b.txt", "B");

    const result = await runRestoreTransaction({
      rootReal: await fs.realpath(root),
      transactionParentDir: path.join(store, "txn"),
      entries: [entry("a.txt", shaA, 1), entry("dir/b.txt", shaB, 1)],
      currentFiles: await listFiles(root),
      blobPath: (sha) => blobs.get(sha) as string,
    });

    expect(result.restoredFiles).toBe(0);
    expect(result.removedFiles).toBe(0);
    expect(result.unchangedFiles).toBe(2);
    expect(await fs.readFile(path.join(root, "a.txt"), "utf8")).toBe("A");
  });

  it("writes changed files, removes extras, and leaves matching files alone", async () => {
    const { root, store, blobs } = await makeRoot();
    const shaA = await putBlob(store, blobs, "A");
    const shaB = await putBlob(store, blobs, "B");
    await write(root, "a.txt", "A-modified");
    await write(root, "dir/b.txt", "B");
    await write(root, "extra.txt", "gone");

    const result = await runRestoreTransaction({
      rootReal: await fs.realpath(root),
      transactionParentDir: path.join(store, "txn"),
      entries: [entry("a.txt", shaA, 1), entry("dir/b.txt", shaB, 1)],
      currentFiles: await listFiles(root),
      blobPath: (sha) => blobs.get(sha) as string,
    });

    expect(result.restoredFiles).toBe(1);
    expect(result.removedFiles).toBe(1);
    expect(result.unchangedFiles).toBe(1);
    expect(await fs.readFile(path.join(root, "a.txt"), "utf8")).toBe("A");
    expect(await fs.readFile(path.join(root, "dir", "b.txt"), "utf8")).toBe("B");
    await expect(fs.access(path.join(root, "extra.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back after a commit failure so the workspace is not half-deleted", async () => {
    const { root, store, blobs } = await makeRoot();
    const shaA = await putBlob(store, blobs, "A");
    const shaB = await putBlob(store, blobs, "B");
    await write(root, "keep.txt", "KEEP");
    await write(root, "a.txt", "old-a");
    await write(root, "extra.txt", "EXTRA");
    // Symlink parent that walkFiles ignores (so it is NOT moved out as an extra).
    // ensureParentDirs then fails with ELOOP after extras + a.txt have been committed.
    const outside = path.join(tempDir, "outside");
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(root, "dir"));

    let error: WorkspaceRestoreError | null = null;
    try {
      await runRestoreTransaction({
        rootReal: await fs.realpath(root),
        transactionParentDir: path.join(store, "txn"),
        entries: [entry("a.txt", shaA, 1), entry("dir/b.txt", shaB, 1)],
        currentFiles: await listFiles(root),
        blobPath: (sha) => blobs.get(sha) as string,
      });
    } catch (err) {
      error = err as WorkspaceRestoreError;
    }

    expect(error).toBeInstanceOf(WorkspaceRestoreError);
    expect(error?.phase).toBe("commit");
    expect(error?.relativePath).toBe("dir/b.txt");
    expect(error?.errno).toMatch(/ELOOP|EPERM/);
    expect(error?.rolledBack).toBe(true);
    // Original content restored (including the extra that had been moved out).
    expect(await fs.readFile(path.join(root, "keep.txt"), "utf8")).toBe("KEEP");
    expect(await fs.readFile(path.join(root, "a.txt"), "utf8")).toBe("old-a");
    expect(await fs.readFile(path.join(root, "extra.txt"), "utf8")).toBe("EXTRA");
    expect((await fs.lstat(path.join(root, "dir"))).isSymbolicLink()).toBe(true);
  });

  it("preserves errno + relativePath on failures (no generic path rewrite)", async () => {
    const { root, store, blobs } = await makeRoot();
    const sha = await putBlob(store, blobs, "X");
    // Stage failure: the blob path exists for planning but we point at a directory.
    const badBlobDir = path.join(store, "not-a-file");
    await fs.mkdir(badBlobDir);

    let error: WorkspaceRestoreError | null = null;
    try {
      await runRestoreTransaction({
        rootReal: await fs.realpath(root),
        transactionParentDir: path.join(store, "txn"),
        entries: [entry("nested/x.txt", sha, 1)],
        currentFiles: [],
        blobPath: () => badBlobDir,
      });
    } catch (err) {
      error = err as WorkspaceRestoreError;
    }

    expect(error).toBeInstanceOf(WorkspaceRestoreError);
    expect(error?.phase).toBe("stage");
    expect(error?.relativePath).toBe("nested/x.txt");
    expect(error?.errno).toMatch(/EISDIR|EPERM|EACCES|EINVAL|ENOENT|ENOTSUP/);
    expect(error?.message).toMatch(/nested\/x\.txt/);
    expect(error?.message).not.toMatch(/path is not a regular file under root/);
    expect(error?.rolledBack).toBe(true);
  });
});

describe("withWorkspaceRestoreLock", () => {
  it("rejects a concurrent restore for the same workspace", async () => {
    const { root } = await makeRoot();
    const rootReal = await fs.realpath(root);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withWorkspaceRestoreLock(rootReal, async () => {
      await gate;
      return "first";
    });
    // Let the first lock install.
    await Promise.resolve();
    await expect(withWorkspaceRestoreLock(rootReal, async () => "second")).rejects.toBeInstanceOf(
      WorkspaceRestoreBusyError,
    );
    release();
    await expect(first).resolves.toBe("first");
    await expect(withWorkspaceRestoreLock(rootReal, async () => "third")).resolves.toBe("third");
  });
});

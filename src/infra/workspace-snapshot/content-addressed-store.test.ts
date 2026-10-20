import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createContentAddressedSnapshotStore } from "./content-addressed-store.js";
import type { SnapshotManifest } from "./types.js";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

async function makeWorkspace(): Promise<{ ws: string; storeDir: string }> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-snapshot-"));
  const ws = path.join(tempDir, "workspace");
  await fs.mkdir(ws, { recursive: true });
  // store dir lives INSIDE the workspace (like memory/snapshots in production)
  const storeDir = path.join(ws, "memory", "snapshots");
  return { ws, storeDir };
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

async function readManifest(storeDir: string, checkpointId: string): Promise<SnapshotManifest> {
  const raw = await fs.readFile(path.join(storeDir, "manifests", `${checkpointId}.json`), "utf8");
  return JSON.parse(raw) as SnapshotManifest;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("content-addressed snapshot store", () => {
  it("round-trips capture -> restore (add/modify/delete reverted)", async () => {
    const { ws, storeDir } = await makeWorkspace();
    const store = createContentAddressedSnapshotStore({ storeDir });
    await writeFile(ws, "a.txt", "A");
    await writeFile(ws, "dir/b.txt", "B");

    const ref = await store.capture({ workspaceRoot: ws, checkpointId: "cp1" });
    expect(ref.store).toBe("content-addressed");
    expect(ref.fileCount).toBe(2);

    // Mutate the workspace after the checkpoint.
    await writeFile(ws, "a.txt", "A-modified");
    await writeFile(ws, "c.txt", "new file");
    await fs.rm(path.join(ws, "dir", "b.txt"));

    const result = await store.restore({ workspaceRoot: ws, ref });
    expect(result.removedFiles).toBe(1); // c.txt
    expect(result.restoredFiles).toBe(2); // a.txt + dir/b.txt

    expect(await fs.readFile(path.join(ws, "a.txt"), "utf8")).toBe("A");
    expect(await fs.readFile(path.join(ws, "dir", "b.txt"), "utf8")).toBe("B");
    expect(await exists(path.join(ws, "c.txt"))).toBe(false);
    // Store dir itself was auto-ignored (not removed by restore).
    expect(await exists(storeDir)).toBe(true);
  });

  it("deduplicates identical content into a single blob", async () => {
    const { ws, storeDir } = await makeWorkspace();
    const store = createContentAddressedSnapshotStore({ storeDir });
    await writeFile(ws, "x.txt", "same-content");
    await writeFile(ws, "y.txt", "same-content");

    await store.capture({ workspaceRoot: ws, checkpointId: "cp1" });

    const objectsDir = path.join(storeDir, "objects");
    const shards = await fs.readdir(objectsDir);
    let blobCount = 0;
    for (const shard of shards) {
      blobCount += (await fs.readdir(path.join(objectsDir, shard))).length;
    }
    expect(blobCount).toBe(1);
  });

  it("ignores .git, node_modules, and the store dir", async () => {
    const { ws, storeDir } = await makeWorkspace();
    const store = createContentAddressedSnapshotStore({ storeDir });
    await writeFile(ws, "keep.txt", "keep");
    await writeFile(ws, ".git/config", "gitconfig");
    await writeFile(ws, "node_modules/pkg/index.js", "module");

    await store.capture({ workspaceRoot: ws, checkpointId: "cp1" });
    const manifest = await readManifest(storeDir, "cp1");
    const paths = manifest.entries.map((e) => e.path);
    expect(paths).toContain("keep.txt");
    expect(paths.some((p) => p.startsWith(".git/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("memory/snapshots"))).toBe(false);
  });

  it("skips files exceeding maxFileBytes and records them", async () => {
    const { ws, storeDir } = await makeWorkspace();
    const store = createContentAddressedSnapshotStore({ storeDir, maxFileBytes: 8 });
    await writeFile(ws, "small.txt", "tiny");
    await writeFile(ws, "big.txt", "this content is definitely larger than eight bytes");

    await store.capture({ workspaceRoot: ws, checkpointId: "cp1" });
    const manifest = await readManifest(storeDir, "cp1");
    expect(manifest.entries.map((e) => e.path)).toEqual(["small.txt"]);
    expect(manifest.skipped).toEqual([{ path: "big.txt", reason: "too-large" }]);
  });

  it("does not capture symlinks (containment)", async () => {
    if (process.platform === "win32") {
      return; // symlink creation is restricted on Windows CI
    }
    const { ws, storeDir } = await makeWorkspace();
    const outside = path.join(tempDir, "outside-secret.txt");
    await fs.writeFile(outside, "SECRET", "utf8");
    const store = createContentAddressedSnapshotStore({ storeDir });
    await writeFile(ws, "real.txt", "real");
    await fs.symlink(outside, path.join(ws, "link.txt"));

    await store.capture({ workspaceRoot: ws, checkpointId: "cp1" });
    const manifest = await readManifest(storeDir, "cp1");
    const paths = manifest.entries.map((e) => e.path);
    expect(paths).toContain("real.txt");
    expect(paths).not.toContain("link.txt");
  });

  it("prune keeps referenced blobs and drops others", async () => {
    const { ws, storeDir } = await makeWorkspace();
    const store = createContentAddressedSnapshotStore({ storeDir });
    await writeFile(ws, "f.txt", "content-v1");
    await store.capture({ workspaceRoot: ws, checkpointId: "cp1" });
    await writeFile(ws, "f.txt", "content-v2");
    await store.capture({ workspaceRoot: ws, checkpointId: "cp2" });

    const countBlobs = async (): Promise<number> => {
      const objectsDir = path.join(storeDir, "objects");
      const shards = await fs.readdir(objectsDir);
      let n = 0;
      for (const shard of shards) {
        n += (await fs.readdir(path.join(objectsDir, shard))).length;
      }
      return n;
    };
    expect(await countBlobs()).toBe(2);

    const pruned = await store.prune({ keepCheckpointIds: ["cp2"] });
    expect(pruned.removedManifests).toBe(1); // cp1 manifest dropped
    expect(pruned.removedBlobs).toBe(1); // content-v1 blob dropped
    expect(await countBlobs()).toBe(1);
    expect(await exists(path.join(storeDir, "manifests", "cp1.json"))).toBe(false);
    expect(await exists(path.join(storeDir, "manifests", "cp2.json"))).toBe(true);

    // cp2 still restores correctly after prune.
    await writeFile(ws, "f.txt", "content-v3");
    await store.restore({
      workspaceRoot: ws,
      ref: { store: "content-addressed", checkpointId: "cp2", manifestPath: "manifests/cp2.json" },
    });
    expect(await fs.readFile(path.join(ws, "f.txt"), "utf8")).toBe("content-v2");
  });
});

describe("content-addressed restore optimizations", () => {
  it("skips rewriting files that already match the checkpoint", async () => {
    const { ws, storeDir } = await makeWorkspace();
    const store = createContentAddressedSnapshotStore({ storeDir });
    await writeFile(ws, "a.txt", "same");
    await writeFile(ws, "b.txt", "same-b");
    const ref = await store.capture({ workspaceRoot: ws, checkpointId: "cp-skip" });

    const result = await store.restore({ workspaceRoot: ws, ref });
    expect(result.restoredFiles).toBe(0);
    expect(result.removedFiles).toBe(0);
    expect(result.unchangedFiles).toBe(2);
    expect(await fs.readFile(path.join(ws, "a.txt"), "utf8")).toBe("same");
  });

  it("does not leave a half-deleted workspace when a write fails mid-restore", async () => {
    const { ws, storeDir } = await makeWorkspace();
    const store = createContentAddressedSnapshotStore({ storeDir });
    await writeFile(ws, "keep.txt", "KEEP");
    await writeFile(ws, "a.txt", "A");
    const ref = await store.capture({ workspaceRoot: ws, checkpointId: "cp-fail" });

    await writeFile(ws, "a.txt", "A-modified");
    await writeFile(ws, "extra.txt", "extra");
    // Symlink parent ignored by walkFiles; commit fails with ELOOP after extras moved.
    const outside = path.join(tempDir, "outside-nested");
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(ws, "nested"));

    const manifestPath = path.join(storeDir, "manifests", "cp-fail.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as SnapshotManifest;
    const aEntry = manifest.entries.find((e) => e.path === "a.txt");
    if (!aEntry) {
      throw new Error("missing a.txt entry");
    }
    manifest.entries.push({
      path: "nested/deep.txt",
      sha256: aEntry.sha256,
      mode: 0o644,
      size: aEntry.size,
    });
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(store.restore({ workspaceRoot: ws, ref })).rejects.toMatchObject({
      name: "WorkspaceRestoreError",
      rolledBack: true,
    });

    expect(await fs.readFile(path.join(ws, "keep.txt"), "utf8")).toBe("KEEP");
    expect(await fs.readFile(path.join(ws, "a.txt"), "utf8")).toBe("A-modified");
    expect(await fs.readFile(path.join(ws, "extra.txt"), "utf8")).toBe("extra");
    expect((await fs.lstat(path.join(ws, "nested"))).isSymbolicLink()).toBe(true);
  });
});

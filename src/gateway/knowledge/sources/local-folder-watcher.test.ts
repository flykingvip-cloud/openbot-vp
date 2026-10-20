import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpRoot = path.join(os.tmpdir(), `openbot-lf-watch-${Math.random().toString(36).slice(2)}`);

vi.mock("../../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpRoot,
  };
});

const { upsertLocalFolderBinding, deleteLocalFolderBinding } =
  await import("./local-folder-binding-store.js");
const {
  isLocalFolderWatcherRunning,
  resetLocalFolderWatchersForTests,
  setLocalFolderWatchScanFn,
  startLocalFolderWatcher,
  stopLocalFolderWatcher,
} = await import("./local-folder-watcher.js");

describe("local-folder-watcher (P1.1)", () => {
  let folderRoot: string;

  beforeEach(async () => {
    await resetLocalFolderWatchersForTests();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    folderRoot = path.join(tmpRoot, "notes");
    fs.mkdirSync(folderRoot, { recursive: true });
    fs.writeFileSync(path.join(folderRoot, "a.md"), "# a\n", "utf8");
  });

  afterEach(async () => {
    await resetLocalFolderWatchersForTests();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("starts and stops watcher when enabled", async () => {
    const binding = upsertLocalFolderBinding({
      sourceDescriptorId: "src-1",
      knowledgeBaseId: "kb-1",
      deviceId: "local",
      rootPath: folderRoot,
      rootLabel: "Notes",
      watcherEnabled: true,
      mode: "local_index",
    });
    const started = startLocalFolderWatcher(binding);
    expect(started).toBe(true);
    expect(isLocalFolderWatcherRunning(binding.bindingId)).toBe(true);
    await stopLocalFolderWatcher(binding.bindingId);
    expect(isLocalFolderWatcherRunning(binding.bindingId)).toBe(false);
    deleteLocalFolderBinding(binding.bindingId);
  });

  it("does not start when watcherEnabled is false", () => {
    const binding = upsertLocalFolderBinding({
      sourceDescriptorId: "src-2",
      knowledgeBaseId: "kb-1",
      deviceId: "local",
      rootPath: folderRoot,
      rootLabel: "Notes",
      watcherEnabled: false,
    });
    expect(startLocalFolderWatcher(binding)).toBe(false);
    expect(isLocalFolderWatcherRunning(binding.bindingId)).toBe(false);
  });

  it("debounces burst events into a single scan", async () => {
    const scan = vi.fn(async (_params: { binding: { bindingId: string } }) => undefined);
    setLocalFolderWatchScanFn(scan);

    const binding = upsertLocalFolderBinding({
      sourceDescriptorId: "src-3",
      knowledgeBaseId: "kb-1",
      deviceId: "local",
      rootPath: folderRoot,
      rootLabel: "Notes",
      watcherEnabled: true,
    });

    expect(startLocalFolderWatcher(binding)).toBe(true);

    const { emitLocalFolderWatcherEventForTests } = await import("./local-folder-watcher.js");
    emitLocalFolderWatcherEventForTests(binding.bindingId);
    emitLocalFolderWatcherEventForTests(binding.bindingId);
    emitLocalFolderWatcherEventForTests(binding.bindingId);

    await new Promise((r) => setTimeout(r, 1000));

    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls[0]?.[0]?.binding.bindingId).toBe(binding.bindingId);

    await stopLocalFolderWatcher(binding.bindingId);
    deleteLocalFolderBinding(binding.bindingId);
  }, 5_000);
});

/**
 * Real-Chromium coverage for managed folder import.
 *
 * The Node suite (`knowledge-universe-local-folder.node.test.ts`) drives this controller with
 * hand-written doubles, so it cannot prove that the browser primitives the design depends on
 * actually behave as assumed. This suite uses the real APIs:
 *
 * - real `FileSystemDirectoryHandle` / `FileSystemFileHandle` from OPFS (`navigator.storage`)
 * - real `isSameEntry` identity comparison
 * - real IndexedDB structured-clone persistence of a directory handle
 * - real `navigator.locks` for the cross-tab guard
 *
 * Only `showDirectoryPicker` is stubbed, because it requires a user gesture that a headless
 * runner cannot produce. Everything the picker hands back is a genuine OPFS handle.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import type {
  LocalFolderSyncCommitRequest,
  LocalFolderSyncCommitResponse,
  LocalFolderSyncPlanRequest,
  LocalFolderSyncPlanResponse,
} from "../capability/knowledge-universe/endpoints.ts";
import type { KnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";

type UploadModule = typeof import("./knowledge-universe-local-folder-upload.ts");

const MODULE_PATH = "./knowledge-universe-local-folder-upload.ts";

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

/** A separate module instance, so its in-memory identity caches start empty. */
async function importFreshUploadModule(): Promise<UploadModule> {
  return import(/* @vite-ignore */ `${MODULE_PATH}?cold=${crypto.randomUUID()}`);
}

/** Read the persisted identities straight out of IndexedDB, bypassing the controller. */
async function readStoredIdentities(): Promise<
  Array<{ directoryId: string; handle: FileSystemDirectoryHandle }>
> {
  const open = indexedDB.open("openbot-knowledge-local-folder-identities", 1);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    open.addEventListener("success", () => resolve(open.result), { once: true });
    open.addEventListener("error", () => reject(open.error), { once: true });
  });
  try {
    const request = database
      .transaction("directories", "readonly")
      .objectStore("directories")
      .getAll();
    return await new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
  } finally {
    database.close();
  }
}

async function writeFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  body: string,
): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(body);
  await writable.close();
}

function stubPicker(directory: FileSystemDirectoryHandle): void {
  Object.defineProperty(window, "showDirectoryPicker", {
    configurable: true,
    writable: true,
    value: async () => directory,
  });
}

function syncPlan(patch: Partial<LocalFolderSyncPlanResponse> = {}): LocalFolderSyncPlanResponse {
  return {
    bindingId: "binding-1",
    sourceDescriptorId: "source-1",
    needUpload: [],
    unchanged: [],
    missingOnDevice: [],
    planId: "lfp:browser-plan",
    generation: 3,
    deviceId: "device-browser",
    expiresAtMs: Date.now() + 600_000,
    ...patch,
  };
}

function commitResponse(): LocalFolderSyncCommitResponse {
  return {
    bindingId: "binding-1",
    sourceDescriptorId: "source-1",
    ingested: 0,
    skipped: 0,
    tombstoned: 0,
    snapshotted: 0,
    errors: [],
  };
}

describe("managed folder import in real Chromium", () => {
  beforeAll(() => {
    // Guard the premise: if the runner is not a real browser these assertions are meaningless.
    expect(typeof navigator.storage?.getDirectory).toBe("function");
    expect(typeof indexedDB).toBe("object");
    expect(navigator.locks).toBeTruthy();
  });

  it("reuses one opaque directoryId for a second handle to the same directory", async () => {
    const module: UploadModule = await import(/* @vite-ignore */ MODULE_PATH);
    const root = await opfsRoot();
    const name = uniqueName("identity");
    const first = await root.getDirectoryHandle(name, { create: true });
    const second = await root.getDirectoryHandle(name);

    // Premise: two distinct handle objects that Chromium reports as the same entry.
    expect(first).not.toBe(second);
    expect(await first.isSameEntry(second)).toBe(true);

    stubPicker(first);
    const stateA = {} as AppPortState;
    await module.pickManagedPushDirectory(stateA);
    const firstId = module.getManagedPushDirectoryId(stateA);
    expect(firstId).toMatch(/^directory:/);

    stubPicker(second);
    const stateB = {} as AppPortState;
    await module.pickManagedPushDirectory(stateB);
    expect(module.getManagedPushDirectoryId(stateB)).toBe(firstId);
  });

  it("persists the directory handle in IndexedDB so a cold surface recovers the same id", async () => {
    const root = await opfsRoot();
    const name = uniqueName("persisted");
    const original = await root.getDirectoryHandle(name, { create: true });

    const before: UploadModule = await import(/* @vite-ignore */ MODULE_PATH);
    stubPicker(original);
    const stateBefore = {} as AppPortState;
    await before.pickManagedPushDirectory(stateBefore);
    const persistedId = before.getManagedPushDirectoryId(stateBefore);
    expect(persistedId).toMatch(/^directory:/);

    // The stored record must survive structured clone and still identify the same entry. This is
    // the assumption the whole binding identity rests on, and only a real browser can prove it.
    const stored = await readStoredIdentities();
    const match = stored.find((record) => record.directoryId === persistedId);
    expect(match).toBeTruthy();
    expect(match!.handle).not.toBe(original);
    expect(await original.isSameEntry(match!.handle)).toBe(true);

    // A cold surface has no WeakMap and no session handle list, so a matching id can only come
    // back out of IndexedDB.
    const cold = await importFreshUploadModule();
    expect(cold).not.toBe(before);
    const reselected = await root.getDirectoryHandle(name);
    stubPicker(reselected);
    const stateAfter = {} as AppPortState;
    await cold.pickManagedPushDirectory(stateAfter);
    expect(cold.getManagedPushDirectoryId(stateAfter)).toBe(persistedId);
  });

  it("mints exactly one identity when two surfaces pick the same directory concurrently", async () => {
    const module: UploadModule = await import(/* @vite-ignore */ MODULE_PATH);
    const root = await opfsRoot();
    const name = uniqueName("concurrent");
    await root.getDirectoryHandle(name, { create: true });

    const stateA = {} as AppPortState;
    const stateB = {} as AppPortState;
    const [handleA, handleB] = await Promise.all([
      root.getDirectoryHandle(name),
      root.getDirectoryHandle(name),
    ]);

    // Both picks race through the real Web Locks guard.
    stubPicker(handleA);
    const pickA = module.pickManagedPushDirectory(stateA);
    stubPicker(handleB);
    const pickB = module.pickManagedPushDirectory(stateB);
    await Promise.all([pickA, pickB]);

    const idA = module.getManagedPushDirectoryId(stateA);
    const idB = module.getManagedPushDirectoryId(stateB);
    expect(idA).toMatch(/^directory:/);
    expect(idB).toBe(idA);
  });

  it("uploads real folder bytes under one lease and lets the server own deletes", async () => {
    const module: UploadModule = await import(/* @vite-ignore */ MODULE_PATH);
    const root = await opfsRoot();
    const directory = await root.getDirectoryHandle(uniqueName("inventory"), { create: true });
    await writeFile(directory, "notes.md", "# Notes\n\nreal browser content\n");
    await writeFile(directory, "table.csv", "a,b\n1,2\n");
    await writeFile(directory, "photo.png", "not really an image");
    await writeFile(directory, "bundle.zip", "not really an archive");
    await writeFile(directory, "legacy.doc", "old word format");
    await writeFile(directory, "empty.txt", "");
    const nested = await directory.getDirectoryHandle("nested", { create: true });
    await writeFile(nested, "deep.txt", "nested content\n");

    const planRequests: LocalFolderSyncPlanRequest[] = [];
    const commitRequests: LocalFolderSyncCommitRequest[] = [];
    const gateway = {
      localFolderSyncPlan: async (request: LocalFolderSyncPlanRequest) => {
        planRequests.push(request);
        return syncPlan({
          needUpload: request.candidates.map((candidate) => ({
            relativePath: candidate.relativePath,
            reason: "missing" as const,
            docId: `doc-${candidate.relativePath}`,
          })),
          missingOnDevice: ["retired.md"],
        });
      },
      localFolderSyncCommit: async (request: LocalFolderSyncCommitRequest) => {
        commitRequests.push(request);
        return commitResponse();
      },
    } as unknown as KnowledgeUniverseGateway;

    const summary = await module.syncManagedPushDirectory({
      gateway,
      bindingId: "binding-1",
      deviceId: "device-browser",
      directory,
    });

    // Only formats the gateway extractor can ingest, and no zero-byte file.
    expect(planRequests).toHaveLength(1);
    const candidatePaths = planRequests[0].candidates.map((c) => c.relativePath).toSorted();
    expect(candidatePaths).toEqual(["deep.txt", "notes.md", "table.csv"]);
    // Hashes come from real bytes read back out of OPFS.
    expect(planRequests[0].candidates.every((c) => /^[a-f0-9]{64}$/.test(c.rawHash ?? ""))).toBe(
      true,
    );

    // One lease across every batch, upload phases first, exactly one finalize, no client deletes.
    expect(commitRequests.length).toBeGreaterThanOrEqual(2);
    for (const request of commitRequests) {
      expect(request.planId).toBe("lfp:browser-plan");
      expect(request.generation).toBe(3);
      expect(request).not.toHaveProperty("deletedRelativePaths");
      expect(request).not.toHaveProperty("applyDeletes");
    }
    const finalizes = commitRequests.filter((request) => request.phase === "finalize");
    expect(finalizes).toHaveLength(1);
    expect(finalizes[0].files).toEqual([]);
    expect(commitRequests.at(-1)!.phase).toBe("finalize");

    expect(summary).toEqual({
      candidateCount: 3,
      uploadedCount: 3,
      deletedCount: 1,
      commitCount: commitRequests.length,
    });
  });
});

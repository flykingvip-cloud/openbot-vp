import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { walkLocalInventoryPage } from "./journal/inventory.js";
import { VaultSyncControlPlane } from "./store/control-plane.js";
import { createVaultWithLocalDevice, DeviceSyncEngine } from "./sync/engine.js";

const tmpDirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("vault-sync control plane + dual device", () => {
  it("creates vault, uploads encrypted blob, and does not store plaintext path", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "pw-a",
      deviceId: "device-a",
    });
    const vaultRoot = path.join(root, "a");
    fs.mkdirSync(vaultRoot, { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, "hello.md"), "# hi\n");

    const engine = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: created.deviceId,
      rootPath: vaultRoot,
      localStoreDir: path.join(root, "store-a"),
    });
    engine.unlockAndVerify("pw-a");
    const push = engine.pushLocalChanges();
    expect(push.uploaded).toBe(1);
    expect(push.errors).toEqual([]);

    const vaultDir = path.join(root, "plane", "vaults", created.vaultId);
    const raw = fs.readFileSync(path.join(vaultDir, "revisions.json"), "utf8");
    expect(raw.includes("hello.md")).toBe(false);
    expect(raw.includes("# hi")).toBe(false);
  });

  it("idempotent commit does not duplicate history", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "pw-a",
      deviceId: "device-a",
    });
    const vaultRoot = path.join(root, "a");
    fs.mkdirSync(vaultRoot, { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, "note.md"), "one\n");

    const engine = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: created.deviceId,
      rootPath: vaultRoot,
      localStoreDir: path.join(root, "store-a"),
    });
    engine.unlockAndVerify("pw-a");
    engine.pushLocalChanges();
    // second push with empty journal should skip unchanged inventory (baseline mtime/size).
    const histAfterFirst = plane.listRevisionsSince(created.vaultId, null, 10);
    expect(histAfterFirst.revisions.length).toBe(1);
    engine.pushLocalChanges();
    const histAfterSecond = plane.listRevisionsSince(created.vaultId, null, 10);
    expect(histAfterSecond.revisions.length).toBe(1);
  });

  it("device A offline edit syncs to device B", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "shared-secret-password",
      deviceId: "device-a",
    });
    plane.registerDevice({
      vaultId: created.vaultId,
      deviceId: "device-b",
      platform: "desktop",
    });

    const rootA = path.join(root, "a");
    const rootB = path.join(root, "b");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    fs.writeFileSync(path.join(rootA, "shared.md"), "from-a\n");

    const engineA = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-a",
      rootPath: rootA,
      localStoreDir: path.join(root, "store-a"),
    });
    const engineB = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-b",
      rootPath: rootB,
      localStoreDir: path.join(root, "store-b"),
    });
    engineA.unlockAndVerify("shared-secret-password");
    engineB.unlockAndVerify("shared-secret-password");

    const push = engineA.pushLocalChanges();
    expect(push.uploaded).toBeGreaterThanOrEqual(1);

    const pull = engineB.pullRemoteChanges();
    expect(pull.errors).toEqual([]);
    expect(fs.readFileSync(path.join(rootB, "shared.md"), "utf8")).toBe("from-a\n");
  });

  it("concurrent edits do not silently overwrite — conflict copies", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "shared-secret-password",
      deviceId: "device-a",
    });
    plane.registerDevice({
      vaultId: created.vaultId,
      deviceId: "device-b",
      platform: "desktop",
    });

    const rootA = path.join(root, "a");
    const rootB = path.join(root, "b");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    fs.writeFileSync(path.join(rootA, "doc.md"), "base\n");

    const engineA = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-a",
      rootPath: rootA,
      localStoreDir: path.join(root, "store-a"),
    });
    const engineB = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-b",
      rootPath: rootB,
      localStoreDir: path.join(root, "store-b"),
    });
    engineA.unlockAndVerify("shared-secret-password");
    engineB.unlockAndVerify("shared-secret-password");
    engineA.pushLocalChanges();
    engineB.pullRemoteChanges();

    fs.writeFileSync(path.join(rootA, "doc.md"), "edit-a\n");
    fs.writeFileSync(path.join(rootB, "doc.md"), "edit-b\n");
    engineA.pushLocalChanges();
    const pull = engineB.pullRemoteChanges();
    expect(pull.conflicts).toBeGreaterThanOrEqual(1);
    const files = fs.readdirSync(rootB);
    expect(files.some((f) => f.includes("sync-conflict"))).toBe(true);
    // Local edit-b must still exist (not silently overwritten without trace)
    expect(fs.readFileSync(path.join(rootB, "doc.md"), "utf8")).toBe("edit-b\n");
  });

  it("inventory pagination never silently truncates", () => {
    const root = tmp();
    const vaultRoot = path.join(root, "vault");
    fs.mkdirSync(vaultRoot, { recursive: true });
    for (let i = 0; i < 30; i += 1) {
      fs.writeFileSync(path.join(vaultRoot, `f-${String(i).padStart(3, "0")}.md`), `x${i}\n`);
    }
    const page1 = walkLocalInventoryPage({ rootPath: vaultRoot, limit: 10 });
    expect(page1.entries).toHaveLength(10);
    expect(page1.truncated).toBe(true);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = walkLocalInventoryPage({
      rootPath: vaultRoot,
      limit: 10,
      cursor: page1.nextCursor,
    });
    expect(page2.entries).toHaveLength(10);
    const page3 = walkLocalInventoryPage({
      rootPath: vaultRoot,
      limit: 10,
      cursor: page2.nextCursor,
    });
    expect(page3.entries).toHaveLength(10);
    expect(page3.truncated).toBe(false);
    expect(page1.scannedTotal).toBe(30);
  });

  it("tombstone delete syncs to peer", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "shared-secret-password",
      deviceId: "device-a",
    });
    plane.registerDevice({
      vaultId: created.vaultId,
      deviceId: "device-b",
      platform: "desktop",
    });
    const rootA = path.join(root, "a");
    const rootB = path.join(root, "b");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    fs.writeFileSync(path.join(rootA, "gone.md"), "bye\n");

    const engineA = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-a",
      rootPath: rootA,
      localStoreDir: path.join(root, "store-a"),
    });
    const engineB = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-b",
      rootPath: rootB,
      localStoreDir: path.join(root, "store-b"),
    });
    engineA.unlockAndVerify("shared-secret-password");
    engineB.unlockAndVerify("shared-secret-password");
    engineA.pushLocalChanges();
    engineB.pullRemoteChanges();
    expect(fs.existsSync(path.join(rootB, "gone.md"))).toBe(true);

    fs.unlinkSync(path.join(rootA, "gone.md"));
    engineA.noteLocalChange("gone.md", "delete");
    engineA.pushLocalChanges();
    engineB.pullRemoteChanges();
    expect(fs.existsSync(path.join(rootB, "gone.md"))).toBe(false);

    const history = plane.getPathHistory(
      created.vaultId,
      // recover opaque id via inventory
      plane.getInventoryPage(created.vaultId, null, 10).items[0].opaquePathId,
    );
    expect(history.some((r) => r.tombstone)).toBe(true);
  });

  it("restores a tombstoned file from history and peers can pull it", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "shared-secret-password",
      deviceId: "device-a",
    });
    plane.registerDevice({
      vaultId: created.vaultId,
      deviceId: "device-b",
      platform: "desktop",
    });
    const rootA = path.join(root, "a");
    const rootB = path.join(root, "b");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    fs.writeFileSync(path.join(rootA, "notes.md"), "keep me\n");

    const engineA = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-a",
      rootPath: rootA,
      localStoreDir: path.join(root, "store-a"),
    });
    const engineB = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-b",
      rootPath: rootB,
      localStoreDir: path.join(root, "store-b"),
    });
    engineA.unlockAndVerify("shared-secret-password");
    engineB.unlockAndVerify("shared-secret-password");
    engineA.pushLocalChanges();
    engineB.pullRemoteChanges();

    const opaquePathId = plane.getInventoryPage(created.vaultId, null, 10).items[0].opaquePathId;
    const beforeDelete = plane.getPathHistory(created.vaultId, opaquePathId);
    const contentRevisionId = beforeDelete.find((r) => !r.tombstone)!.revisionId;

    fs.unlinkSync(path.join(rootA, "notes.md"));
    engineA.noteLocalChange("notes.md", "delete");
    engineA.pushLocalChanges();
    engineB.pullRemoteChanges();
    expect(fs.existsSync(path.join(rootA, "notes.md"))).toBe(false);
    expect(fs.existsSync(path.join(rootB, "notes.md"))).toBe(false);

    const trash = plane.getTrashPage(created.vaultId, null, 10);
    expect(trash.items.some((item) => item.opaquePathId === opaquePathId)).toBe(true);

    const history = engineA.getPathHistory({ relativePath: "notes.md" });
    expect(history.some((r) => r.tombstone)).toBe(true);

    // Restore using the tombstone revision id (engine walks back to content).
    const tombstoneId = history.find((r) => r.tombstone)!.revisionId;
    const restored = engineA.restoreFromRevision(tombstoneId);
    expect(restored.relativePath).toBe("notes.md");
    expect(restored.restoredFromRevisionId).toBe(contentRevisionId);
    expect(fs.readFileSync(path.join(rootA, "notes.md"), "utf8")).toBe("keep me\n");

    engineB.pullRemoteChanges();
    expect(fs.readFileSync(path.join(rootB, "notes.md"), "utf8")).toBe("keep me\n");
    expect(plane.getTrashPage(created.vaultId, null, 10).items).toHaveLength(0);
  });

  it("selective sync skips images on push and pull", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "shared-secret-password",
      deviceId: "device-a",
    });
    plane.registerDevice({
      vaultId: created.vaultId,
      deviceId: "device-b",
      platform: "desktop",
    });
    const rootA = path.join(root, "a");
    const rootB = path.join(root, "b");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    fs.writeFileSync(path.join(rootA, "note.md"), "text\n");
    fs.writeFileSync(path.join(rootA, "photo.png"), "PNGDATA");

    const engineA = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-a",
      rootPath: rootA,
      localStoreDir: path.join(root, "store-a"),
    });
    const engineB = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-b",
      rootPath: rootB,
      localStoreDir: path.join(root, "store-b"),
    });
    engineA.unlockAndVerify("shared-secret-password");
    engineB.unlockAndVerify("shared-secret-password");

    engineA.setSelectiveSync({ includeImages: false });
    const push = engineA.pushLocalChanges();
    expect(push.uploaded).toBe(1);

    engineB.setSelectiveSync({ includeImages: true });
    engineB.pullRemoteChanges();
    expect(fs.existsSync(path.join(rootB, "note.md"))).toBe(true);
    expect(fs.existsSync(path.join(rootB, "photo.png"))).toBe(false);

    // Device B with images enabled still won't see photo — it was never uploaded.
    // Re-enable images on A and push again.
    engineA.setSelectiveSync({ includeImages: true });
    const push2 = engineA.pushLocalChanges();
    expect(push2.uploaded).toBeGreaterThanOrEqual(1);
    engineB.pullRemoteChanges();
    expect(fs.existsSync(path.join(rootB, "photo.png"))).toBe(true);

    // Device B can refuse to pull images even when they exist remotely.
    fs.rmSync(path.join(rootB, "photo.png"));
    engineB.setSelectiveSync({ includeImages: false });
    engineB.pullRemoteChanges();
    expect(fs.existsSync(path.join(rootB, "photo.png"))).toBe(false);
    expect(fs.existsSync(path.join(rootB, "note.md"))).toBe(true);
  });

  it("revokes a device and blocks further sync while peer stays active", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "shared-secret-password",
      deviceId: "device-a",
    });
    plane.registerDevice({
      vaultId: created.vaultId,
      deviceId: "device-b",
      platform: "desktop",
    });
    const rootA = path.join(root, "a");
    const rootB = path.join(root, "b");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    fs.writeFileSync(path.join(rootA, "note.md"), "v1\n");

    const engineA = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-a",
      rootPath: rootA,
      localStoreDir: path.join(root, "store-a"),
    });
    const engineB = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-b",
      rootPath: rootB,
      localStoreDir: path.join(root, "store-b"),
    });
    engineA.unlockAndVerify("shared-secret-password");
    engineB.unlockAndVerify("shared-secret-password");
    engineA.pushLocalChanges();
    engineB.pullRemoteChanges();
    expect(fs.readFileSync(path.join(rootB, "note.md"), "utf8")).toBe("v1\n");

    const revoked = plane.revokeDevice(created.vaultId, "device-b");
    expect(revoked.status).toBe("revoked");
    expect(plane.listDevices(created.vaultId).filter((d) => d.status === "active")).toHaveLength(1);
    expect(
      plane.listAuditEvents(created.vaultId).some((e) => e.eventType === "device_revoked"),
    ).toBe(true);

    expect(() => engineB.pushLocalChanges()).toThrow(/device revoked/);
    expect(engineB.status).toBe("revoked");
    expect(() =>
      new DeviceSyncEngine({
        controlPlane: plane,
        vaultId: created.vaultId,
        deviceId: "device-b",
        rootPath: rootB,
        localStoreDir: path.join(root, "store-b2"),
      }).unlockAndVerify("shared-secret-password"),
    ).toThrow(/device revoked/);

    // Stolen device local files remain; peer A can still sync.
    expect(fs.readFileSync(path.join(rootB, "note.md"), "utf8")).toBe("v1\n");
    fs.writeFileSync(path.join(rootA, "note.md"), "v2\n");
    expect(engineA.pushLocalChanges().uploaded).toBeGreaterThanOrEqual(1);
  });

  it("bumps encryptionVersion; old revisions stay readable; new commits use new epoch", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "shared-secret-password",
      deviceId: "device-a",
    });
    plane.registerDevice({
      vaultId: created.vaultId,
      deviceId: "device-b",
      platform: "desktop",
    });
    const rootA = path.join(root, "a");
    const rootB = path.join(root, "b");
    fs.mkdirSync(rootA, { recursive: true });
    fs.mkdirSync(rootB, { recursive: true });
    fs.writeFileSync(path.join(rootA, "old.md"), "epoch-1\n");

    const engineA = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-a",
      rootPath: rootA,
      localStoreDir: path.join(root, "store-a"),
    });
    const engineB = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-b",
      rootPath: rootB,
      localStoreDir: path.join(root, "store-b"),
    });
    engineA.unlockAndVerify("shared-secret-password");
    engineB.unlockAndVerify("shared-secret-password");
    engineA.pushLocalChanges();
    const before = plane.getVault(created.vaultId)!;
    expect(before.encryptionVersion).toBe(1);

    const bumped = plane.bumpEncryptionVersion(created.vaultId, { expectedCurrent: 1 });
    expect(bumped.encryptionVersion).toBe(2);
    expect(() => plane.bumpEncryptionVersion(created.vaultId, { expectedCurrent: 1 })).toThrow(
      /encryption version conflict/,
    );

    // Peer can still pull the v1 revision after the bump.
    engineB.pullRemoteChanges();
    expect(fs.readFileSync(path.join(rootB, "old.md"), "utf8")).toBe("epoch-1\n");

    fs.writeFileSync(path.join(rootA, "new.md"), "epoch-2\n");
    const push = engineA.pushLocalChanges();
    expect(push.uploaded).toBeGreaterThanOrEqual(1);
    const allRevs = plane.listRevisionsSince(created.vaultId, null, 100).revisions;
    expect(allRevs.some((r) => r.encryptionVersion === 1)).toBe(true);
    expect(allRevs.some((r) => r.encryptionVersion === 2)).toBe(true);

    engineB.pullRemoteChanges();
    expect(fs.readFileSync(path.join(rootB, "new.md"), "utf8")).toBe("epoch-2\n");
  });
});

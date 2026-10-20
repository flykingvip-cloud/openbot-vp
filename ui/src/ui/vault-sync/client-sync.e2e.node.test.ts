/**
 * Dual-device browser-client E2E (Node/fs stand-in for Chromium FSA).
 * Acceptance scaffold: create → sync A→B → conflict copy path → >1MiB HTTP chunks.
 * Does NOT claim full Chromium UI acceptance.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VaultSyncControlPlane } from "../../../../src/vault-sync/store/control-plane.ts";
import { DIRECT_PUT_MAX_BYTES } from "./client-crypto.ts";
import { createNodeVaultLocalFs } from "./client-local-fs.ts";
import type { FileRevisionWire, VaultSyncClientGateway } from "./client-sync-types.ts";
import { runClientVaultSync } from "./client-sync.ts";

const tmpDirs: string[] = [];
const password = "correct horse battery staple";

function tmpDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vault-client-e2e-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

function createStorageMock() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    get length() {
      return map.size;
    },
  };
}

function toWire(rev: {
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
  parentRevisionIds: string[];
  deviceId: string;
  deviceSequence: number;
  encryptedMetadataB64: string;
  ciphertextBlobId: string | null;
  plaintextSize: number;
  ciphertextHash: string;
  tombstone: boolean;
  createdAt: string;
  protocolVersion: number;
  encryptionVersion: number;
  conflictGroupId?: string | null;
}): FileRevisionWire {
  return { ...rev, conflictGroupId: rev.conflictGroupId ?? null };
}

function createPlaneGateway(plane: VaultSyncControlPlane): VaultSyncClientGateway {
  return {
    vaultSyncStatus: async ({ vaultId }) => {
      const vault = plane.getVault(vaultId);
      if (!vault) {
        throw new Error("vault not found");
      }
      return {
        saltB64: vault.saltB64,
        encryptionVersion: vault.encryptionVersion,
        kdfParams: vault.kdfParams,
      };
    },
    listVaultSyncDevices: async ({ vaultId }) => ({
      devices: plane.listDevices(vaultId).map((d) => ({
        deviceId: d.deviceId,
        lastSequence: d.lastSequence,
        status: d.status,
      })),
    }),
    vaultSyncInventory: async ({ vaultId, cursor, limit }) =>
      plane.getInventoryPage(vaultId, cursor ?? null, limit ?? 500),
    putVaultSyncBlob: async ({ vaultId, deviceId, ciphertextHash, contentBase64 }) => {
      const blob = plane.putBlob({
        vaultId,
        deviceId,
        ciphertextHash,
        ciphertext: Buffer.from(contentBase64, "base64"),
      });
      return { blobId: blob.blobId };
    },
    getVaultSyncBlob: async ({ vaultId, blobId }) => {
      const data = plane.getBlob(vaultId, blobId);
      if (!data) {
        return {};
      }
      return { contentBase64: data.toString("base64") };
    },
    commitVaultSyncRevision: async ({ revision, idempotencyKey }) => {
      const result = plane.commitRevision({
        revision: {
          ...revision,
          ciphertextBlobId: revision.ciphertextBlobId,
          conflictGroupId: revision.conflictGroupId ?? null,
        },
        idempotencyKey,
      });
      return { result };
    },
    listVaultSyncRevisionsSince: async ({ vaultId, cursor, limit }) => {
      const page = plane.listRevisionsSince(vaultId, cursor ?? null, limit ?? 100);
      return {
        revisions: page.revisions.map(toWire),
        nextCursor: page.nextCursor,
      };
    },
    createVaultSyncUploadSession: async ({
      vaultId,
      deviceId,
      ciphertextHash,
      totalSizeBytes,
      chunkSize,
    }) => {
      const session = plane.createUploadSession({
        vaultId,
        deviceId,
        ciphertextHash,
        totalSizeBytes,
        chunkSize,
      });
      return {
        session: {
          uploadId: session.uploadId,
          vaultId: session.vaultId,
          deviceId: session.deviceId,
          ciphertextHash: session.ciphertextHash,
          totalSizeBytes: session.totalSizeBytes,
          chunkSize: session.chunkSize,
          chunkCount: session.chunkCount,
          receivedChunkIndexes: session.receivedChunkIndexes,
          status: session.status,
        },
      };
    },
    putVaultSyncUploadChunk: async ({ vaultId, uploadId, chunkIndex, contentBase64 }) => {
      const session = plane.putUploadChunk({
        vaultId,
        uploadId,
        chunkIndex,
        data: Buffer.from(contentBase64, "base64"),
      });
      return {
        session: {
          status: session.status,
          receivedChunkIndexes: session.receivedChunkIndexes,
        },
      };
    },
    completeVaultSyncUploadSession: async ({ vaultId, uploadId }) => {
      const blob = plane.completeUploadSession({ vaultId, uploadId });
      return { blobId: blob.blobId };
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorageMock());
});

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
});

describe("client-sync dual-device E2E (acceptance scaffold)", () => {
  it("syncs encrypted note from device A to device B without plaintext on plane", async () => {
    const planeRoot = tmpDir("plane");
    const dirA = tmpDir("a");
    const dirB = tmpDir("b");
    const plane = new VaultSyncControlPlane(planeRoot);
    const saltB64 = Buffer.from("0123456789abcdef").toString("base64");
    const vault = plane.createVault({
      ownerAccountId: "owner@test",
      saltB64,
    });
    plane.registerDevice({ vaultId: vault.vaultId, deviceId: "device-a", platform: "test" });
    plane.registerDevice({ vaultId: vault.vaultId, deviceId: "device-b", platform: "test" });

    fs.mkdirSync(path.join(dirA, "notes"), { recursive: true });
    fs.writeFileSync(path.join(dirA, "notes", "hello.md"), "# hello from A\n");

    const gateway = createPlaneGateway(plane);
    const pushA = await runClientVaultSync({
      gateway,
      vaultId: vault.vaultId,
      deviceId: "device-a",
      password,
      localFs: createNodeVaultLocalFs(dirA),
    });
    expect(pushA.push.uploaded).toBe(1);
    expect(pushA.push.errors).toEqual([]);

    // Plane must not store plaintext path/content.
    const raw = JSON.stringify(
      fs.readFileSync(path.join(planeRoot, "vaults", vault.vaultId, "revisions.json"), "utf8"),
    );
    expect(raw.includes("notes/hello.md")).toBe(false);
    expect(raw.includes("# hello from A")).toBe(false);

    const pullB = await runClientVaultSync({
      gateway,
      vaultId: vault.vaultId,
      deviceId: "device-b",
      password,
      localFs: createNodeVaultLocalFs(dirB),
    });
    expect(pullB.pull.applied).toBeGreaterThanOrEqual(1);
    expect(fs.readFileSync(path.join(dirB, "notes", "hello.md"), "utf8")).toBe("# hello from A\n");
  });

  it("uploads >1MiB ciphertext via HTTP chunk path (not WS Base64)", async () => {
    const planeRoot = tmpDir("plane-large");
    const dirA = tmpDir("a-large");
    const plane = new VaultSyncControlPlane(planeRoot);
    const vault = plane.createVault({
      ownerAccountId: "owner@test",
      saltB64: Buffer.from("fedcba9876543210").toString("base64"),
    });
    plane.registerDevice({ vaultId: vault.vaultId, deviceId: "device-a", platform: "test" });

    const big = Buffer.alloc(DIRECT_PUT_MAX_BYTES + 4096, 9);
    fs.writeFileSync(path.join(dirA, "big.bin"), big);

    const gateway = createPlaneGateway(plane);
    const wsSpy = vi.spyOn(gateway, "putVaultSyncUploadChunk");

    const result = await runClientVaultSync({
      gateway,
      vaultId: vault.vaultId,
      deviceId: "device-a",
      password,
      localFs: createNodeVaultLocalFs(dirA),
    });
    expect(result.push.uploaded).toBe(1);
    expect(result.push.errors).toEqual([]);
    expect(wsSpy).toHaveBeenCalled();

    const inventory = plane.getInventoryPage(vault.vaultId, null, 10);
    expect(inventory.items.length).toBe(1);
    const revPage = plane.listRevisionsSince(vault.vaultId, null, 10);
    const blobId = revPage.revisions[0]?.ciphertextBlobId;
    expect(blobId).toBeTruthy();
    const blob = plane.getBlob(vault.vaultId, blobId!);
    expect(blob).toBeTruthy();
    expect(blob!.length).toBeGreaterThan(DIRECT_PUT_MAX_BYTES);
    // Ciphertext hash on revision must match stored blob.
    const hash = createHash("sha256").update(blob!).digest("hex");
    expect(revPage.revisions[0]?.ciphertextHash).toBe(hash);
  });
});

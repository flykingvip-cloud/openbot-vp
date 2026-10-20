/**
 * Chromium restore E2E (Wave R).
 * Tombstone → restoreClientVaultRevision → local file + new commit.
 * Does NOT claim manual Knowledge Universe history UI acceptance.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bytesToBase64, sha256Hex, utf8Encode } from "./bytes.ts";
import { computeRevisionId } from "./client-crypto.ts";
import { createMemoryVaultDirectory } from "./client-fsa-memory.ts";
import { restoreClientVaultRevision } from "./client-restore.ts";
import { createMemoryPlaneGateway, MemoryVaultSyncPlane } from "./client-sync-memory-plane.ts";
import type { FileRevisionWire, VaultSyncClientGateway } from "./client-sync-types.ts";
import { runClientVaultSync } from "./client-sync.ts";

const password = "restore-test-passphrase";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

async function commitTombstoneRevision(params: {
  gateway: VaultSyncClientGateway;
  contentRev: FileRevisionWire;
  deviceId: string;
  deviceSequence: number;
}): Promise<FileRevisionWire> {
  const ciphertextHash = await sha256Hex(utf8Encode("tombstone"));
  const revisionId = await computeRevisionId({
    vaultId: params.contentRev.vaultId,
    opaquePathId: params.contentRev.opaquePathId,
    deviceId: params.deviceId,
    deviceSequence: params.deviceSequence,
    ciphertextHash,
    parentRevisionIds: [params.contentRev.revisionId],
  });
  const tombstone: FileRevisionWire = {
    vaultId: params.contentRev.vaultId,
    opaquePathId: params.contentRev.opaquePathId,
    revisionId,
    parentRevisionIds: [params.contentRev.revisionId],
    deviceId: params.deviceId,
    deviceSequence: params.deviceSequence,
    encryptedMetadataB64: params.contentRev.encryptedMetadataB64,
    ciphertextBlobId: null,
    plaintextSize: 0,
    ciphertextHash,
    tombstone: true,
    createdAt: new Date().toISOString(),
    protocolVersion: params.contentRev.protocolVersion,
    encryptionVersion: params.contentRev.encryptionVersion,
  };
  const committed = await params.gateway.commitVaultSyncRevision({
    revision: tombstone,
    idempotencyKey: `${params.deviceId}:${params.deviceSequence}`,
  });
  expect(committed.result?.status).toBe("accepted");
  return tombstone;
}

describe("client-restore Chromium E2E (Wave R scaffold)", () => {
  it("restores deleted (tombstone) revision to local FSA and commits anew", async () => {
    const plane = new MemoryVaultSyncPlane();
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const vault = plane.createVault({
      ownerAccountId: "owner@test",
      saltB64: bytesToBase64(salt),
    });
    plane.registerDevice({ vaultId: vault.vaultId, deviceId: "device-a" });

    const dir = createMemoryVaultDirectory("restore-a");
    dir.seedFile("archive/deleted.md", "# restore me\n");

    const gateway = createMemoryPlaneGateway(plane);
    const synced = await runClientVaultSync({
      gateway,
      vaultId: vault.vaultId,
      deviceId: "device-a",
      password,
      directory: dir.asDirectoryHandle(),
    });
    expect(synced.push.uploaded).toBe(1);

    const contentRev = plane.listRevisionsSince(vault.vaultId)[0];
    expect(contentRev).toBeTruthy();
    expect(contentRev?.tombstone).toBe(false);

    const tombstone = await commitTombstoneRevision({
      gateway,
      contentRev: contentRev,
      deviceId: "device-a",
      deviceSequence: 2,
    });

    const restored = await restoreClientVaultRevision({
      gateway,
      vaultId: vault.vaultId,
      deviceId: "device-a",
      password,
      directory: dir.asDirectoryHandle(),
      revisionId: tombstone.revisionId,
    });
    expect(restored.relativePath).toBe("archive/deleted.md");
    expect(restored.restoredFromRevisionId).toBe(contentRev.revisionId);
    expect(dir.readText("archive/deleted.md")).toBe("# restore me\n");

    const revisions = plane.listRevisionsSince(vault.vaultId);
    expect(revisions.length).toBeGreaterThanOrEqual(3);
    expect(revisions.some((row) => row.revisionId === restored.newRevisionId)).toBe(true);

    const wire = plane.wireLog.join("\n");
    expect(wire.includes("# restore me")).toBe(false);
    expect(wire.includes("archive/deleted.md")).toBe(false);
  });
});

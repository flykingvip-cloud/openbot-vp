/**
 * Chromium browser dual-device E2E (Wave K).
 * Uses in-memory FSA handles + Web Crypto in real Chromium (Playwright).
 * Does NOT claim manual UI acceptance (pick folder / Knowledge Universe form).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "./bytes.ts";
import { DIRECT_PUT_MAX_BYTES } from "./client-crypto.ts";
import { createMemoryVaultDirectory } from "./client-fsa-memory.ts";
import {
  ensureVaultDirectoryHandle,
  isFileSystemAccessSupported,
  pickVaultDirectoryHandle,
  walkVaultDirectory,
  writeVaultFile,
} from "./client-fsa.ts";
import { createMemoryPlaneGateway, MemoryVaultSyncPlane } from "./client-sync-memory-plane.ts";
import { runClientVaultSync } from "./client-sync.ts";

const password = "correct horse battery staple";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("client-sync Chromium FSA E2E (Wave K scaffold)", () => {
  it("exposes FSA picker via polyfill and walks/writes memory handles", async () => {
    const root = createMemoryVaultDirectory("picked");
    root.seedFile("notes/a.md", "alpha");
    vi.stubGlobal("showDirectoryPicker", async () => root.asDirectoryHandle());

    expect(isFileSystemAccessSupported()).toBe(true);
    const picked = await pickVaultDirectoryHandle();
    expect(picked).toBe(root.asDirectoryHandle());

    const walked = await walkVaultDirectory(picked);
    expect(walked.map((f) => f.relativePath)).toEqual(["notes/a.md"]);

    await writeVaultFile(picked, "notes/b.md", new TextEncoder().encode("beta"));
    expect(root.readText("notes/b.md")).toBe("beta");

    const ensured = await ensureVaultDirectoryHandle({
      vaultId: "v1",
      deviceId: "d1",
      existing: null,
    });
    expect(ensured).toBe(root.asDirectoryHandle());
  });

  it("syncs encrypted note A→B via memory FSA without plaintext on plane", async () => {
    const plane = new MemoryVaultSyncPlane();
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const vault = plane.createVault({
      ownerAccountId: "owner@test",
      saltB64: bytesToBase64(salt),
    });
    plane.registerDevice({ vaultId: vault.vaultId, deviceId: "device-a" });
    plane.registerDevice({ vaultId: vault.vaultId, deviceId: "device-b" });

    const dirA = createMemoryVaultDirectory("device-a");
    const dirB = createMemoryVaultDirectory("device-b");
    dirA.seedFile("notes/hello.md", "# hello from A\n");

    const gateway = createMemoryPlaneGateway(plane);
    const pushA = await runClientVaultSync({
      gateway,
      vaultId: vault.vaultId,
      deviceId: "device-a",
      password,
      directory: dirA.asDirectoryHandle(),
    });
    expect(pushA.push.uploaded).toBe(1);
    expect(pushA.push.errors).toEqual([]);

    const wire = plane.wireLog.join("\n");
    expect(wire.includes("notes/hello.md")).toBe(false);
    expect(wire.includes("# hello from A")).toBe(false);

    const pullB = await runClientVaultSync({
      gateway,
      vaultId: vault.vaultId,
      deviceId: "device-b",
      password,
      directory: dirB.asDirectoryHandle(),
    });
    expect(pullB.pull.applied).toBeGreaterThanOrEqual(1);
    expect(dirB.readText("notes/hello.md")).toBe("# hello from A\n");
  });

  it("uploads >1MiB ciphertext via HTTP chunk path in Chromium", async () => {
    const plane = new MemoryVaultSyncPlane();
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const vault = plane.createVault({
      ownerAccountId: "owner@test",
      saltB64: bytesToBase64(salt),
    });
    plane.registerDevice({ vaultId: vault.vaultId, deviceId: "device-a" });

    const dirA = createMemoryVaultDirectory("device-a-large");
    const big = new Uint8Array(DIRECT_PUT_MAX_BYTES + 4096);
    big.fill(9);
    dirA.seedFile("big.bin", big);

    const gateway = createMemoryPlaneGateway(plane);
    const wsSpy = vi.spyOn(gateway, "putVaultSyncUploadChunk");

    const result = await runClientVaultSync({
      gateway,
      vaultId: vault.vaultId,
      deviceId: "device-a",
      password,
      directory: dirA.asDirectoryHandle(),
    });
    expect(result.push.uploaded).toBe(1);
    expect(result.push.errors).toEqual([]);
    expect(wsSpy).toHaveBeenCalled();

    const revs = plane.listRevisionsSince(vault.vaultId);
    expect(revs).toHaveLength(1);
    const blobId = revs[0]?.ciphertextBlobId;
    expect(blobId).toBeTruthy();
    const blob = plane.getBlob(vault.vaultId, blobId!);
    expect(blob).toBeTruthy();
    expect(blob!.length).toBeGreaterThan(DIRECT_PUT_MAX_BYTES);
  });
});

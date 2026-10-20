import { describe, expect, it } from "vitest";
import { resolveRestorableContentRevision } from "./client-restore.ts";
import type { FileRevisionWire } from "./client-sync-types.ts";

function rev(
  partial: Partial<FileRevisionWire> & Pick<FileRevisionWire, "revisionId">,
): FileRevisionWire {
  const { revisionId, ...rest } = partial;
  return {
    vaultId: "vault-1",
    opaquePathId: "path-1",
    revisionId,
    parentRevisionIds: [],
    deviceId: "device-a",
    deviceSequence: 1,
    encryptedMetadataB64: "meta",
    ciphertextBlobId: "blob-1",
    plaintextSize: 10,
    ciphertextHash: "abc",
    tombstone: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    protocolVersion: 1,
    encryptionVersion: 1,
    ...rest,
  };
}

describe("resolveRestorableContentRevision", () => {
  it("returns target when it has content", () => {
    const target = rev({ revisionId: "r2" });
    expect(resolveRestorableContentRevision(target, [rev({ revisionId: "r1" }), target])).toBe(
      target,
    );
  });

  it("walks back from tombstone to nearest content revision", () => {
    const r1 = rev({ revisionId: "r1", ciphertextBlobId: "blob-1" });
    const tombstone = rev({ revisionId: "r2", tombstone: true, ciphertextBlobId: null });
    const picked = resolveRestorableContentRevision(tombstone, [r1, tombstone]);
    expect(picked?.revisionId).toBe("r1");
  });

  it("returns null when no content exists", () => {
    const tombstone = rev({ revisionId: "r1", tombstone: true, ciphertextBlobId: null });
    expect(resolveRestorableContentRevision(tombstone, [tombstone])).toBeNull();
  });
});

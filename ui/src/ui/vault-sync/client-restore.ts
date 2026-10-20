import { utf8Decode } from "./bytes.ts";
/**
 * Browser client-side vault revision restore (R1).
 */
import {
  loadClientInventoryBaseline,
  saveClientInventoryBaseline,
  upsertClientBaselineEntry,
} from "./client-baseline.ts";
import {
  buildContentAad,
  ciphertextFromBase64,
  decryptAead,
  unlockVaultKeys,
  type VaultKeySet,
} from "./client-crypto.ts";
import { writeVaultFile } from "./client-fsa.ts";
import type {
  FileRevisionWire,
  PlaintextFileMetadata,
  VaultSyncClientGateway,
} from "./client-sync-types.ts";
import { commitPlaintextVaultFile } from "./client-sync.ts";

export function resolveRestorableContentRevision(
  target: FileRevisionWire,
  history: FileRevisionWire[],
): FileRevisionWire | null {
  if (!target.tombstone && target.ciphertextBlobId) {
    return target;
  }
  const idx = history.findIndex((row) => row.revisionId === target.revisionId);
  const window = idx >= 0 ? history.slice(0, idx + 1) : history;
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const rev = window[i];
    if (!rev.tombstone && rev.ciphertextBlobId) {
      return rev;
    }
  }
  return null;
}

export async function decryptRevisionContent(params: {
  rev: FileRevisionWire;
  keys: VaultKeySet;
  gateway: VaultSyncClientGateway;
}): Promise<{ meta: PlaintextFileMetadata; plaintext: Uint8Array }> {
  if (!params.rev.ciphertextBlobId) {
    throw new Error("no restorable content revision");
  }
  const metaPlain = await decryptAead({
    key: params.keys.metadataKey,
    ciphertext: ciphertextFromBase64(params.rev.encryptedMetadataB64),
    vaultId: params.rev.vaultId,
    opaquePathId: params.rev.opaquePathId,
    revisionId: params.rev.revisionId,
    encryptionVersion: params.rev.encryptionVersion,
  });
  const meta = JSON.parse(utf8Decode(metaPlain)) as PlaintextFileMetadata;
  const blob = await params.gateway.getVaultSyncBlob({
    vaultId: params.rev.vaultId,
    blobId: params.rev.ciphertextBlobId,
  });
  if (!blob.contentBase64) {
    throw new Error("blob missing");
  }
  const ciphertext = ciphertextFromBase64(blob.contentBase64);
  const contentAad = buildContentAad({
    vaultId: params.rev.vaultId,
    opaquePathId: params.rev.opaquePathId,
    deviceId: params.rev.deviceId,
    deviceSequence: params.rev.deviceSequence,
    encryptionVersion: params.rev.encryptionVersion,
  });
  const plaintext = await decryptAead({
    key: params.keys.contentKey,
    ciphertext,
    vaultId: params.rev.vaultId,
    opaquePathId: params.rev.opaquePathId,
    revisionId: "content",
    encryptionVersion: params.rev.encryptionVersion,
    aad: contentAad,
  });
  return { meta, plaintext };
}

async function resolveDeviceSequence(
  gateway: VaultSyncClientGateway,
  vaultId: string,
  deviceId: string,
): Promise<number> {
  const devices = await gateway.listVaultSyncDevices({ vaultId });
  const row = devices.devices?.find((d) => d.deviceId === deviceId);
  return row?.lastSequence ?? 0;
}

export async function restoreClientVaultRevision(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  deviceId: string;
  password: string;
  directory: FileSystemDirectoryHandle;
  revisionId: string;
}): Promise<{
  relativePath: string;
  restoredFromRevisionId: string;
  newRevisionId: string;
  status: string;
}> {
  if (!params.gateway.getVaultSyncRevision || !params.gateway.listVaultSyncRevisionsForPath) {
    throw new Error("restore RPC unavailable");
  }
  const status = await params.gateway.vaultSyncStatus({ vaultId: params.vaultId });
  if (!status.saltB64) {
    throw new Error("vault salt unavailable");
  }
  const keys = await unlockVaultKeys({
    password: params.password,
    saltB64: status.saltB64,
    kdf: status.kdfParams,
    encryptionVersion: status.encryptionVersion ?? 1,
  });
  const targetResult = await params.gateway.getVaultSyncRevision({
    vaultId: params.vaultId,
    revisionId: params.revisionId,
  });
  const target = targetResult.revision;
  if (!target) {
    throw new Error("revision not found");
  }
  const historyResult = await params.gateway.listVaultSyncRevisionsForPath({
    vaultId: params.vaultId,
    opaquePathId: target.opaquePathId,
  });
  const history = historyResult.revisions ?? [];
  const contentRevision = resolveRestorableContentRevision(target, history);
  if (!contentRevision) {
    throw new Error("no restorable content revision");
  }
  const { meta, plaintext } = await decryptRevisionContent({
    rev: contentRevision,
    keys,
    gateway: params.gateway,
  });
  await writeVaultFile(params.directory, meta.relativePath, plaintext);
  let deviceSequence = await resolveDeviceSequence(params.gateway, params.vaultId, params.deviceId);
  deviceSequence += 1;
  const commit = await commitPlaintextVaultFile({
    gateway: params.gateway,
    keys,
    vaultId: params.vaultId,
    deviceId: params.deviceId,
    deviceSequence,
    encryptionVersion: status.encryptionVersion ?? 1,
    relativePath: meta.relativePath,
    fileName: meta.fileName,
    mtimeMs: meta.mtimeMs ?? Date.now(),
    plaintext,
  });
  if (commit.status === "rejected") {
    throw new Error("restore commit rejected");
  }
  const baseline = loadClientInventoryBaseline(params.vaultId, params.deviceId);
  upsertClientBaselineEntry(baseline, {
    relativePath: meta.relativePath,
    sizeBytes: plaintext.length,
    mtimeMs: meta.mtimeMs ?? Date.now(),
    lastRevisionId: commit.revisionId,
  });
  saveClientInventoryBaseline(baseline);
  return {
    relativePath: meta.relativePath,
    restoredFromRevisionId: contentRevision.revisionId,
    newRevisionId: commit.revisionId,
    status: commit.status === "conflict" ? "conflict" : "idle_synced",
  };
}

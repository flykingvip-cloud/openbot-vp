import { utf8Decode, utf8Encode } from "./bytes.ts";
/**
 * Browser client-side Vault Sync engine (R1): encrypt locally, ship ciphertext only.
 */
import {
  baselineEntryChanged,
  loadClientInventoryBaseline,
  removeClientBaselineEntry,
  saveClientInventoryBaseline,
  upsertClientBaselineEntry,
} from "./client-baseline.ts";
import { storeCiphertextBlob } from "./client-blob-upload.ts";
import {
  buildContentAad,
  ciphertextFromBase64,
  ciphertextToBase64,
  computeOpaquePathId,
  computeRevisionId,
  decryptAead,
  encryptAead,
  hashCiphertext,
  unlockVaultKeys,
  VAULT_SYNC_PROTOCOL_VERSION,
  type VaultKeySet,
} from "./client-crypto.ts";
import { guessMime, shouldSyncPath } from "./client-excludes.ts";
import {
  ensureVaultDirectoryHandle,
  rememberVaultDirectoryHandle,
  vaultDirectoryKey,
  walkVaultDirectory,
  writeVaultFile,
  type WalkedVaultFile,
} from "./client-fsa.ts";
import { loadSealedBaseKey } from "./client-key-store.ts";
import type { VaultLocalFs } from "./client-local-fs.ts";
import type {
  ClientSyncPullResult,
  ClientSyncPushResult,
  FileRevisionWire,
  PlaintextFileMetadata,
  SelectiveSyncOptions,
  VaultSyncClientGateway,
} from "./client-sync-types.ts";

export type ClientVaultLocalSource = {
  /** Browser File System Access handle (production). */
  directory?: FileSystemDirectoryHandle;
  /** Node/fs stand-in for dual-device E2E (tests / non-browser). */
  localFs?: VaultLocalFs;
};

async function resolveWalkedFiles(source: ClientVaultLocalSource): Promise<WalkedVaultFile[]> {
  if (source.localFs) {
    return source.localFs.walk();
  }
  if (source.directory) {
    return walkVaultDirectory(source.directory);
  }
  throw new Error("directory or localFs required");
}

async function resolveWriteFile(
  source: ClientVaultLocalSource,
  relativePath: string,
  data: Uint8Array,
): Promise<void> {
  if (source.localFs) {
    await source.localFs.write(relativePath, data);
    return;
  }
  if (source.directory) {
    await writeVaultFile(source.directory, relativePath, data);
    return;
  }
  throw new Error("directory or localFs required");
}

const DEFAULT_SELECTIVE: SelectiveSyncOptions = {
  includeFolders: true,
  includeImages: true,
  includeAudio: true,
  includeVideo: true,
  includePdf: true,
  includeOtherAttachments: true,
  excludeGlobs: [],
};

async function resolveDeviceSequence(
  gateway: VaultSyncClientGateway,
  vaultId: string,
  deviceId: string,
): Promise<number> {
  const devices = await gateway.listVaultSyncDevices({ vaultId });
  const row = devices.devices?.find((d) => d.deviceId === deviceId);
  return row?.lastSequence ?? 0;
}

async function resolveParents(
  gateway: VaultSyncClientGateway,
  vaultId: string,
  opaquePathId: string,
): Promise<string[]> {
  const inv = await gateway.vaultSyncInventory({ vaultId, cursor: null, limit: 2000 });
  const item = inv.items?.find((i) => i.opaquePathId === opaquePathId);
  if (item?.heads?.length) {
    return [...item.heads];
  }
  return [];
}

async function unlockClientVaultKeys(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  password: string;
}): Promise<{ keys: VaultKeySet; encryptionVersion: number }> {
  const status = await params.gateway.vaultSyncStatus({ vaultId: params.vaultId });
  if (!status.saltB64) {
    throw new Error("vault salt unavailable");
  }
  const encryptionVersion = status.encryptionVersion ?? 1;
  const sealed = await loadSealedBaseKey({
    vaultId: params.vaultId,
    password: params.password,
    expectedEpoch: encryptionVersion,
  });
  const keys = await unlockVaultKeys({
    password: params.password,
    saltB64: status.saltB64,
    kdf: status.kdfParams,
    encryptionVersion,
    baseKey: sealed?.baseKey,
  });
  return { keys, encryptionVersion };
}

export async function runClientVaultSync(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  deviceId: string;
  password: string;
  directory?: FileSystemDirectoryHandle;
  localFs?: VaultLocalFs;
  selectiveSync?: SelectiveSyncOptions;
}): Promise<{ push: ClientSyncPushResult; pull: ClientSyncPullResult }> {
  if (params.directory) {
    rememberVaultDirectoryHandle(
      vaultDirectoryKey(params.vaultId, params.deviceId),
      params.directory,
    );
  }
  const push = await pushClientVaultChanges(params);
  const pull = await pullClientVaultChanges(params);
  return { push, pull };
}

export async function pushClientVaultChanges(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  deviceId: string;
  password: string;
  directory?: FileSystemDirectoryHandle;
  localFs?: VaultLocalFs;
  selectiveSync?: SelectiveSyncOptions;
}): Promise<ClientSyncPushResult> {
  const result: ClientSyncPushResult = {
    uploaded: 0,
    conflicts: 0,
    deleted: 0,
    errors: [],
    skipped: 0,
  };
  const selective = params.selectiveSync ?? DEFAULT_SELECTIVE;
  const { keys, encryptionVersion } = await unlockClientVaultKeys(params);
  let deviceSequence = await resolveDeviceSequence(params.gateway, params.vaultId, params.deviceId);
  const baseline = loadClientInventoryBaseline(params.vaultId, params.deviceId);
  const files = await resolveWalkedFiles(params);

  for (const entry of files) {
    if (!shouldSyncPath(entry.relativePath, selective)) {
      continue;
    }
    if (!baselineEntryChanged(baseline, entry.relativePath, entry.sizeBytes, entry.mtimeMs)) {
      result.skipped += 1;
      continue;
    }
    try {
      const plaintext = new Uint8Array(await entry.file.arrayBuffer());
      const commit = await commitPlaintextVaultFile({
        gateway: params.gateway,
        keys,
        vaultId: params.vaultId,
        deviceId: params.deviceId,
        deviceSequence: ++deviceSequence,
        encryptionVersion,
        relativePath: entry.relativePath,
        fileName: entry.fileName,
        mtimeMs: entry.mtimeMs,
        plaintext,
      });
      if (commit.status === "conflict") {
        result.conflicts += 1;
      } else {
        result.uploaded += 1;
        upsertClientBaselineEntry(baseline, {
          relativePath: entry.relativePath,
          sizeBytes: entry.sizeBytes,
          mtimeMs: entry.mtimeMs,
          lastRevisionId: commit.revisionId,
        });
      }
    } catch (error) {
      result.errors.push(
        `${entry.relativePath}: ${error instanceof Error ? error.message : "push failed"}`,
      );
    }
  }

  saveClientInventoryBaseline(baseline);
  return result;
}

async function commitPlaintextVaultFile(params: {
  gateway: VaultSyncClientGateway;
  keys: VaultKeySet;
  vaultId: string;
  deviceId: string;
  deviceSequence: number;
  encryptionVersion: number;
  relativePath: string;
  fileName: string;
  mtimeMs: number;
  plaintext: Uint8Array;
}): Promise<{ status: string; revisionId: string }> {
  const opaquePathId = await computeOpaquePathId(params.keys.pathLookupKey, params.relativePath);
  const parents = await resolveParents(params.gateway, params.vaultId, opaquePathId);
  const contentAad = buildContentAad({
    vaultId: params.vaultId,
    opaquePathId,
    deviceId: params.deviceId,
    deviceSequence: params.deviceSequence,
    encryptionVersion: params.encryptionVersion,
  });
  const body = await encryptAead({
    key: params.keys.contentKey,
    plaintext: params.plaintext,
    vaultId: params.vaultId,
    opaquePathId,
    revisionId: "content",
    encryptionVersion: params.encryptionVersion,
    aad: contentAad,
  });
  const bodyHash = await hashCiphertext(body);
  const revisionId = await computeRevisionId({
    vaultId: params.vaultId,
    opaquePathId,
    deviceId: params.deviceId,
    deviceSequence: params.deviceSequence,
    ciphertextHash: bodyHash,
    parentRevisionIds: parents,
  });
  const blob = await storeCiphertextBlob({
    gateway: params.gateway,
    vaultId: params.vaultId,
    deviceId: params.deviceId,
    ciphertext: body,
    ciphertextHash: bodyHash,
  });
  if (!blob.blobId) {
    throw new Error("blob upload rejected");
  }
  const meta: PlaintextFileMetadata = {
    relativePath: params.relativePath,
    fileName: params.fileName,
    mimeType: guessMime(params.fileName),
    mtimeMs: params.mtimeMs,
  };
  const metaEnc = await encryptAead({
    key: params.keys.metadataKey,
    plaintext: utf8Encode(JSON.stringify(meta)),
    vaultId: params.vaultId,
    opaquePathId,
    revisionId,
    encryptionVersion: params.encryptionVersion,
  });
  const revision: FileRevisionWire = {
    vaultId: params.vaultId,
    opaquePathId,
    revisionId,
    parentRevisionIds: parents,
    deviceId: params.deviceId,
    deviceSequence: params.deviceSequence,
    encryptedMetadataB64: ciphertextToBase64(metaEnc),
    ciphertextBlobId: blob.blobId,
    plaintextSize: params.plaintext.length,
    ciphertextHash: bodyHash,
    tombstone: false,
    createdAt: new Date().toISOString(),
    protocolVersion: VAULT_SYNC_PROTOCOL_VERSION,
    encryptionVersion: params.encryptionVersion,
  };
  const committed = await params.gateway.commitVaultSyncRevision({
    revision,
    idempotencyKey: `${params.deviceId}:${params.deviceSequence}`,
  });
  return {
    status: committed.result?.status ?? "rejected",
    revisionId,
  };
}

export async function pullClientVaultChanges(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  deviceId: string;
  password: string;
  directory?: FileSystemDirectoryHandle;
  localFs?: VaultLocalFs;
}): Promise<ClientSyncPullResult> {
  const result: ClientSyncPullResult = {
    applied: 0,
    conflicts: 0,
    errors: [],
    touchedPaths: [],
  };
  const { keys } = await unlockClientVaultKeys(params);
  let cursor: string | undefined;
  for (;;) {
    const page = await params.gateway.listVaultSyncRevisionsSince({
      vaultId: params.vaultId,
      cursor,
      limit: 100,
    });
    for (const rev of page.revisions ?? []) {
      if (rev.deviceId === params.deviceId) {
        continue;
      }
      try {
        const applied = await applyRemoteRevision({
          rev,
          keys,
          source: params,
          gateway: params.gateway,
          localDeviceId: params.deviceId,
          vaultId: params.vaultId,
        });
        if (applied) {
          result.applied += 1;
          result.touchedPaths.push(applied);
        }
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : "pull failed");
      }
    }
    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  return result;
}

async function applyRemoteRevision(params: {
  rev: FileRevisionWire;
  keys: VaultKeySet;
  source: ClientVaultLocalSource;
  gateway: VaultSyncClientGateway;
  localDeviceId: string;
  vaultId: string;
}): Promise<string | null> {
  const metaPlain = await decryptAead({
    key: params.keys.metadataKey,
    ciphertext: ciphertextFromBase64(params.rev.encryptedMetadataB64),
    vaultId: params.rev.vaultId,
    opaquePathId: params.rev.opaquePathId,
    revisionId: params.rev.revisionId,
    encryptionVersion: params.rev.encryptionVersion,
  });
  const meta = JSON.parse(utf8Decode(metaPlain)) as PlaintextFileMetadata;
  if (params.rev.tombstone || !params.rev.ciphertextBlobId) {
    removeClientBaselineEntry(
      loadClientInventoryBaseline(params.vaultId, params.localDeviceId),
      meta.relativePath,
    );
    return meta.relativePath;
  }
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
  await resolveWriteFile(params.source, meta.relativePath, plaintext);
  return meta.relativePath;
}

export { commitPlaintextVaultFile };

export {
  ensureVaultDirectoryHandle,
  isFileSystemAccessSupported,
  pickVaultDirectoryHandle,
  rememberVaultDirectoryHandle,
  vaultDirectoryKey,
} from "./client-fsa.ts";

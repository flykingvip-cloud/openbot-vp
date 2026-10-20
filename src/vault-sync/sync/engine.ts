import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decryptAead, encryptAead, buildContentAad, hashCiphertext } from "../crypto/aead.js";
import { computeOpaquePathId, generateVaultSalt, unlockVaultKeys } from "../crypto/keys.js";
import { shouldSyncPath } from "../journal/excludes.js";
import {
  baselineEntryChanged,
  loadInventoryBaseline,
  removeBaselineEntry,
  saveInventoryBaseline,
  upsertBaselineEntry,
} from "../journal/inventory-baseline.js";
import { walkLocalInventoryAll } from "../journal/inventory.js";
import {
  appendJournalOp,
  clearOfflineJournal,
  loadOfflineJournal,
} from "../journal/offline-journal.js";
import { computeRevisionId } from "../revision-id.js";
import { notifyVaultSyncRuntimeReindex } from "../runtime-reindex.js";
import {
  loadSelectiveSync,
  normalizeSelectiveSync,
  saveSelectiveSync,
  type StoredSelectiveSync,
} from "../selective-sync-store.js";
import type { VaultSyncControlPlane } from "../store/control-plane.js";
import type {
  FileRevision,
  PlaintextFileMetadata,
  SelectiveSyncOptions,
  VaultConnectionStatus,
  VaultKeySet,
} from "../types.js";
import { VAULT_SYNC_PROTOCOL_VERSION } from "../types.js";
import { writeConflictCopies } from "./conflict.js";

export type DeviceSyncEngineOptions = {
  controlPlane: VaultSyncControlPlane;
  vaultId: string;
  deviceId: string;
  rootPath: string;
  /** Directory for offline journal + local cursor (device-local only). */
  localStoreDir: string;
  selectiveSync?: SelectiveSyncOptions;
};

export type SyncPushResult = {
  uploaded: number;
  conflicts: number;
  deleted: number;
  errors: string[];
};

export type SyncPullResult = {
  applied: number;
  conflicts: number;
  errors: string[];
  /** Relative paths written — caller may trigger Knowledge Runtime reindex. */
  touchedPaths: string[];
};

/**
 * Local-first device sync engine (P1).
 * Encrypts before upload; decrypts after download; never sends plaintext paths.
 */
export class DeviceSyncEngine {
  readonly options: DeviceSyncEngineOptions;
  private keys: VaultKeySet | null = null;
  private deviceSequence = 0;
  status: VaultConnectionStatus = "unconfigured";

  constructor(options: DeviceSyncEngineOptions) {
    this.options = options;
  }

  unlock(password: string): void {
    this.status = "unlocking";
    const vault = this.options.controlPlane.getVault(this.options.vaultId);
    if (!vault) {
      this.status = "error";
      throw new Error("vault not found");
    }
    try {
      const salt = Buffer.from(vault.saltB64, "base64");
      this.keys = unlockVaultKeys({
        password,
        salt,
        kdf: vault.kdfParams,
        encryptionVersion: vault.encryptionVersion,
      });
      const device = this.options.controlPlane.getDevice(
        this.options.vaultId,
        this.options.deviceId,
      );
      if (!device || device.status !== "active") {
        this.keys = null;
        this.status = "revoked";
        throw new Error("device revoked");
      }
      this.deviceSequence = device.lastSequence ?? 0;
      this.status = "idle_synced";
    } catch (error) {
      if (error instanceof Error && error.message === "device revoked") {
        throw error;
      }
      this.keys = null;
      if (error instanceof Error && error.message === "vault not found") {
        throw error;
      }
      this.status = "error_bad_password";
      throw new Error("invalid sync password", { cause: error });
    }
  }

  /**
   * Verify password by round-tripping a well-known probe under metadata key.
   * Stores probe revision on first unlock when missing.
   */
  unlockAndVerify(password: string): void {
    this.unlock(password);
    // Soft verify: encrypt/decrypt random probe with derived keys
    const keys = this.requireKeys();
    const probe = Buffer.from("openbot-vault-sync-probe", "utf8");
    const opaquePathId = computeOpaquePathId(keys.pathLookupKey, ".vault-sync/probe");
    const revisionId = "probe";
    const { ciphertext } = encryptAead({
      key: keys.metadataKey,
      plaintext: probe,
      vaultId: this.options.vaultId,
      opaquePathId,
      revisionId,
    });
    const plain = decryptAead({
      key: keys.metadataKey,
      ciphertext,
      vaultId: this.options.vaultId,
      opaquePathId,
      revisionId,
    });
    if (plain.toString("utf8") !== "openbot-vault-sync-probe") {
      this.keys = null;
      this.status = "error_bad_password";
      throw new Error("invalid sync password");
    }
  }

  private requireKeys(): VaultKeySet {
    if (!this.keys) {
      throw new Error("vault locked");
    }
    return this.keys;
  }

  private assertDeviceActive(): void {
    const device = this.options.controlPlane.getDevice(this.options.vaultId, this.options.deviceId);
    if (!device || device.status !== "active") {
      this.status = "revoked";
      throw new Error("device revoked");
    }
  }

  private currentEncryptionVersion(): number {
    const vault = this.options.controlPlane.getVault(this.options.vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    return vault.encryptionVersion;
  }

  /**
   * Store ciphertext: direct put under threshold; chunked upload session above it
   * (keeps large blobs off Gateway WS Base64 when sync runs on the control host).
   */
  private storeCiphertextBlob(ciphertext: Buffer, ciphertextHash: string) {
    const plane = this.options.controlPlane;
    if (ciphertext.length <= plane.getDirectPutMaxBytes()) {
      return plane.putBlob({
        vaultId: this.options.vaultId,
        deviceId: this.options.deviceId,
        ciphertext,
        ciphertextHash,
      });
    }
    const session = plane.createUploadSession({
      vaultId: this.options.vaultId,
      deviceId: this.options.deviceId,
      ciphertextHash,
      totalSizeBytes: ciphertext.length,
    });
    for (let i = 0; i < session.chunkCount; i++) {
      const start = i * session.chunkSize;
      const end = Math.min(start + session.chunkSize, ciphertext.length);
      plane.putUploadChunk({
        vaultId: this.options.vaultId,
        uploadId: session.uploadId,
        chunkIndex: i,
        data: ciphertext.subarray(start, end),
      });
    }
    return plane.completeUploadSession({
      vaultId: this.options.vaultId,
      uploadId: session.uploadId,
    });
  }

  private nextSequence(): number {
    this.deviceSequence += 1;
    return this.deviceSequence;
  }

  noteLocalChange(relativePath: string, op: "upsert" | "delete", sizeBytes = 0, mtimeMs = 0): void {
    const selective = this.getSelectiveSync();
    if (op === "upsert" && !shouldSyncPath(relativePath, selective)) {
      return;
    }
    appendJournalOp(this.options.localStoreDir, this.options.vaultId, this.options.deviceId, {
      op,
      relativePath,
      recordedAt: new Date().toISOString(),
      ...(op === "upsert" ? { mtimeMs, sizeBytes } : {}),
    } as never);
    if (this.status === "idle_synced") {
      this.status = "offline";
    }
  }

  getSelectiveSync(): StoredSelectiveSync {
    if (this.options.selectiveSync) {
      return normalizeSelectiveSync(this.options.selectiveSync);
    }
    return loadSelectiveSync(
      this.options.localStoreDir,
      this.options.vaultId,
      this.options.deviceId,
    );
  }

  setSelectiveSync(
    input?: Partial<SelectiveSyncOptions> & { excludeGlobs?: string[] },
  ): StoredSelectiveSync {
    const saved = saveSelectiveSync(
      this.options.localStoreDir,
      this.options.vaultId,
      this.options.deviceId,
      input,
    );
    this.options.selectiveSync = saved;
    return saved;
  }

  /** Push local journal + inventory deltas to control plane. */
  pushLocalChanges(): SyncPushResult {
    this.assertDeviceActive();
    const keys = this.requireKeys();
    this.status = "syncing";
    const selective = this.getSelectiveSync();
    const result: SyncPushResult = { uploaded: 0, conflicts: 0, deleted: 0, errors: [] };
    const journal = loadOfflineJournal(this.options.localStoreDir, this.options.vaultId);
    const baseline = loadInventoryBaseline(
      this.options.localStoreDir,
      this.options.vaultId,
      this.options.deviceId,
    );
    const ops =
      journal.ops.length > 0
        ? journal.ops
        : walkLocalInventoryAll({
            rootPath: this.options.rootPath,
            selectiveSync: selective,
          }).map(
            (e) =>
              ({
                op: "upsert" as const,
                relativePath: e.relativePath,
                mtimeMs: e.mtimeMs,
                sizeBytes: e.sizeBytes,
                recordedAt: new Date().toISOString(),
              }) as const,
          );

    for (const op of ops) {
      try {
        if (op.op === "upsert" && !shouldSyncPath(op.relativePath, selective)) {
          continue;
        }
        if (op.op === "delete") {
          this.commitTombstone(keys, op.relativePath);
          result.deleted += 1;
          continue;
        }
        const abs = path.join(this.options.rootPath, op.relativePath);
        if (!fs.existsSync(abs)) {
          this.commitTombstone(keys, op.relativePath);
          removeBaselineEntry(baseline, op.relativePath);
          result.deleted += 1;
          continue;
        }
        const stat = fs.statSync(abs);
        const mtimeMs = stat.mtimeMs;
        const sizeBytes = stat.size;
        if (
          journal.ops.length === 0 &&
          !baselineEntryChanged(baseline, op.relativePath, sizeBytes, mtimeMs)
        ) {
          continue;
        }
        const plaintext = fs.readFileSync(abs);
        const commit = this.commitUpsert(keys, op.relativePath, plaintext);
        if (commit.status === "conflict") {
          result.conflicts += 1;
        } else {
          result.uploaded += 1;
          upsertBaselineEntry(baseline, {
            relativePath: op.relativePath,
            sizeBytes,
            mtimeMs,
            lastRevisionId: commit.revisionId,
          });
        }
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : "push failed");
      }
    }

    clearOfflineJournal(this.options.localStoreDir, this.options.vaultId);
    saveInventoryBaseline(baseline, this.options.localStoreDir);
    this.status = result.conflicts > 0 ? "conflict" : "idle_synced";
    return result;
  }

  private commitUpsert(keys: VaultKeySet, relativePath: string, plaintext: Buffer) {
    const encVer = this.currentEncryptionVersion();
    const opaquePathId = computeOpaquePathId(keys.pathLookupKey, relativePath);
    const history = this.options.controlPlane.getPathHistory(this.options.vaultId, opaquePathId);
    const parents = this.currentParents(opaquePathId, history);
    const deviceSequence = this.nextSequence();
    const fileName = path.posix.basename(relativePath.replace(/\\/g, "/"));
    const meta: PlaintextFileMetadata = {
      relativePath,
      fileName,
      mimeType: guessMime(fileName),
      mtimeMs: Date.now(),
    };

    // Content AAD binds device sequence (not revisionId) so revisionId can hash ciphertext stably.
    const contentAad = buildContentAad({
      vaultId: this.options.vaultId,
      opaquePathId,
      deviceId: this.options.deviceId,
      deviceSequence,
      encryptionVersion: encVer,
    });
    const body = encryptAead({
      key: keys.contentKey,
      plaintext,
      vaultId: this.options.vaultId,
      opaquePathId,
      revisionId: "content", // ignored when aad override set
      encryptionVersion: encVer,
      aad: contentAad,
    });
    const bodyHash = hashCiphertext(body.ciphertext);
    const revisionId = computeRevisionId({
      vaultId: this.options.vaultId,
      opaquePathId,
      deviceId: this.options.deviceId,
      deviceSequence,
      ciphertextHash: bodyHash,
      parentRevisionIds: parents,
    });

    const blob = this.storeCiphertextBlob(body.ciphertext, bodyHash);

    const metaEnc = encryptAead({
      key: keys.metadataKey,
      plaintext: Buffer.from(JSON.stringify(meta), "utf8"),
      vaultId: this.options.vaultId,
      opaquePathId,
      revisionId,
      encryptionVersion: encVer,
    });

    const revision: FileRevision = {
      vaultId: this.options.vaultId,
      opaquePathId,
      revisionId,
      parentRevisionIds: parents,
      deviceId: this.options.deviceId,
      deviceSequence,
      encryptedMetadataB64: metaEnc.ciphertext.toString("base64"),
      ciphertextBlobId: blob.blobId,
      plaintextSize: plaintext.length,
      ciphertextHash: bodyHash,
      tombstone: false,
      createdAt: new Date().toISOString(),
      protocolVersion: VAULT_SYNC_PROTOCOL_VERSION,
      encryptionVersion: encVer,
    };

    const result = this.options.controlPlane.commitRevision({
      revision,
      idempotencyKey: `${this.options.deviceId}:${deviceSequence}`,
    });
    if (result.status === "rejected") {
      throw new Error(result.reason ?? "commit rejected");
    }
    return result;
  }

  private commitTombstone(keys: VaultKeySet, relativePath: string) {
    const encVer = this.currentEncryptionVersion();
    const opaquePathId = computeOpaquePathId(keys.pathLookupKey, relativePath);
    const history = this.options.controlPlane.getPathHistory(this.options.vaultId, opaquePathId);
    const parents = this.currentParents(opaquePathId, history);
    const deviceSequence = this.nextSequence();
    const ciphertextHash = createHash("sha256").update("tombstone").digest("hex");
    const revisionId = computeRevisionId({
      vaultId: this.options.vaultId,
      opaquePathId,
      deviceId: this.options.deviceId,
      deviceSequence,
      ciphertextHash,
      parentRevisionIds: parents,
    });
    const meta: PlaintextFileMetadata = {
      relativePath,
      fileName: path.posix.basename(relativePath),
    };
    const metaEnc = encryptAead({
      key: keys.metadataKey,
      plaintext: Buffer.from(JSON.stringify(meta), "utf8"),
      vaultId: this.options.vaultId,
      opaquePathId,
      revisionId,
      encryptionVersion: encVer,
    });
    const revision: FileRevision = {
      vaultId: this.options.vaultId,
      opaquePathId,
      revisionId,
      parentRevisionIds: parents,
      deviceId: this.options.deviceId,
      deviceSequence,
      encryptedMetadataB64: metaEnc.ciphertext.toString("base64"),
      ciphertextBlobId: null,
      plaintextSize: 0,
      ciphertextHash,
      tombstone: true,
      createdAt: new Date().toISOString(),
      protocolVersion: VAULT_SYNC_PROTOCOL_VERSION,
      encryptionVersion: encVer,
    };
    return this.options.controlPlane.commitRevision({
      revision,
      idempotencyKey: `${this.options.deviceId}:${deviceSequence}`,
    });
  }

  private currentParents(opaquePathId: string, history: FileRevision[]): string[] {
    const inv = this.options.controlPlane.getInventoryPage(this.options.vaultId, null, 2000);
    const item = inv.items.find((i) => i.opaquePathId === opaquePathId);
    if (item?.heads?.length) {
      return [...item.heads];
    }
    if (history.length === 0) {
      return [];
    }
    return [history[history.length - 1].revisionId];
  }

  /** Pull remote revisions and apply to local vault. */
  pullRemoteChanges(): SyncPullResult {
    this.assertDeviceActive();
    const keys = this.requireKeys();
    this.status = "syncing";
    const result: SyncPullResult = { applied: 0, conflicts: 0, errors: [], touchedPaths: [] };
    let cursor: string | null = null;
    for (;;) {
      const page = this.options.controlPlane.listRevisionsSince(this.options.vaultId, cursor, 100);
      for (const rev of page.revisions) {
        if (rev.deviceId === this.options.deviceId) {
          continue;
        }
        try {
          const applied = this.applyRemoteRevision(keys, rev);
          if (applied.conflict) {
            result.conflicts += 1;
          } else {
            result.applied += 1;
          }
          if (applied.path) {
            result.touchedPaths.push(applied.path);
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
    this.status = result.conflicts > 0 ? "conflict" : "idle_synced";
    if (result.touchedPaths.length > 0) {
      void notifyVaultSyncRuntimeReindex({
        rootPath: this.options.rootPath,
        touchedRelativePaths: result.touchedPaths,
        vaultId: this.options.vaultId,
      });
    }
    return result;
  }

  private applyRemoteRevision(
    keys: VaultKeySet,
    rev: FileRevision,
  ): { conflict: boolean; path: string | null } {
    let meta: PlaintextFileMetadata;
    try {
      const plaintext = decryptAead({
        key: keys.metadataKey,
        ciphertext: Buffer.from(rev.encryptedMetadataB64, "base64"),
        vaultId: rev.vaultId,
        opaquePathId: rev.opaquePathId,
        revisionId: rev.revisionId,
        encryptionVersion: rev.encryptionVersion,
      });
      meta = JSON.parse(plaintext.toString("utf8")) as PlaintextFileMetadata;
    } catch {
      throw new Error("decryption failed");
    }

    // Device-local selective sync: skip applying excluded categories/paths.
    if (!shouldSyncPath(meta.relativePath, this.getSelectiveSync())) {
      return { conflict: false, path: null };
    }

    const abs = path.join(this.options.rootPath, meta.relativePath);
    if (rev.tombstone) {
      if (fs.existsSync(abs)) {
        fs.unlinkSync(abs);
      }
      return { conflict: false, path: meta.relativePath };
    }

    if (!rev.ciphertextBlobId) {
      throw new Error("missing blob");
    }
    const blob = this.options.controlPlane.getBlob(rev.vaultId, rev.ciphertextBlobId);
    if (!blob) {
      throw new Error("blob missing");
    }
    let content: Buffer;
    try {
      content = decryptAead({
        key: keys.contentKey,
        ciphertext: blob,
        vaultId: rev.vaultId,
        opaquePathId: rev.opaquePathId,
        revisionId: rev.revisionId,
        encryptionVersion: rev.encryptionVersion,
        aad: buildContentAad({
          vaultId: rev.vaultId,
          opaquePathId: rev.opaquePathId,
          deviceId: rev.deviceId,
          deviceSequence: rev.deviceSequence,
          encryptionVersion: rev.encryptionVersion,
        }),
      });
    } catch {
      throw new Error("decryption failed");
    }

    if (fs.existsSync(abs)) {
      const local = fs.readFileSync(abs);
      if (Buffer.compare(local, content) === 0) {
        return { conflict: false, path: meta.relativePath };
      }
      // P1: without a stored common ancestor revision, never auto-merge divergent locals.
      writeConflictCopies({
        rootPath: this.options.rootPath,
        relativePath: meta.relativePath,
        leftContent: local,
        rightContent: content,
        leftDeviceId: this.options.deviceId,
        rightDeviceId: rev.deviceId,
      });
      return { conflict: true, path: meta.relativePath };
    }

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return { conflict: false, path: meta.relativePath };
  }

  /**
   * Path revision history (ciphertext metadata only).
   * Pass `relativePath` to resolve opaquePathId via PathLookupKey.
   */
  getPathHistory(params: { opaquePathId?: string; relativePath?: string }): FileRevision[] {
    const keys = this.requireKeys();
    const opaquePathId =
      params.opaquePathId?.trim() ||
      (params.relativePath ? computeOpaquePathId(keys.pathLookupKey, params.relativePath) : "");
    if (!opaquePathId) {
      throw new Error("opaquePathId or relativePath required");
    }
    return this.options.controlPlane.getPathHistory(this.options.vaultId, opaquePathId);
  }

  /**
   * Restore a historical (or pre-tombstone) revision onto the local vault and
   * commit a new non-tombstone revision so peers can pull the recovery.
   */
  restoreFromRevision(revisionId: string): {
    relativePath: string;
    restoredFromRevisionId: string;
    newRevisionId: string;
  } {
    this.assertDeviceActive();
    const keys = this.requireKeys();
    this.status = "syncing";
    const target = this.options.controlPlane.getRevision(this.options.vaultId, revisionId);
    if (!target) {
      this.status = "error";
      throw new Error("revision not found");
    }

    const history = this.options.controlPlane.getPathHistory(
      this.options.vaultId,
      target.opaquePathId,
    );
    const contentRevision = this.resolveRestorableContentRevision(target, history);
    if (!contentRevision) {
      this.status = "error";
      throw new Error("no restorable content revision");
    }

    const meta = this.decryptMetadata(keys, contentRevision);
    const content = this.decryptContent(keys, contentRevision);
    const abs = path.join(this.options.rootPath, meta.relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);

    const commit = this.commitUpsert(keys, meta.relativePath, content);
    if (commit.status === "rejected") {
      this.status = "error";
      throw new Error(commit.reason ?? "restore commit rejected");
    }
    this.status = commit.status === "conflict" ? "conflict" : "idle_synced";
    void notifyVaultSyncRuntimeReindex({
      rootPath: this.options.rootPath,
      touchedRelativePaths: [meta.relativePath],
      vaultId: this.options.vaultId,
    });
    return {
      relativePath: meta.relativePath,
      restoredFromRevisionId: contentRevision.revisionId,
      newRevisionId: commit.revisionId,
    };
  }

  private resolveRestorableContentRevision(
    target: FileRevision,
    history: FileRevision[],
  ): FileRevision | null {
    if (!target.tombstone && target.ciphertextBlobId) {
      return target;
    }
    // Walk history backwards from the target (inclusive) for the nearest content rev.
    const idx = history.findIndex((r) => r.revisionId === target.revisionId);
    const window = idx >= 0 ? history.slice(0, idx + 1) : history;
    for (let i = window.length - 1; i >= 0; i -= 1) {
      const rev = window[i];
      if (!rev.tombstone && rev.ciphertextBlobId) {
        return rev;
      }
    }
    return null;
  }

  private decryptMetadata(keys: VaultKeySet, rev: FileRevision): PlaintextFileMetadata {
    try {
      const plaintext = decryptAead({
        key: keys.metadataKey,
        ciphertext: Buffer.from(rev.encryptedMetadataB64, "base64"),
        vaultId: rev.vaultId,
        opaquePathId: rev.opaquePathId,
        revisionId: rev.revisionId,
        encryptionVersion: rev.encryptionVersion,
      });
      return JSON.parse(plaintext.toString("utf8")) as PlaintextFileMetadata;
    } catch {
      throw new Error("decryption failed");
    }
  }

  private decryptContent(keys: VaultKeySet, rev: FileRevision): Buffer {
    if (!rev.ciphertextBlobId) {
      throw new Error("missing blob");
    }
    const blob = this.options.controlPlane.getBlob(rev.vaultId, rev.ciphertextBlobId);
    if (!blob) {
      throw new Error("blob missing");
    }
    try {
      return decryptAead({
        key: keys.contentKey,
        ciphertext: blob,
        vaultId: rev.vaultId,
        opaquePathId: rev.opaquePathId,
        revisionId: rev.revisionId,
        encryptionVersion: rev.encryptionVersion,
        aad: buildContentAad({
          vaultId: rev.vaultId,
          opaquePathId: rev.opaquePathId,
          deviceId: rev.deviceId,
          deviceSequence: rev.deviceSequence,
          encryptionVersion: rev.encryptionVersion,
        }),
      });
    } catch {
      throw new Error("decryption failed");
    }
  }
}

function guessMime(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const map: Record<string, string> = {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return map[ext] ?? "application/octet-stream";
}

export function createVaultWithLocalDevice(params: {
  controlPlane: VaultSyncControlPlane;
  ownerAccountId: string;
  password: string;
  deviceId?: string;
  platform?: string;
}): { vaultId: string; deviceId: string; saltB64: string } {
  void params.password; // caller unlocks engine separately; salt is public
  const salt = generateVaultSalt();
  const vault = params.controlPlane.createVault({
    ownerAccountId: params.ownerAccountId,
    saltB64: salt.toString("base64"),
  });
  const deviceId = params.deviceId ?? randomUUID();
  params.controlPlane.registerDevice({
    vaultId: vault.vaultId,
    deviceId,
    platform: params.platform ?? "desktop",
  });
  return { vaultId: vault.vaultId, deviceId, saltB64: vault.saltB64 };
}

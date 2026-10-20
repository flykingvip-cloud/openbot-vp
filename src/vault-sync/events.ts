/**
 * Vault Sync revision notification sink (P2.1).
 * Control plane stays gateway-agnostic; Gateway registers a WS broadcast sink.
 *
 * Payload never includes plaintext paths, filenames, or ciphertext blobs —
 * clients must follow up with inventory / sync RPCs.
 */

export const VAULT_SYNC_REVISIONS_EVENT = "knowledge.vault-sync.revisions" as const;

export type VaultSyncRevisionsAvailablePayload = {
  /** Design §6.5 nested type discriminator. */
  type: "revisions_available";
  vaultId: string;
  /** Opaque cursor — currently the newest revisionId in this notification. */
  cursor: string;
  revisionIds: string[];
  opaquePathIds: string[];
  sourceDeviceId: string;
  serverReceivedAt: string;
  status: "accepted" | "conflict";
};

export type VaultSyncRevisionEventSink = (payload: VaultSyncRevisionsAvailablePayload) => void;

let eventSink: VaultSyncRevisionEventSink | null = null;

/** Debounce window so multi-file push coalesces into one WS frame. */
const COALESCE_MS = 40;

type PendingBucket = {
  vaultId: string;
  revisionIds: string[];
  opaquePathIds: string[];
  sourceDeviceId: string;
  serverReceivedAt: string;
  status: "accepted" | "conflict";
  timer: ReturnType<typeof setTimeout> | null;
};

const pendingByVault = new Map<string, PendingBucket>();

export function setVaultSyncRevisionEventSink(sink: VaultSyncRevisionEventSink | null): void {
  eventSink = sink;
  if (!sink) {
    for (const bucket of pendingByVault.values()) {
      if (bucket.timer) {
        clearTimeout(bucket.timer);
      }
    }
    pendingByVault.clear();
  }
}

function flushVault(vaultId: string): void {
  const bucket = pendingByVault.get(vaultId);
  if (!bucket) {
    return;
  }
  pendingByVault.delete(vaultId);
  if (bucket.timer) {
    clearTimeout(bucket.timer);
    bucket.timer = null;
  }
  if (!eventSink || bucket.revisionIds.length === 0) {
    return;
  }
  const cursor = bucket.revisionIds[bucket.revisionIds.length - 1];
  eventSink({
    type: "revisions_available",
    vaultId: bucket.vaultId,
    cursor,
    revisionIds: [...bucket.revisionIds],
    opaquePathIds: [...new Set(bucket.opaquePathIds)],
    sourceDeviceId: bucket.sourceDeviceId,
    serverReceivedAt: bucket.serverReceivedAt,
    status: bucket.status,
  });
}

/**
 * Notify connected clients that new ciphertext revisions are available.
 * No-op when no sink is registered (unit tests / offline control plane).
 */
export function notifyVaultSyncRevisionsAvailable(params: {
  vaultId: string;
  revisionId: string;
  opaquePathId: string;
  sourceDeviceId: string;
  serverReceivedAt: string;
  status: "accepted" | "conflict";
}): void {
  if (!eventSink) {
    return;
  }
  let bucket = pendingByVault.get(params.vaultId);
  if (!bucket) {
    bucket = {
      vaultId: params.vaultId,
      revisionIds: [],
      opaquePathIds: [],
      sourceDeviceId: params.sourceDeviceId,
      serverReceivedAt: params.serverReceivedAt,
      status: params.status,
      timer: null,
    };
    pendingByVault.set(params.vaultId, bucket);
  }
  if (!bucket.revisionIds.includes(params.revisionId)) {
    bucket.revisionIds.push(params.revisionId);
  }
  if (!bucket.opaquePathIds.includes(params.opaquePathId)) {
    bucket.opaquePathIds.push(params.opaquePathId);
  }
  bucket.sourceDeviceId = params.sourceDeviceId;
  bucket.serverReceivedAt = params.serverReceivedAt;
  if (params.status === "conflict") {
    bucket.status = "conflict";
  }
  if (bucket.timer) {
    clearTimeout(bucket.timer);
  }
  bucket.timer = setTimeout(() => {
    flushVault(params.vaultId);
  }, COALESCE_MS);
}

/** Test helper: flush pending coalesced notifications immediately. */
export function flushVaultSyncRevisionNotificationsForTest(): void {
  const vaultIds = Array.from(pendingByVault.keys());
  for (const vaultId of vaultIds) {
    flushVault(vaultId);
  }
}

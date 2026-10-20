/**
 * OpenBot Knowledge Vault Sync — protocol types (P1).
 * Syncs local Vault *files* only; never SQLite / embeddings / Runtime derivatives.
 * @see docs/design/openbot-knowledge-vault-sync-p0-2026-07-22.md
 */

export const VAULT_SYNC_PROTOCOL_VERSION = 1;
export const VAULT_SYNC_ENCRYPTION_VERSION = 1;

/** E2EE private sync vs enterprise-hosted (server may see plaintext / envelopes). */
export type VaultSyncMode = "e2ee_private" | "enterprise_hosted";

export type VaultConnectionStatus =
  | "unconfigured"
  | "unlocking"
  | "idle_synced"
  | "syncing"
  | "offline"
  | "conflict"
  | "error"
  | "paused"
  | "error_bad_password"
  | "revoked";

export type FileRevision = {
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
  parentRevisionIds: string[];
  deviceId: string;
  deviceSequence: number;
  /** Base64 of AEAD ciphertext for metadata (path, name, mime, mtime…). */
  encryptedMetadataB64: string;
  ciphertextBlobId: string | null;
  plaintextSize: number;
  ciphertextHash: string;
  tombstone: boolean;
  createdAt: string;
  protocolVersion: number;
  encryptionVersion: number;
  conflictGroupId?: string | null;
};

export type VaultRecord = {
  vaultId: string;
  ownerAccountId: string;
  mode: VaultSyncMode;
  protocolVersion: number;
  encryptionVersion: number;
  saltB64: string;
  kdfParams: ScryptKdfParams;
  quotaBytes: number;
  usageBytes: number;
  createdAt: string;
  deletedAt?: string | null;
  /** When true, membership gates sync access (P4.1). */
  teamEnabled?: boolean;
};

export type VaultMemberRole = "owner" | "admin" | "member";

export type VaultMemberRecord = {
  vaultId: string;
  memberAccountId: string;
  role: VaultMemberRole;
  status: "active" | "revoked";
  /** X25519 SPKI public key (base64). Private key never leaves the member device. */
  publicKeyB64: string;
  /** Ephemeral ECDH package wrapping BaseKey for this member. */
  ephemeralPublicKeyB64: string | null;
  wrappedBaseKeyB64: string | null;
  keyEpoch: number;
  joinedAt: string;
  revokedAt?: string | null;
};

export type VaultInviteRecord = {
  vaultId: string;
  inviteId: string;
  invitedByAccountId: string;
  /** Optional targeted invitee account; null = shareable link/code. */
  inviteeAccountId?: string | null;
  role: VaultMemberRole;
  inviteSaltB64: string;
  wrappedBaseKeyB64: string;
  keyEpoch: number;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  acceptedByAccountId?: string | null;
};

export type ScryptKdfParams = {
  alg: "scrypt";
  N: number;
  r: number;
  p: number;
  dkLen: number;
};

export const DEFAULT_SCRYPT_PARAMS: ScryptKdfParams = {
  alg: "scrypt",
  N: 16384,
  r: 8,
  p: 1,
  dkLen: 32,
};

export type VaultDeviceRecord = {
  vaultId: string;
  deviceId: string;
  platform: string;
  lastSequence: number;
  cursorRevisionId?: string | null;
  status: "active" | "revoked";
  registeredAt: string;
  revokedAt?: string | null;
};

export type PathHead = {
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
};

export type BlobRecord = {
  blobId: string;
  vaultId: string;
  sizeBytes: number;
  ciphertextHash: string;
  storageKey: string;
  createdAt: string;
};

/** Blobs at or below this size may use direct putBlob; larger must use upload sessions. */
export const VAULT_SYNC_DIRECT_PUT_MAX_BYTES = 1 * 1024 * 1024;
export const VAULT_SYNC_DEFAULT_CHUNK_SIZE = 256 * 1024;
/** Max chunk for HTTP binary upload (Wave D). WS Base64 chunks stay capped lower. */
export const VAULT_SYNC_MAX_CHUNK_SIZE = 8 * 1024 * 1024;
/** Hard cap for Gateway WebSocket Base64 put-chunk (must not carry 200MB payloads). */
export const VAULT_SYNC_WS_CHUNK_MAX_BYTES = 1 * 1024 * 1024;
/** Preferred HTTP chunk size for large ciphertext (≥ direct-put threshold). */
export const VAULT_SYNC_HTTP_CHUNK_SIZE = 4 * 1024 * 1024;

export type BlobUploadSession = {
  uploadId: string;
  vaultId: string;
  deviceId: string;
  ciphertextHash: string;
  totalSizeBytes: number;
  chunkSize: number;
  chunkCount: number;
  /** Sorted unique chunk indexes received (resume-friendly). */
  receivedChunkIndexes: number[];
  status: "open" | "completed" | "aborted";
  createdAt: string;
  updatedAt: string;
  completedBlobId?: string | null;
  /** Object-store presigned upload target id (Wave D), when applicable. */
  objectUploadBlobId?: string | null;
  /**
   * One-time-ish HTTP upload bearer for binary chunk PUT.
   * Returned only on create; never required on the WS control plane after issue.
   */
  httpUploadToken?: string | null;
};

export type VaultQuotaStatus = {
  vaultId: string;
  quotaBytes: number;
  usageBytes: number;
  pendingUploadBytes: number;
  availableBytes: number;
};

export type CommitRevisionResult = {
  status: "accepted" | "duplicate" | "conflict" | "rejected";
  revisionId: string;
  conflictGroupId: string | null;
  heads: string[];
  serverReceivedAt: string;
  reason?: string;
};

export type InventoryPage = {
  items: Array<{
    opaquePathId: string;
    heads: string[];
    latestRevisionId: string;
    tombstone: boolean;
  }>;
  nextCursor: string | null;
  /** Explicit flag — never silently drop remaining rows. */
  truncated: boolean;
};

export type SelectiveSyncOptions = {
  /** Text / notes / extensionless vault content (legacy name kept for stability). */
  includeFolders: boolean;
  includeImages: boolean;
  includeAudio: boolean;
  includeVideo: boolean;
  includePdf: boolean;
  includeOtherAttachments: boolean;
  /** Extra user exclude globs (path-relative, `*` / `**` supported). */
  excludeGlobs?: string[];
};

export const DEFAULT_SELECTIVE_SYNC: SelectiveSyncOptions = {
  includeFolders: true,
  includeImages: true,
  includeAudio: true,
  includeVideo: true,
  includePdf: true,
  includeOtherAttachments: true,
  excludeGlobs: [],
};

export type PlaintextFileMetadata = {
  relativePath: string;
  fileName: string;
  mimeType?: string;
  mtimeMs?: number;
};

export type VaultKeySet = {
  contentKey: Buffer;
  metadataKey: Buffer;
  pathLookupKey: Buffer;
  manifestAuthKey: Buffer;
};

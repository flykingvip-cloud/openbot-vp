export type {
  BlobRecord,
  BlobUploadSession,
  CommitRevisionResult,
  FileRevision,
  InventoryPage,
  SelectiveSyncOptions,
  VaultConnectionStatus,
  VaultDeviceRecord,
  VaultInviteRecord,
  VaultKeySet,
  VaultMemberRecord,
  VaultMemberRole,
  VaultQuotaStatus,
  VaultRecord,
  VaultSyncMode,
} from "./types.js";
export {
  DEFAULT_SCRYPT_PARAMS,
  DEFAULT_SELECTIVE_SYNC,
  VAULT_SYNC_DEFAULT_CHUNK_SIZE,
  VAULT_SYNC_DIRECT_PUT_MAX_BYTES,
  VAULT_SYNC_ENCRYPTION_VERSION,
  VAULT_SYNC_HTTP_CHUNK_SIZE,
  VAULT_SYNC_MAX_CHUNK_SIZE,
  VAULT_SYNC_PROTOCOL_VERSION,
  VAULT_SYNC_WS_CHUNK_MAX_BYTES,
} from "./types.js";
export { computeRevisionId } from "./revision-id.js";
export {
  assertKeysEqual,
  computeOpaquePathId,
  deriveBaseKey,
  deriveVaultKeySet,
  generateVaultSalt,
  generateRotatedBaseKey,
  unlockVaultKeys,
} from "./crypto/keys.js";
export {
  assertVaultManager,
  assertVaultMemberOrOwner,
  assertVaultOwner,
  assertVaultSyncActorMatches,
  legacyGatewaySyncEnabled,
  resolveVaultSyncActor,
  VAULT_SYNC_LOCAL_OPERATOR,
  VaultSyncAuthError,
} from "./gateway-auth.js";
export {
  generateInviteSalt,
  generateInviteSecret,
  generateMemberKeyPair,
  unwrapBaseKeyForMember,
  unwrapBaseKeyWithInviteSecret,
  wrapBaseKeyForMember,
  wrapBaseKeyWithInviteSecret,
  type MemberKeyPair,
  type WrappedBaseKeyPackage,
} from "./crypto/member-wrap.js";
export {
  buildContentAad,
  decryptAead,
  decryptJsonMetadata,
  encryptAead,
  encryptJsonMetadata,
  hashCiphertext,
} from "./crypto/aead.js";
export { isAlwaysExcluded, isSelectivelyIncluded, shouldSyncPath } from "./journal/excludes.js";
export {
  loadSelectiveSync,
  normalizeSelectiveSync,
  saveSelectiveSync,
  type StoredSelectiveSync,
} from "./selective-sync-store.js";
export { walkLocalInventoryAll, walkLocalInventoryPage } from "./journal/inventory.js";
export {
  appendJournalOp,
  clearOfflineJournal,
  loadOfflineJournal,
  saveOfflineJournal,
} from "./journal/offline-journal.js";
export { VaultSyncControlPlane } from "./store/control-plane.js";
export {
  createVaultSyncControlPlane,
  resolveVaultSyncControlPlaneRoot,
  resolveVaultSyncObjectStore,
} from "./store/create-control-plane.js";
export { FileVaultSyncObjectStore } from "./store/file-object-store.js";
export { MemoryVaultSyncObjectStore } from "./store/memory-object-store.js";
export {
  resolveS3VaultSyncObjectStoreConfigFromEnv,
  S3VaultSyncObjectStore,
} from "./store/s3-object-store.js";
export {
  ensureVaultSyncSchema,
  loadVaultSyncSchemaSql,
  resolveVaultSyncMetadataPrimary,
  VaultSyncPostgresMetadataMirror,
  type VaultSyncMetadataPrimary,
  type VaultSyncSqlClient,
} from "./store/postgres-metadata.js";
export {
  vaultSyncObjectStorageKey,
  type VaultSyncObjectStore,
  type VaultSyncPresignedPut,
} from "./store/object-store.js";
export {
  DEFAULT_VAULT_SYNC_RATE_LIMITS,
  VaultSyncRateLimiter,
  type VaultSyncRateLimitConfig,
} from "./store/rate-limit.js";
export { canAttemptTextMerge, tryThreeWayTextMerge, writeConflictCopies } from "./sync/conflict.js";
export { createVaultWithLocalDevice, DeviceSyncEngine } from "./sync/engine.js";
export { buildEpochRotationPackages, listActiveMembersForRotation } from "./team/key-rotation.js";
export {
  acceptInviteWithSecret,
  createInviteWithPassword,
  enableTeamWithPassword,
} from "./team/client-ops.js";
export {
  notifyVaultSyncRuntimeReindex,
  setVaultSyncRuntimeReindexHook,
} from "./runtime-reindex.js";
export {
  getVaultKnowledgeBaseBinding,
  setVaultKnowledgeBaseBinding,
  type VaultKnowledgeBaseBinding,
} from "./vault-kb-binding.js";
export {
  flushVaultSyncRevisionNotificationsForTest,
  notifyVaultSyncRevisionsAvailable,
  setVaultSyncRevisionEventSink,
  VAULT_SYNC_REVISIONS_EVENT,
  type VaultSyncRevisionsAvailablePayload,
  type VaultSyncRevisionEventSink,
} from "./events.js";

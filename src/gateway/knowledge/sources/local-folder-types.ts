/**
 * Three-layer model for durable local-folder knowledge sources (P0 types).
 *
 * Layer 1 — SourceDescriptor (logical, control-plane / cloud-visible)
 *   kind = "localFolder", plane = "passive". No absolute paths.
 *
 * Layer 2 — LocalFolderBinding (device-local runtime; rootPath stays on device)
 *
 * Layer 3 — SourceDocumentLink (runtime projection: source ↔ document mapping)
 *
 * P1 local_index bind/scan; P1.1 watcher; P3 managed_push + sync.plan/commit.
 *
 * @see docs/design/openbot-knowledge-runtime-source-connector-2026-07-14.md
 */

/** Device-local durable binding for a connected folder (layer 2). */
export type LocalFolderBindingMode = "local_index" | "managed_push";

export type LocalFolderDeletePolicy = "sync" | "snapshot";

export type LocalFolderBindingStatus = "idle" | "scanning" | "error";

export type LocalFolderBinding = {
  bindingId: string;
  /** Logical SourceDescriptor.id (layer 1). */
  sourceDescriptorId: string;
  knowledgeBaseId: string;
  deviceId: string;
  mode: LocalFolderBindingMode;
  /** Monotonic persisted configuration revision used to invalidate managed sync leases. */
  revision?: number;
  /** Opaque browser/device directory identity. Required for new managed_push bindings. */
  directoryId?: string;
  /** Device-local only — never persist into tenant-visible SourceDescriptor. */
  rootPath: string;
  /** Cloud-visible friendly label (e.g. folder basename). */
  rootLabel: string;
  includeGlobs: string[];
  excludeGlobs: string[];
  deletePolicy: LocalFolderDeletePolicy;
  watcherEnabled: boolean;
  status: LocalFolderBindingStatus;
  lastScanAt?: number;
  lastEventAt?: number;
  lastError?: string;
};

/** Runtime mapping from a localFolder source to projected documents (layer 3). */
export type SourceDocumentLinkState = "active" | "tombstoned" | "snapshotted_deleted";

export type SourceDocumentLink = {
  sourceDescriptorId: string;
  docId: string;
  /** Path relative to LocalFolderBinding.rootPath (never absolute). */
  relativePath: string;
  state: SourceDocumentLinkState;
  lastSeenAt: number;
  lastIngestedVersionId?: string;
  rawHash?: string;
  semanticHash?: string;
};

// --- Dedicated RPC contracts (do NOT reuse knowledge.source.bind) ---

export type LocalFolderBindRequest = {
  knowledgeBaseId: string;
  /** Friendly label for the logical source (no absolute path). */
  rootLabel: string;
  /** Opaque stable identity required for managed_push; never derived from the display label. */
  directoryId?: string;
  /**
   * Absolute path — accepted only for device-local binding creation.
   * Gateway must not write this into SourceDescriptor.
   * Must sit under Data Space unless allowOutsideDataRoot is true.
   */
  rootPath?: string;
  /**
   * Explicit approval to bind a path outside data.root (default ~/OpenBot).
   * Required when rootPath is outside the Data Space.
   */
  allowOutsideDataRoot?: boolean;
  /** Stable device identity (required for managed_push multi-device isolation). */
  deviceId?: string;
  mode?: LocalFolderBindingMode;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  deletePolicy?: LocalFolderDeletePolicy;
  watcherEnabled?: boolean;
};

export type LocalFolderBindResponse = {
  sourceDescriptorId: string;
  bindingId: string;
  rootLabel: string;
  knowledgeBaseId: string;
};

export type LocalFolderScanNowRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
};

export type LocalFolderScanNowResponse = {
  accepted: boolean;
  bindingId: string;
  status: LocalFolderBindingStatus;
};

export type LocalFolderUnbindRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  /** When true, attempt purge of projected docs per deletePolicy (P1). */
  purgeProjected?: boolean;
};

export type LocalFolderUnbindResponse = {
  ok: boolean;
};

/** Open a projected local-folder document with the host OS default application. */
export type LocalFolderOpenDocumentRequest = {
  documentId: string;
  knowledgeBaseId?: string;
};

export type LocalFolderOpenDocumentResponse = {
  ok: true;
  documentId: string;
  bindingId: string;
  relativePath: string;
  absolutePath: string;
};

export type LocalFolderStatusRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  knowledgeBaseId?: string;
};

export type LocalFolderStatusItem = {
  bindingId: string;
  sourceDescriptorId: string;
  knowledgeBaseId: string;
  rootLabel: string;
  status: LocalFolderBindingStatus;
  watcherEnabled: boolean;
  /** Whether a chokidar watcher is currently running for this binding. */
  watcherRunning?: boolean;
  deletePolicy: LocalFolderDeletePolicy;
  mode: LocalFolderBindingMode;
  lastScanAt?: number;
  lastEventAt?: number;
  lastError?: string;
  /** Count of SourceDocumentLink rows in active state (when available). */
  activeDocumentCount?: number;
};

export type LocalFolderStatusResponse = {
  items: LocalFolderStatusItem[];
};

// --- P3 managed_push sync contracts (client scans; cloud ingests) ---

export type LocalFolderSyncCandidate = {
  relativePath: string;
  /** sha256 hex of raw file bytes (preferred). */
  rawHash?: string;
  sizeBytes?: number;
  mtimeMs?: number;
};

export type LocalFolderSyncPlanRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  deviceId: string;
  /** Current device-visible files (relative paths + optional hashes). */
  candidates: LocalFolderSyncCandidate[];
  /**
   * Files still on the device but not in this inventory (unreadable / oversized).
   * They must not be inferred as deletions.
   */
  retainRelativePaths?: string[];
};

export type LocalFolderSyncNeedUpload = {
  relativePath: string;
  reason: "missing" | "hash_mismatch" | "no_hash";
  docId: string;
};

/** Pure inventory delta, also reused by passive connectors. */
export type LocalFolderSyncPlanResponse = {
  bindingId: string;
  sourceDescriptorId: string;
  needUpload: LocalFolderSyncNeedUpload[];
  unchanged: string[];
  /** Active on server but not present in candidates. */
  missingOnDevice: string[];
};

/** Server-issued lease for one managed_push inventory generation. */
export type ManagedLocalFolderSyncPlanResponse = LocalFolderSyncPlanResponse & {
  planId: string;
  generation: number;
  deviceId: string;
  expiresAtMs: number;
};

export type LocalFolderSyncCommitFile = {
  relativePath: string;
  fileName?: string;
  mimeType?: string;
  /** Base64 raw bytes (preferred for binary). */
  contentBase64?: string;
  /** UTF-8 text alternative for text/* markdown. */
  textContent?: string;
  rawHash?: string;
};

export type LocalFolderSyncCommitPhase = "upload" | "finalize";

export type LocalFolderSyncCommitRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  deviceId: string;
  planId: string;
  generation: number;
  phase: LocalFolderSyncCommitPhase;
  files: LocalFolderSyncCommitFile[];
};

export type LocalFolderSyncCommitDocument = {
  relativePath: string;
  docId: string;
  originalStored: boolean;
  chunkCount: number;
  vectorCount: number;
  ready: boolean;
};

export type LocalFolderSyncCommitResponse = {
  bindingId: string;
  sourceDescriptorId: string;
  ingested: number;
  skipped: number;
  tombstoned: number;
  snapshotted: number;
  errors: string[];
  documents?: LocalFolderSyncCommitDocument[];
};

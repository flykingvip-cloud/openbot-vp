export type SelectiveSyncOptions = {
  includeFolders: boolean;
  includeImages: boolean;
  includeAudio: boolean;
  includeVideo: boolean;
  includePdf: boolean;
  includeOtherAttachments: boolean;
  excludeGlobs?: string[];
};

export type ClientSyncPushResult = {
  uploaded: number;
  conflicts: number;
  deleted: number;
  errors: string[];
  skipped: number;
};

export type ClientSyncPullResult = {
  applied: number;
  conflicts: number;
  errors: string[];
  touchedPaths: string[];
};

export type FileRevisionWire = {
  vaultId: string;
  opaquePathId: string;
  revisionId: string;
  parentRevisionIds: string[];
  deviceId: string;
  deviceSequence: number;
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

export type PlaintextFileMetadata = {
  relativePath: string;
  fileName: string;
  mimeType?: string;
  mtimeMs?: number;
};

export type VaultSyncClientGateway = {
  vaultSyncStatus: (req: { vaultId: string }) => Promise<{
    saltB64?: string;
    encryptionVersion?: number;
    kdfParams?: import("./client-crypto.ts").ScryptKdfParams;
  }>;
  listVaultSyncDevices: (req: { vaultId: string }) => Promise<{
    devices?: Array<{ deviceId: string; lastSequence?: number; status?: string }>;
  }>;
  putVaultSyncBlob: (req: {
    vaultId: string;
    deviceId: string;
    ciphertextHash: string;
    contentBase64: string;
  }) => Promise<{ blobId?: string }>;
  commitVaultSyncRevision: (req: {
    revision: FileRevisionWire;
    idempotencyKey?: string;
  }) => Promise<{
    result?: { status?: string; revisionId?: string; conflictGroupId?: string | null };
  }>;
  listVaultSyncRevisionsSince: (req: {
    vaultId: string;
    cursor?: string;
    limit?: number;
  }) => Promise<{ revisions?: FileRevisionWire[]; nextCursor?: string | null }>;
  getVaultSyncRevision?: (req: {
    vaultId: string;
    revisionId: string;
  }) => Promise<{ revision?: FileRevisionWire | null }>;
  listVaultSyncRevisionsForPath?: (req: {
    vaultId: string;
    opaquePathId: string;
  }) => Promise<{ opaquePathId?: string; revisions?: FileRevisionWire[] }>;
  getVaultSyncBlob: (req: {
    vaultId: string;
    blobId: string;
  }) => Promise<{ contentBase64?: string }>;
  vaultSyncInventory: (req: {
    vaultId: string;
    cursor?: string | null;
    limit?: number;
  }) => Promise<{
    items?: Array<{ opaquePathId: string; heads?: string[] }>;
  }>;
  enableVaultSyncTeam?: (req: {
    vaultId: string;
    ownerAccountId: string;
    publicKeyB64: string;
    ephemeralPublicKeyB64: string;
    wrappedBaseKeyB64: string;
    keyEpoch?: number;
  }) => Promise<unknown>;
  createVaultSyncInvite?: (req: {
    vaultId: string;
    invitedByAccountId: string;
    inviteSaltB64: string;
    wrappedBaseKeyB64: string;
    inviteId?: string;
    inviteeAccountId?: string | null;
  }) => Promise<{ invite?: { inviteId?: string } }>;
  acceptVaultSyncInvite?: (req: {
    vaultId: string;
    inviteId: string;
    memberAccountId: string;
    publicKeyB64: string;
    ephemeralPublicKeyB64: string;
    wrappedBaseKeyB64: string;
  }) => Promise<unknown>;
  listVaultSyncInvites?: (req: { vaultId: string }) => Promise<{
    invites?: Array<{
      inviteId: string;
      inviteSaltB64?: string;
      wrappedBaseKeyB64?: string;
      keyEpoch?: number;
      status?: string;
    }>;
  }>;
  listVaultSyncMembers?: (req: { vaultId: string }) => Promise<{
    members?: Array<{
      memberAccountId: string;
      status?: string;
      publicKeyB64?: string;
      role?: string;
    }>;
  }>;
  rotateVaultSyncMemberWraps?: (req: {
    vaultId: string;
    actorAccountId: string;
    keyEpoch: number;
    wraps: Array<{
      memberAccountId: string;
      ephemeralPublicKeyB64: string;
      wrappedBaseKeyB64: string;
    }>;
  }) => Promise<{ members?: unknown[] }>;
  bumpVaultSyncEncryptionVersion?: (req: {
    vaultId: string;
    expectedCurrent?: number;
  }) => Promise<{ encryptionVersion?: number }>;
  createVaultSyncUploadSession?: (req: {
    vaultId: string;
    deviceId: string;
    ciphertextHash: string;
    totalSizeBytes: number;
    chunkSize?: number;
  }) => Promise<{ session?: Record<string, unknown> }>;
  putVaultSyncUploadChunk?: (req: {
    vaultId: string;
    uploadId: string;
    chunkIndex: number;
    contentBase64: string;
  }) => Promise<{ session?: Record<string, unknown> }>;
  completeVaultSyncUploadSession?: (req: {
    vaultId: string;
    uploadId: string;
  }) => Promise<{ blobId?: string }>;
  revokeVaultSyncMember?: (req: {
    vaultId: string;
    memberAccountId: string;
    actorAccountId: string;
  }) => Promise<{ member?: unknown }>;
  revokeVaultSyncMemberAndRotate?: (req: {
    vaultId: string;
    memberAccountId: string;
    actorAccountId: string;
    expectedCurrentEncryptionVersion?: number;
    wraps?: Array<{
      memberAccountId: string;
      ephemeralPublicKeyB64: string;
      wrappedBaseKeyB64: string;
    }>;
  }) => Promise<{ member?: unknown; encryptionVersion?: number }>;
  abortVaultSyncUploadSession?: (req: { vaultId: string; uploadId: string }) => Promise<unknown>;
};

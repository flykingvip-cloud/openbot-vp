/**
 * Browser-safe in-memory vault sync control plane for Chromium E2E.
 * Mirrors the minimal Gateway surface used by runClientVaultSync (no Node fs / PG).
 */
import { bytesToBase64, base64ToBytes, sha256Hex } from "./bytes.ts";
import { DEFAULT_SCRYPT_PARAMS, type ScryptKdfParams } from "./client-crypto.ts";
import type { FileRevisionWire, VaultSyncClientGateway } from "./client-sync-types.ts";

export type MemoryVaultRecord = {
  vaultId: string;
  ownerAccountId: string;
  saltB64: string;
  encryptionVersion: number;
  kdfParams: ScryptKdfParams;
  teamEnabled: boolean;
};

type MemoryMemberRecord = {
  memberAccountId: string;
  role: "owner" | "admin" | "member";
  status: "active" | "revoked";
  publicKeyB64: string;
  ephemeralPublicKeyB64: string | null;
  wrappedBaseKeyB64: string | null;
  keyEpoch: number;
};

type MemoryInviteRecord = {
  inviteId: string;
  invitedByAccountId: string;
  inviteeAccountId: string | null;
  inviteSaltB64: string;
  wrappedBaseKeyB64: string;
  keyEpoch: number;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
};

type DeviceRecord = {
  deviceId: string;
  lastSequence: number;
  status: string;
};

type UploadSession = {
  uploadId: string;
  vaultId: string;
  deviceId: string;
  ciphertextHash: string;
  totalSizeBytes: number;
  chunkSize: number;
  chunkCount: number;
  received: Map<number, Uint8Array>;
  httpUploadToken: string;
  status: "open" | "complete";
};

function newId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `${prefix}_${bytesToBase64(bytes).replace(/[+/=]/g, "").slice(0, 16)}`;
}

function parentsCoverHeads(parents: string[], heads: string[]): boolean {
  if (heads.length === 0) {
    return true;
  }
  const set = new Set(parents);
  return heads.every((h) => set.has(h));
}

export class MemoryVaultSyncPlane {
  readonly vaults = new Map<string, MemoryVaultRecord>();
  readonly devices = new Map<string, Map<string, DeviceRecord>>();
  readonly blobs = new Map<string, Map<string, Uint8Array>>();
  readonly revisions = new Map<string, FileRevisionWire[]>();
  readonly heads = new Map<string, Map<string, string[]>>();
  readonly uploads = new Map<string, UploadSession>();
  readonly members = new Map<string, Map<string, MemoryMemberRecord>>();
  readonly invites = new Map<string, MemoryInviteRecord[]>();
  /** Serialized plane snapshot for plaintext leak assertions. */
  wireLog: string[] = [];

  createVault(params: {
    ownerAccountId: string;
    saltB64: string;
    kdfParams?: ScryptKdfParams;
  }): MemoryVaultRecord {
    const vaultId = newId("vault");
    const vault: MemoryVaultRecord = {
      vaultId,
      ownerAccountId: params.ownerAccountId,
      saltB64: params.saltB64,
      encryptionVersion: 1,
      kdfParams: params.kdfParams ?? DEFAULT_SCRYPT_PARAMS,
      teamEnabled: false,
    };
    this.vaults.set(vaultId, vault);
    this.devices.set(vaultId, new Map());
    this.blobs.set(vaultId, new Map());
    this.revisions.set(vaultId, []);
    this.heads.set(vaultId, new Map());
    this.members.set(vaultId, new Map());
    this.invites.set(vaultId, []);
    return vault;
  }

  enableTeamWithOwner(params: {
    vaultId: string;
    ownerAccountId: string;
    publicKeyB64: string;
    ephemeralPublicKeyB64: string;
    wrappedBaseKeyB64: string;
    keyEpoch?: number;
  }): MemoryMemberRecord {
    const vault = this.vaults.get(params.vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    if (vault.ownerAccountId !== params.ownerAccountId) {
      throw new Error("forbidden");
    }
    vault.teamEnabled = true;
    const keyEpoch = params.keyEpoch ?? vault.encryptionVersion;
    const owner: MemoryMemberRecord = {
      memberAccountId: params.ownerAccountId,
      role: "owner",
      status: "active",
      publicKeyB64: params.publicKeyB64,
      ephemeralPublicKeyB64: params.ephemeralPublicKeyB64,
      wrappedBaseKeyB64: params.wrappedBaseKeyB64,
      keyEpoch,
    };
    this.members.get(params.vaultId)!.set(params.ownerAccountId, owner);
    return owner;
  }

  createInvite(params: {
    vaultId: string;
    invitedByAccountId: string;
    inviteId: string;
    inviteSaltB64: string;
    wrappedBaseKeyB64: string;
    inviteeAccountId?: string | null;
  }): MemoryInviteRecord {
    const vault = this.vaults.get(params.vaultId);
    if (!vault?.teamEnabled) {
      throw new Error("team not enabled");
    }
    const invite: MemoryInviteRecord = {
      inviteId: params.inviteId,
      invitedByAccountId: params.invitedByAccountId,
      inviteeAccountId: params.inviteeAccountId ?? null,
      inviteSaltB64: params.inviteSaltB64,
      wrappedBaseKeyB64: params.wrappedBaseKeyB64,
      keyEpoch: vault.encryptionVersion,
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    this.invites.get(params.vaultId)!.push(invite);
    return invite;
  }

  acceptInvite(params: {
    vaultId: string;
    inviteId: string;
    memberAccountId: string;
    publicKeyB64: string;
    ephemeralPublicKeyB64: string;
    wrappedBaseKeyB64: string;
  }): MemoryMemberRecord {
    const vault = this.vaults.get(params.vaultId);
    if (!vault?.teamEnabled) {
      throw new Error("team not enabled");
    }
    const invites = this.invites.get(params.vaultId)!;
    const invite = invites.find((i) => i.inviteId === params.inviteId);
    if (!invite || invite.status !== "pending") {
      throw new Error("invite not pending");
    }
    const member: MemoryMemberRecord = {
      memberAccountId: params.memberAccountId,
      role: "member",
      status: "active",
      publicKeyB64: params.publicKeyB64,
      ephemeralPublicKeyB64: params.ephemeralPublicKeyB64,
      wrappedBaseKeyB64: params.wrappedBaseKeyB64,
      keyEpoch: invite.keyEpoch,
    };
    this.members.get(params.vaultId)!.set(params.memberAccountId, member);
    invite.status = "accepted";
    return member;
  }

  listMembers(vaultId: string): MemoryMemberRecord[] {
    return [...(this.members.get(vaultId)?.values() ?? [])];
  }

  listInvites(vaultId: string): MemoryInviteRecord[] {
    return [...(this.invites.get(vaultId) ?? [])];
  }

  bumpEncryptionVersion(params: { vaultId: string; expectedCurrent?: number }): number {
    const vault = this.vaults.get(params.vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    const expected = params.expectedCurrent ?? vault.encryptionVersion;
    if (expected !== vault.encryptionVersion) {
      throw new Error("encryption version conflict");
    }
    vault.encryptionVersion += 1;
    return vault.encryptionVersion;
  }

  rotateMemberWraps(params: {
    vaultId: string;
    keyEpoch: number;
    wraps: Array<{
      memberAccountId: string;
      ephemeralPublicKeyB64: string;
      wrappedBaseKeyB64: string;
    }>;
  }): MemoryMemberRecord[] {
    const vault = this.vaults.get(params.vaultId);
    if (!vault?.teamEnabled) {
      throw new Error("team not enabled");
    }
    if (params.keyEpoch !== vault.encryptionVersion) {
      throw new Error("encryption version mismatch");
    }
    const store = this.members.get(params.vaultId)!;
    const active = [...store.values()].filter((m) => m.status === "active");
    for (const wrap of params.wraps) {
      const member = store.get(wrap.memberAccountId);
      if (!member || member.status !== "active") {
        throw new Error(`member not active: ${wrap.memberAccountId}`);
      }
      member.ephemeralPublicKeyB64 = wrap.ephemeralPublicKeyB64;
      member.wrappedBaseKeyB64 = wrap.wrappedBaseKeyB64;
      member.keyEpoch = params.keyEpoch;
    }
    return active;
  }

  revokeMemberAndRotateEpoch(params: {
    vaultId: string;
    memberAccountId: string;
    expectedCurrentEncryptionVersion: number;
    wraps: Array<{
      memberAccountId: string;
      ephemeralPublicKeyB64: string;
      wrappedBaseKeyB64: string;
    }>;
  }): { encryptionVersion: number; members: MemoryMemberRecord[] } {
    const vault = this.vaults.get(params.vaultId);
    if (!vault?.teamEnabled) {
      throw new Error("team not enabled");
    }
    if (params.expectedCurrentEncryptionVersion !== vault.encryptionVersion) {
      throw new Error("encryption version conflict");
    }
    const store = this.members.get(params.vaultId)!;
    const member = store.get(params.memberAccountId);
    if (!member) {
      throw new Error("member not found");
    }
    if (member.role === "owner") {
      throw new Error("cannot revoke owner");
    }
    member.status = "revoked";
    member.wrappedBaseKeyB64 = null;
    member.ephemeralPublicKeyB64 = null;
    vault.encryptionVersion += 1;
    const nextEpoch = vault.encryptionVersion;
    const activeRemaining = [...store.values()].filter((m) => m.status === "active");
    const activeIds = new Set(activeRemaining.map((m) => m.memberAccountId));
    if (params.wraps.length !== activeIds.size) {
      throw new Error("wraps must cover all remaining active members");
    }
    for (const wrap of params.wraps) {
      const active = store.get(wrap.memberAccountId);
      if (!active || active.status !== "active") {
        throw new Error(`member not active: ${wrap.memberAccountId}`);
      }
      active.ephemeralPublicKeyB64 = wrap.ephemeralPublicKeyB64;
      active.wrappedBaseKeyB64 = wrap.wrappedBaseKeyB64;
      active.keyEpoch = nextEpoch;
    }
    return { encryptionVersion: nextEpoch, members: activeRemaining };
  }

  registerDevice(params: { vaultId: string; deviceId: string }): void {
    const devices = this.devices.get(params.vaultId);
    if (!devices) {
      throw new Error("vault not found");
    }
    devices.set(params.deviceId, {
      deviceId: params.deviceId,
      lastSequence: 0,
      status: "active",
    });
  }

  async putBlob(params: {
    vaultId: string;
    ciphertextHash: string;
    ciphertext: Uint8Array;
  }): Promise<{ blobId: string }> {
    const store = this.blobs.get(params.vaultId);
    if (!store) {
      throw new Error("vault not found");
    }
    const hash = await sha256Hex(params.ciphertext);
    if (hash !== params.ciphertextHash) {
      throw new Error("ciphertext hash mismatch");
    }
    const blobId = newId("blob");
    store.set(blobId, params.ciphertext);
    return { blobId };
  }

  getBlob(vaultId: string, blobId: string): Uint8Array | null {
    return this.blobs.get(vaultId)?.get(blobId) ?? null;
  }

  commitRevision(revision: FileRevisionWire): {
    status: string;
    revisionId: string;
    conflictGroupId: string | null;
  } {
    const list = this.revisions.get(revision.vaultId);
    const headsMap = this.heads.get(revision.vaultId);
    const devices = this.devices.get(revision.vaultId);
    if (!list || !headsMap || !devices) {
      throw new Error("vault not found");
    }
    this.wireLog.push(JSON.stringify(revision));

    const existing = list.find((r) => r.revisionId === revision.revisionId);
    if (existing) {
      return {
        status: "duplicate",
        revisionId: existing.revisionId,
        conflictGroupId: existing.conflictGroupId ?? null,
      };
    }

    const currentHeads = [...(headsMap.get(revision.opaquePathId) ?? [])];
    let nextHeads: string[];
    let conflictGroupId: string | null = revision.conflictGroupId ?? null;
    let status = "accepted";

    if (parentsCoverHeads(revision.parentRevisionIds, currentHeads)) {
      nextHeads = [
        ...currentHeads.filter((h) => !revision.parentRevisionIds.includes(h)),
        revision.revisionId,
      ];
    } else {
      status = "conflict";
      conflictGroupId = conflictGroupId ?? newId("conflict");
      nextHeads = [...new Set([...currentHeads, revision.revisionId])];
    }

    const stored: FileRevisionWire = {
      ...revision,
      conflictGroupId,
    };
    list.push(stored);
    headsMap.set(revision.opaquePathId, nextHeads);

    const device = devices.get(revision.deviceId);
    if (device && revision.deviceSequence > device.lastSequence) {
      device.lastSequence = revision.deviceSequence;
    }

    return { status, revisionId: revision.revisionId, conflictGroupId };
  }

  createUploadSession(params: {
    vaultId: string;
    deviceId: string;
    ciphertextHash: string;
    totalSizeBytes: number;
    chunkSize: number;
  }): UploadSession {
    const chunkCount = Math.ceil(params.totalSizeBytes / params.chunkSize) || 1;
    const session: UploadSession = {
      uploadId: newId("upload"),
      vaultId: params.vaultId,
      deviceId: params.deviceId,
      ciphertextHash: params.ciphertextHash,
      totalSizeBytes: params.totalSizeBytes,
      chunkSize: params.chunkSize,
      chunkCount,
      received: new Map(),
      httpUploadToken: newId("tok"),
      status: "open",
    };
    this.uploads.set(session.uploadId, session);
    return session;
  }

  putUploadChunk(params: {
    uploadId: string;
    chunkIndex: number;
    data: Uint8Array;
  }): UploadSession {
    const session = this.uploads.get(params.uploadId);
    if (!session || session.status !== "open") {
      throw new Error("upload session not found");
    }
    session.received.set(params.chunkIndex, params.data);
    return session;
  }

  async completeUploadSession(params: {
    vaultId: string;
    uploadId: string;
  }): Promise<{ blobId: string }> {
    const session = this.uploads.get(params.uploadId);
    if (!session || session.vaultId !== params.vaultId) {
      throw new Error("upload session not found");
    }
    if (session.received.size < session.chunkCount) {
      throw new Error("incomplete upload");
    }
    const parts: Uint8Array[] = [];
    for (let i = 0; i < session.chunkCount; i++) {
      const part = session.received.get(i);
      if (!part) {
        throw new Error(`missing chunk ${i}`);
      }
      parts.push(part);
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const ciphertext = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      ciphertext.set(part, offset);
      offset += part.length;
    }
    session.status = "complete";
    return this.putBlob({
      vaultId: params.vaultId,
      ciphertextHash: session.ciphertextHash,
      ciphertext,
    });
  }

  inventory(vaultId: string): Array<{ opaquePathId: string; heads: string[] }> {
    const headsMap = this.heads.get(vaultId);
    if (!headsMap) {
      return [];
    }
    return [...headsMap.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([opaquePathId, heads]) => ({ opaquePathId, heads: [...heads] }));
  }

  listRevisionsSince(vaultId: string): FileRevisionWire[] {
    return [...(this.revisions.get(vaultId) ?? [])];
  }

  getRevision(vaultId: string, revisionId: string): FileRevisionWire | null {
    return this.listRevisionsSince(vaultId).find((row) => row.revisionId === revisionId) ?? null;
  }

  listRevisionsForPath(vaultId: string, opaquePathId: string): FileRevisionWire[] {
    return this.listRevisionsSince(vaultId).filter((row) => row.opaquePathId === opaquePathId);
  }
}

export function createMemoryPlaneGateway(plane: MemoryVaultSyncPlane): VaultSyncClientGateway {
  return {
    vaultSyncStatus: async ({ vaultId }) => {
      const vault = plane.vaults.get(vaultId);
      if (!vault) {
        throw new Error("vault not found");
      }
      return {
        saltB64: vault.saltB64,
        encryptionVersion: vault.encryptionVersion,
        kdfParams: vault.kdfParams,
      };
    },
    listVaultSyncDevices: async ({ vaultId }) => ({
      devices: [...(plane.devices.get(vaultId)?.values() ?? [])].map((d) => ({
        deviceId: d.deviceId,
        lastSequence: d.lastSequence,
        status: d.status,
      })),
    }),
    vaultSyncInventory: async ({ vaultId }) => ({
      items: plane.inventory(vaultId),
    }),
    putVaultSyncBlob: async ({ vaultId, ciphertextHash, contentBase64 }) => {
      const blob = await plane.putBlob({
        vaultId,
        ciphertextHash,
        ciphertext: base64ToBytes(contentBase64),
      });
      return { blobId: blob.blobId };
    },
    getVaultSyncBlob: async ({ vaultId, blobId }) => {
      const data = plane.getBlob(vaultId, blobId);
      if (!data) {
        return {};
      }
      return { contentBase64: bytesToBase64(data) };
    },
    commitVaultSyncRevision: async ({ revision }) => {
      const result = plane.commitRevision({
        ...revision,
        conflictGroupId: revision.conflictGroupId ?? null,
      });
      return { result };
    },
    listVaultSyncRevisionsSince: async ({ vaultId }) => ({
      revisions: plane.listRevisionsSince(vaultId),
      nextCursor: null,
    }),
    getVaultSyncRevision: async ({ vaultId, revisionId }) => ({
      revision: plane.getRevision(vaultId, revisionId),
    }),
    listVaultSyncRevisionsForPath: async ({ vaultId, opaquePathId }) => ({
      opaquePathId,
      revisions: plane.listRevisionsForPath(vaultId, opaquePathId),
    }),
    createVaultSyncUploadSession: async ({
      vaultId,
      deviceId,
      ciphertextHash,
      totalSizeBytes,
      chunkSize,
    }) => {
      const session = plane.createUploadSession({
        vaultId,
        deviceId,
        ciphertextHash,
        totalSizeBytes,
        chunkSize: chunkSize ?? 256 * 1024,
      });
      return {
        session: {
          uploadId: session.uploadId,
          vaultId: session.vaultId,
          deviceId: session.deviceId,
          ciphertextHash: session.ciphertextHash,
          totalSizeBytes: session.totalSizeBytes,
          chunkSize: session.chunkSize,
          chunkCount: session.chunkCount,
          receivedChunkIndexes: [...session.received.keys()],
          status: session.status,
        },
      };
    },
    putVaultSyncUploadChunk: async ({ uploadId, chunkIndex, contentBase64 }) => {
      const session = plane.putUploadChunk({
        uploadId,
        chunkIndex,
        data: base64ToBytes(contentBase64),
      });
      return {
        session: {
          status: session.status,
          receivedChunkIndexes: [...session.received.keys()],
        },
      };
    },
    completeVaultSyncUploadSession: async ({ vaultId, uploadId }) =>
      plane.completeUploadSession({ vaultId, uploadId }),
    enableVaultSyncTeam: async (req) => {
      plane.enableTeamWithOwner({
        vaultId: req.vaultId,
        ownerAccountId: req.ownerAccountId,
        publicKeyB64: req.publicKeyB64,
        ephemeralPublicKeyB64: req.ephemeralPublicKeyB64,
        wrappedBaseKeyB64: req.wrappedBaseKeyB64,
        keyEpoch: req.keyEpoch,
      });
      return {};
    },
    createVaultSyncInvite: async (req) => {
      const inviteId = req.inviteId?.trim() || newId("invite");
      plane.createInvite({
        vaultId: req.vaultId,
        invitedByAccountId: req.invitedByAccountId,
        inviteId,
        inviteSaltB64: req.inviteSaltB64,
        wrappedBaseKeyB64: req.wrappedBaseKeyB64,
        inviteeAccountId: req.inviteeAccountId,
      });
      return { invite: { inviteId } };
    },
    acceptVaultSyncInvite: async (req) => {
      plane.acceptInvite({
        vaultId: req.vaultId,
        inviteId: req.inviteId,
        memberAccountId: req.memberAccountId,
        publicKeyB64: req.publicKeyB64,
        ephemeralPublicKeyB64: req.ephemeralPublicKeyB64,
        wrappedBaseKeyB64: req.wrappedBaseKeyB64,
      });
      return {};
    },
    listVaultSyncInvites: async ({ vaultId }) => ({
      invites: plane.listInvites(vaultId).map((invite) => ({
        inviteId: invite.inviteId,
        inviteSaltB64: invite.inviteSaltB64,
        wrappedBaseKeyB64: invite.wrappedBaseKeyB64,
        keyEpoch: invite.keyEpoch,
        status: invite.status,
      })),
    }),
    listVaultSyncMembers: async ({ vaultId }) => ({
      members: plane.listMembers(vaultId).map((member) => ({
        memberAccountId: member.memberAccountId,
        status: member.status,
        publicKeyB64: member.publicKeyB64,
        role: member.role,
      })),
    }),
    rotateVaultSyncMemberWraps: async (req) => {
      const members = plane.rotateMemberWraps({
        vaultId: req.vaultId,
        keyEpoch: req.keyEpoch,
        wraps: req.wraps,
      });
      return { members };
    },
    revokeVaultSyncMemberAndRotate: async (req) => {
      const result = plane.revokeMemberAndRotateEpoch({
        vaultId: req.vaultId,
        memberAccountId: req.memberAccountId,
        expectedCurrentEncryptionVersion: req.expectedCurrentEncryptionVersion ?? 1,
        wraps: req.wraps ?? [],
      });
      return {
        encryptionVersion: result.encryptionVersion,
        members: result.members,
      };
    },
    bumpVaultSyncEncryptionVersion: async (req) => {
      const encryptionVersion = plane.bumpEncryptionVersion({
        vaultId: req.vaultId,
        expectedCurrent: req.expectedCurrent,
      });
      return { encryptionVersion };
    },
  };
}

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { notifyVaultSyncRevisionsAvailable } from "../events.js";
import { computeRevisionId } from "../revision-id.js";
import type {
  BlobRecord,
  BlobUploadSession,
  CommitRevisionResult,
  FileRevision,
  InventoryPage,
  VaultDeviceRecord,
  VaultInviteRecord,
  VaultMemberRecord,
  VaultMemberRole,
  VaultQuotaStatus,
  VaultRecord,
} from "../types.js";
import {
  DEFAULT_SCRYPT_PARAMS,
  VAULT_SYNC_DEFAULT_CHUNK_SIZE,
  VAULT_SYNC_DIRECT_PUT_MAX_BYTES,
  VAULT_SYNC_ENCRYPTION_VERSION,
  VAULT_SYNC_MAX_CHUNK_SIZE,
  VAULT_SYNC_PROTOCOL_VERSION,
} from "../types.js";
import { FileVaultSyncObjectStore } from "./file-object-store.js";
import type { VaultSyncObjectStore } from "./object-store.js";
import {
  VaultSyncPostgresMetadataMirror,
  type VaultSyncMetadataPrimary,
  type VaultSyncSqlClient,
} from "./postgres-metadata.js";
import { VaultSyncRateLimiter, type VaultSyncRateLimitConfig } from "./rate-limit.js";

export type VaultSyncControlPlaneOptions = {
  rateLimits?: Partial<VaultSyncRateLimitConfig>;
  /** Ciphertext object store (file default; S3/MinIO via factory). */
  objectStore?: VaultSyncObjectStore;
  /** Optional Postgres metadata client (OPENBOT_VAULT_SYNC_DATABASE_URL). */
  sql?: VaultSyncSqlClient;
  /**
   * Wave G: `postgres` makes vault/blob/revision/heads/devices durable in PG
   * (file JSON becomes cache + crash recovery source via hydrate).
   * Default `file` keeps prior best-effort mirror behavior.
   */
  metadataPrimary?: VaultSyncMetadataPrimary;
};

/**
 * Sync control plane (P1 MVP + P2 blob upload sessions + Wave E object store + Wave G PG primary).
 * Stores only ciphertext + opaque metadata — never plaintext paths/content.
 * Default: file JSON authoritative + optional best-effort PG mirror.
 * With metadataPrimary=postgres: PG is required durable store for core sync metadata.
 */
export class VaultSyncControlPlane {
  private readonly root: string;
  private readonly rateLimiter: VaultSyncRateLimiter;
  private readonly objectStore: VaultSyncObjectStore;
  private readonly metadataMirror: VaultSyncPostgresMetadataMirror | null;
  private readonly metadataPrimary: VaultSyncMetadataPrimary;
  private mirrorSchemaReady = false;
  private pendingPrimaryWrites: Promise<void>[] = [];

  constructor(rootDir: string, options?: VaultSyncControlPlaneOptions) {
    this.root = path.resolve(rootDir);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.rateLimiter = new VaultSyncRateLimiter(options?.rateLimits);
    this.objectStore = options?.objectStore ?? new FileVaultSyncObjectStore(this.root);
    this.metadataPrimary = options?.metadataPrimary ?? "file";
    this.metadataMirror = options?.sql ? new VaultSyncPostgresMetadataMirror(options.sql) : null;
    if (this.metadataPrimary === "postgres" && !this.metadataMirror) {
      throw new Error(
        "OPENBOT_VAULT_SYNC_METADATA_PRIMARY=postgres requires OPENBOT_VAULT_SYNC_DATABASE_URL (or sql option)",
      );
    }
  }

  getMetadataPrimary(): VaultSyncMetadataPrimary {
    return this.metadataPrimary;
  }

  /** Await pending Postgres primary writes (no-op when primary=file / mirror unset). */
  async flushMetadataPrimary(): Promise<void> {
    const batch = this.pendingPrimaryWrites;
    this.pendingPrimaryWrites = [];
    if (batch.length === 0) {
      return;
    }
    await Promise.all(batch);
  }

  getObjectStore(): VaultSyncObjectStore {
    return this.objectStore;
  }

  getRateLimiter(): VaultSyncRateLimiter {
    return this.rateLimiter;
  }

  getDirectPutMaxBytes(): number {
    return VAULT_SYNC_DIRECT_PUT_MAX_BYTES;
  }

  private vaultDir(vaultId: string): string {
    return path.join(this.root, "vaults", vaultId);
  }

  private readJson<T>(file: string, fallback: T): T {
    if (!fs.existsSync(file)) {
      return fallback;
    }
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  private writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  createVault(params: {
    ownerAccountId: string;
    mode?: VaultRecord["mode"];
    saltB64: string;
    kdfParams?: VaultRecord["kdfParams"];
    quotaBytes?: number;
    teamEnabled?: boolean;
  }): VaultRecord {
    const vaultId = randomUUID();
    const record: VaultRecord = {
      vaultId,
      ownerAccountId: params.ownerAccountId,
      mode: params.mode ?? "e2ee_private",
      protocolVersion: VAULT_SYNC_PROTOCOL_VERSION,
      encryptionVersion: VAULT_SYNC_ENCRYPTION_VERSION,
      saltB64: params.saltB64,
      kdfParams: params.kdfParams ?? DEFAULT_SCRYPT_PARAMS,
      quotaBytes: params.quotaBytes ?? 5 * 1024 * 1024 * 1024,
      usageBytes: 0,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      teamEnabled: Boolean(params.teamEnabled),
    };
    this.writeJson(path.join(this.vaultDir(vaultId), "vault.json"), record);
    this.writeJson(path.join(this.vaultDir(vaultId), "revisions.json"), [] as FileRevision[]);
    this.writeJson(path.join(this.vaultDir(vaultId), "heads.json"), {} as Record<string, string[]>);
    this.writeJson(path.join(this.vaultDir(vaultId), "devices.json"), [] as VaultDeviceRecord[]);
    this.writeJson(path.join(this.vaultDir(vaultId), "blobs.json"), [] as BlobRecord[]);
    this.writeJson(path.join(this.vaultDir(vaultId), "members.json"), [] as VaultMemberRecord[]);
    this.writeJson(path.join(this.vaultDir(vaultId), "invites.json"), [] as VaultInviteRecord[]);
    this.writeJson(
      path.join(this.vaultDir(vaultId), "idempotency.json"),
      {} as Record<string, string>,
    );
    this.mirrorVault(record);
    return record;
  }

  getVault(vaultId: string): VaultRecord | null {
    const record = this.readJson<VaultRecord | null>(
      path.join(this.vaultDir(vaultId), "vault.json"),
      null,
    );
    if (!record || record.deletedAt) {
      return null;
    }
    return record;
  }

  listVaults(ownerAccountId: string): VaultRecord[] {
    const base = path.join(this.root, "vaults");
    if (!fs.existsSync(base)) {
      return [];
    }
    return fs
      .readdirSync(base)
      .map((id) => this.getVault(id))
      .filter((v): v is VaultRecord => Boolean(v && v.ownerAccountId === ownerAccountId));
  }

  registerDevice(params: {
    vaultId: string;
    deviceId: string;
    platform: string;
  }): VaultDeviceRecord {
    const vault = this.getVault(params.vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    const file = path.join(this.vaultDir(params.vaultId), "devices.json");
    const devices = this.readJson<VaultDeviceRecord[]>(file, []);
    const existing = devices.find((d) => d.deviceId === params.deviceId);
    if (existing) {
      if (existing.status === "revoked") {
        throw new Error("device revoked");
      }
      return existing;
    }
    const device: VaultDeviceRecord = {
      vaultId: params.vaultId,
      deviceId: params.deviceId,
      platform: params.platform,
      lastSequence: 0,
      cursorRevisionId: null,
      status: "active",
      registeredAt: new Date().toISOString(),
      revokedAt: null,
    };
    devices.push(device);
    this.writeJson(file, devices);
    this.mirrorDevice(device);
    return device;
  }

  listDevices(vaultId: string): VaultDeviceRecord[] {
    if (!this.getVault(vaultId)) {
      throw new Error("vault not found");
    }
    return this.readJson<VaultDeviceRecord[]>(
      path.join(this.vaultDir(vaultId), "devices.json"),
      [],
    );
  }

  revokeDevice(vaultId: string, deviceId: string): VaultDeviceRecord {
    if (!this.getVault(vaultId)) {
      throw new Error("vault not found");
    }
    const file = path.join(this.vaultDir(vaultId), "devices.json");
    const devices = this.readJson<VaultDeviceRecord[]>(file, []);
    const device = devices.find((d) => d.deviceId === deviceId);
    if (!device) {
      throw new Error("device not found");
    }
    if (device.status === "revoked") {
      return device;
    }
    device.status = "revoked";
    device.revokedAt = new Date().toISOString();
    this.writeJson(file, devices);
    this.mirrorDevice(device);
    this.appendAuditEvent(vaultId, {
      eventType: "device_revoked",
      deviceId,
      at: device.revokedAt,
    });
    return device;
  }

  private membersFile(vaultId: string): string {
    return path.join(this.vaultDir(vaultId), "members.json");
  }

  private invitesFile(vaultId: string): string {
    return path.join(this.vaultDir(vaultId), "invites.json");
  }

  listMembers(vaultId: string): VaultMemberRecord[] {
    if (!this.getVault(vaultId)) {
      throw new Error("vault not found");
    }
    return this.readJson<VaultMemberRecord[]>(this.membersFile(vaultId), []);
  }

  getMember(vaultId: string, memberAccountId: string): VaultMemberRecord | null {
    return this.listMembers(vaultId).find((m) => m.memberAccountId === memberAccountId) ?? null;
  }

  assertActiveMember(vaultId: string, accountId: string): VaultMemberRecord {
    const vault = this.getVault(vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    if (!vault.teamEnabled) {
      if (vault.ownerAccountId === accountId) {
        return {
          vaultId,
          memberAccountId: accountId,
          role: "owner",
          status: "active",
          publicKeyB64: "",
          ephemeralPublicKeyB64: null,
          wrappedBaseKeyB64: null,
          keyEpoch: vault.encryptionVersion,
          joinedAt: vault.createdAt,
          revokedAt: null,
        };
      }
      throw new Error("not a vault member");
    }
    const member = this.getMember(vaultId, accountId);
    if (!member || member.status !== "active") {
      throw new Error("not a vault member");
    }
    return member;
  }

  private assertCanManageMembers(vaultId: string, actorAccountId: string): VaultMemberRecord {
    const actor = this.assertActiveMember(vaultId, actorAccountId);
    if (actor.role !== "owner" && actor.role !== "admin") {
      throw new Error("forbidden");
    }
    return actor;
  }

  /**
   * Enable team mode and upsert the owner member with an X25519 wrap package.
   * BaseKey never touches the server — only the wrapped package.
   */
  enableTeamWithOwner(params: {
    vaultId: string;
    ownerAccountId: string;
    publicKeyB64: string;
    ephemeralPublicKeyB64: string;
    wrappedBaseKeyB64: string;
    keyEpoch?: number;
  }): VaultMemberRecord {
    const vault = this.getVault(params.vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    if (vault.ownerAccountId !== params.ownerAccountId) {
      throw new Error("forbidden");
    }
    vault.teamEnabled = true;
    this.writeJson(path.join(this.vaultDir(params.vaultId), "vault.json"), vault);
    const keyEpoch = params.keyEpoch ?? vault.encryptionVersion;
    const members = this.readJson<VaultMemberRecord[]>(this.membersFile(params.vaultId), []);
    const existing = members.find((m) => m.memberAccountId === params.ownerAccountId);
    const now = new Date().toISOString();
    const owner: VaultMemberRecord = {
      vaultId: params.vaultId,
      memberAccountId: params.ownerAccountId,
      role: "owner",
      status: "active",
      publicKeyB64: params.publicKeyB64,
      ephemeralPublicKeyB64: params.ephemeralPublicKeyB64,
      wrappedBaseKeyB64: params.wrappedBaseKeyB64,
      keyEpoch,
      joinedAt: existing?.joinedAt ?? now,
      revokedAt: null,
    };
    const next = existing
      ? members.map((m) => (m.memberAccountId === params.ownerAccountId ? owner : m))
      : [...members, owner];
    this.writeJson(this.membersFile(params.vaultId), next);
    this.appendAuditEvent(params.vaultId, {
      eventType: "team_enabled",
      ownerAccountId: params.ownerAccountId,
      at: now,
    });
    return owner;
  }

  createInvite(params: {
    vaultId: string;
    invitedByAccountId: string;
    role?: VaultMemberRole;
    inviteeAccountId?: string | null;
    inviteSaltB64: string;
    wrappedBaseKeyB64: string;
    /** Client-generated so invite wrap AAD can bind inviteId before upload. */
    inviteId?: string;
    ttlMs?: number;
  }): VaultInviteRecord {
    const vault = this.getVault(params.vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    if (!vault.teamEnabled) {
      throw new Error("team not enabled");
    }
    this.assertCanManageMembers(params.vaultId, params.invitedByAccountId);
    const role = params.role ?? "member";
    if (role === "owner") {
      throw new Error("cannot invite owner");
    }
    const inviteId = params.inviteId?.trim() || randomUUID();
    if (this.getInvite(params.vaultId, inviteId)) {
      throw new Error("invite already exists");
    }
    const now = Date.now();
    const ttlMs = params.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
    const invite: VaultInviteRecord = {
      vaultId: params.vaultId,
      inviteId,
      invitedByAccountId: params.invitedByAccountId,
      inviteeAccountId: params.inviteeAccountId ?? null,
      role,
      inviteSaltB64: params.inviteSaltB64,
      wrappedBaseKeyB64: params.wrappedBaseKeyB64,
      keyEpoch: vault.encryptionVersion,
      status: "pending",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      acceptedByAccountId: null,
    };
    const invites = this.readJson<VaultInviteRecord[]>(this.invitesFile(params.vaultId), []);
    invites.push(invite);
    this.writeJson(this.invitesFile(params.vaultId), invites);
    this.appendAuditEvent(params.vaultId, {
      eventType: "member_invited",
      inviteId,
      role,
      at: invite.createdAt,
    });
    return invite;
  }

  listInvites(vaultId: string): VaultInviteRecord[] {
    if (!this.getVault(vaultId)) {
      throw new Error("vault not found");
    }
    return this.readJson<VaultInviteRecord[]>(this.invitesFile(vaultId), []);
  }

  getInvite(vaultId: string, inviteId: string): VaultInviteRecord | null {
    return this.listInvites(vaultId).find((i) => i.inviteId === inviteId) ?? null;
  }

  revokeInvite(params: {
    vaultId: string;
    inviteId: string;
    actorAccountId: string;
  }): VaultInviteRecord {
    this.assertCanManageMembers(params.vaultId, params.actorAccountId);
    const invites = this.readJson<VaultInviteRecord[]>(this.invitesFile(params.vaultId), []);
    const invite = invites.find((i) => i.inviteId === params.inviteId);
    if (!invite) {
      throw new Error("invite not found");
    }
    if (invite.status !== "pending") {
      return invite;
    }
    invite.status = "revoked";
    this.writeJson(this.invitesFile(params.vaultId), invites);
    this.appendAuditEvent(params.vaultId, {
      eventType: "invite_revoked",
      inviteId: params.inviteId,
      at: new Date().toISOString(),
    });
    return invite;
  }

  /**
   * Accept invite: client unwraps invite package locally, then uploads member wrap.
   * Server never sees inviteSecret or BaseKey.
   */
  acceptInvite(params: {
    vaultId: string;
    inviteId: string;
    memberAccountId: string;
    publicKeyB64: string;
    ephemeralPublicKeyB64: string;
    wrappedBaseKeyB64: string;
  }): VaultMemberRecord {
    const vault = this.getVault(params.vaultId);
    if (!vault?.teamEnabled) {
      throw new Error("team not enabled");
    }
    const invites = this.readJson<VaultInviteRecord[]>(this.invitesFile(params.vaultId), []);
    const invite = invites.find((i) => i.inviteId === params.inviteId);
    if (!invite) {
      throw new Error("invite not found");
    }
    if (invite.status !== "pending") {
      throw new Error("invite not pending");
    }
    if (Date.parse(invite.expiresAt) < Date.now()) {
      invite.status = "expired";
      this.writeJson(this.invitesFile(params.vaultId), invites);
      throw new Error("invite expired");
    }
    if (invite.inviteeAccountId && invite.inviteeAccountId !== params.memberAccountId) {
      throw new Error("invite targeted to another account");
    }
    const existing = this.getMember(params.vaultId, params.memberAccountId);
    if (existing?.status === "active") {
      throw new Error("already a member");
    }
    const now = new Date().toISOString();
    const member: VaultMemberRecord = {
      vaultId: params.vaultId,
      memberAccountId: params.memberAccountId,
      role: invite.role,
      status: "active",
      publicKeyB64: params.publicKeyB64,
      ephemeralPublicKeyB64: params.ephemeralPublicKeyB64,
      wrappedBaseKeyB64: params.wrappedBaseKeyB64,
      keyEpoch: invite.keyEpoch,
      joinedAt: now,
      revokedAt: null,
    };
    const members = this.readJson<VaultMemberRecord[]>(this.membersFile(params.vaultId), []).filter(
      (m) => m.memberAccountId !== params.memberAccountId,
    );
    members.push(member);
    this.writeJson(this.membersFile(params.vaultId), members);
    invite.status = "accepted";
    invite.acceptedByAccountId = params.memberAccountId;
    this.writeJson(this.invitesFile(params.vaultId), invites);
    this.appendAuditEvent(params.vaultId, {
      eventType: "member_joined",
      memberAccountId: params.memberAccountId,
      inviteId: params.inviteId,
      at: now,
    });
    return member;
  }

  revokeMember(params: {
    vaultId: string;
    memberAccountId: string;
    actorAccountId: string;
  }): VaultMemberRecord {
    this.assertCanManageMembers(params.vaultId, params.actorAccountId);
    if (params.memberAccountId === params.actorAccountId) {
      throw new Error("cannot revoke self");
    }
    const members = this.readJson<VaultMemberRecord[]>(this.membersFile(params.vaultId), []);
    const member = members.find((m) => m.memberAccountId === params.memberAccountId);
    if (!member) {
      throw new Error("member not found");
    }
    if (member.role === "owner") {
      throw new Error("cannot revoke owner");
    }
    if (member.status === "revoked") {
      return member;
    }
    member.status = "revoked";
    member.revokedAt = new Date().toISOString();
    member.wrappedBaseKeyB64 = null;
    member.ephemeralPublicKeyB64 = null;
    this.writeJson(this.membersFile(params.vaultId), members);
    this.appendAuditEvent(params.vaultId, {
      eventType: "member_revoked",
      memberAccountId: params.memberAccountId,
      at: member.revokedAt,
    });
    return member;
  }

  revokeMemberAndRotateEpoch(params: {
    vaultId: string;
    memberAccountId: string;
    actorAccountId: string;
    expectedCurrentEncryptionVersion: number;
    wraps: Array<{
      memberAccountId: string;
      ephemeralPublicKeyB64: string;
      wrappedBaseKeyB64: string;
    }>;
  }): {
    revoked: VaultMemberRecord;
    encryptionVersion: number;
    members: VaultMemberRecord[];
  } {
    // Validate CAS before any mutation so a version conflict cannot leave a
    // half-applied revoke behind.
    const current = this.getVault(params.vaultId);
    if (!current) {
      throw new Error("vault not found");
    }
    if (params.expectedCurrentEncryptionVersion !== current.encryptionVersion) {
      throw new Error("encryption version conflict");
    }
    this.revokeMember({
      vaultId: params.vaultId,
      memberAccountId: params.memberAccountId,
      actorAccountId: params.actorAccountId,
    });
    const vault = this.bumpEncryptionVersion(params.vaultId, {
      expectedCurrent: params.expectedCurrentEncryptionVersion,
    });
    const members = this.rotateMemberWraps({
      vaultId: params.vaultId,
      actorAccountId: params.actorAccountId,
      keyEpoch: vault.encryptionVersion,
      wraps: params.wraps,
    });
    const membersAll = this.readJson<VaultMemberRecord[]>(this.membersFile(params.vaultId), []);
    const revoked = membersAll.find((m) => m.memberAccountId === params.memberAccountId);
    if (!revoked) {
      throw new Error("member not found after revoke");
    }
    this.appendAuditEvent(params.vaultId, {
      eventType: "member_revoked_and_rotated",
      memberAccountId: params.memberAccountId,
      encryptionVersion: vault.encryptionVersion,
      at: new Date().toISOString(),
    });
    return {
      revoked,
      encryptionVersion: vault.encryptionVersion,
      members,
    };
  }

  /**
   * Replace wrap packages for active members (after revoke or epoch bump).
   * Client supplies wraps; server stores ciphertext only.
   */
  rotateMemberWraps(params: {
    vaultId: string;
    actorAccountId: string;
    keyEpoch: number;
    wraps: Array<{
      memberAccountId: string;
      ephemeralPublicKeyB64: string;
      wrappedBaseKeyB64: string;
    }>;
  }): VaultMemberRecord[] {
    const vault = this.getVault(params.vaultId);
    if (!vault?.teamEnabled) {
      throw new Error("team not enabled");
    }
    this.assertCanManageMembers(params.vaultId, params.actorAccountId);
    if (params.keyEpoch !== vault.encryptionVersion) {
      throw new Error("encryption version mismatch");
    }
    const members = this.readJson<VaultMemberRecord[]>(this.membersFile(params.vaultId), []);
    const activeIds = new Set(
      members.filter((m) => m.status === "active").map((m) => m.memberAccountId),
    );
    for (const wrap of params.wraps) {
      if (!activeIds.has(wrap.memberAccountId)) {
        throw new Error(`member not active: ${wrap.memberAccountId}`);
      }
    }
    const byId = new Map(params.wraps.map((w) => [w.memberAccountId, w]));
    for (const member of members) {
      if (member.status !== "active") {
        continue;
      }
      const wrap = byId.get(member.memberAccountId);
      if (!wrap) {
        throw new Error(`missing wrap for ${member.memberAccountId}`);
      }
      member.ephemeralPublicKeyB64 = wrap.ephemeralPublicKeyB64;
      member.wrappedBaseKeyB64 = wrap.wrappedBaseKeyB64;
      member.keyEpoch = params.keyEpoch;
    }
    this.writeJson(this.membersFile(params.vaultId), members);
    this.appendAuditEvent(params.vaultId, {
      eventType: "member_wraps_rotated",
      keyEpoch: params.keyEpoch,
      count: params.wraps.length,
      at: new Date().toISOString(),
    });
    return members.filter((m) => m.status === "active");
  }

  /**
   * Bump vault encryptionVersion epoch. Does not re-encrypt history —
   * old revisions remain readable under their stored encryptionVersion;
   * new commits must use the bumped version.
   */
  bumpEncryptionVersion(vaultId: string, opts?: { expectedCurrent?: number }): VaultRecord {
    const vault = this.getVault(vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    if (
      typeof opts?.expectedCurrent === "number" &&
      opts.expectedCurrent !== vault.encryptionVersion
    ) {
      throw new Error("encryption version conflict");
    }
    const next = vault.encryptionVersion + 1;
    vault.encryptionVersion = next;
    this.writeJson(path.join(this.vaultDir(vaultId), "vault.json"), vault);
    this.appendAuditEvent(vaultId, {
      eventType: "encryption_version_bumped",
      encryptionVersion: next,
      at: new Date().toISOString(),
    });
    this.mirrorVault(vault);
    return vault;
  }

  listAuditEvents(vaultId: string): Array<Record<string, unknown>> {
    return this.readJson(path.join(this.vaultDir(vaultId), "audit.json"), []);
  }

  private appendAuditEvent(vaultId: string, event: Record<string, unknown>): void {
    const file = path.join(this.vaultDir(vaultId), "audit.json");
    const events = this.readJson<Array<Record<string, unknown>>>(file, []);
    events.push(event);
    this.writeJson(file, events);
  }

  setQuota(vaultId: string, quotaBytes: number): VaultRecord {
    const vault = this.getVault(vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    if (!Number.isFinite(quotaBytes) || quotaBytes < 0) {
      throw new Error("invalid quota");
    }
    vault.quotaBytes = Math.floor(quotaBytes);
    this.writeJson(path.join(this.vaultDir(vaultId), "vault.json"), vault);
    this.mirrorVault(vault);
    return vault;
  }

  getQuotaStatus(vaultId: string): VaultQuotaStatus {
    const vault = this.getVault(vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    const pendingUploadBytes = this.sumPendingUploadBytes(vaultId);
    const availableBytes = Math.max(0, vault.quotaBytes - vault.usageBytes - pendingUploadBytes);
    return {
      vaultId,
      quotaBytes: vault.quotaBytes,
      usageBytes: vault.usageBytes,
      pendingUploadBytes,
      availableBytes,
    };
  }

  private sumPendingUploadBytes(vaultId: string): number {
    const base = path.join(this.vaultDir(vaultId), "uploads");
    if (!fs.existsSync(base)) {
      return 0;
    }
    let sum = 0;
    for (const name of fs.readdirSync(base)) {
      const session = this.getUploadSession(vaultId, name);
      if (session?.status === "open") {
        sum += session.totalSizeBytes;
      }
    }
    return sum;
  }

  private assertQuotaAvailable(vaultId: string, additionalBytes: number): void {
    const status = this.getQuotaStatus(vaultId);
    if (additionalBytes > status.availableBytes) {
      this.appendAuditEvent(vaultId, {
        eventType: "quota_exceeded",
        additionalBytes,
        availableBytes: status.availableBytes,
        at: new Date().toISOString(),
      });
      throw new Error("quota exceeded");
    }
  }

  private uploadDir(vaultId: string, uploadId: string): string {
    return path.join(this.vaultDir(vaultId), "uploads", uploadId);
  }

  private readUploadMeta(vaultId: string, uploadId: string): BlobUploadSession | null {
    return this.readJson<BlobUploadSession | null>(
      path.join(this.uploadDir(vaultId, uploadId), "meta.json"),
      null,
    );
  }

  private writeUploadMeta(session: BlobUploadSession): void {
    this.writeJson(
      path.join(this.uploadDir(session.vaultId, session.uploadId), "meta.json"),
      session,
    );
  }

  getUploadSession(vaultId: string, uploadId: string): BlobUploadSession | null {
    return this.readUploadMeta(vaultId, uploadId);
  }

  createUploadSession(params: {
    vaultId: string;
    deviceId: string;
    ciphertextHash: string;
    totalSizeBytes: number;
    chunkSize?: number;
  }): BlobUploadSession {
    const vault = this.getVault(params.vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    const device = this.getDevice(params.vaultId, params.deviceId);
    if (!device || device.status !== "active") {
      throw new Error("device not active");
    }
    this.rateLimiter.check("uploadSessionPerWindow", `${params.vaultId}:${params.deviceId}`);

    const totalSizeBytes = Math.floor(params.totalSizeBytes);
    if (!Number.isFinite(totalSizeBytes) || totalSizeBytes <= 0) {
      throw new Error("invalid totalSizeBytes");
    }
    const hash = params.ciphertextHash.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error("invalid ciphertextHash");
    }
    let chunkSize = Math.floor(params.chunkSize ?? VAULT_SYNC_DEFAULT_CHUNK_SIZE);
    if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
      chunkSize = VAULT_SYNC_DEFAULT_CHUNK_SIZE;
    }
    chunkSize = Math.min(Math.max(chunkSize, 1024), VAULT_SYNC_MAX_CHUNK_SIZE);

    this.assertQuotaAvailable(params.vaultId, totalSizeBytes);

    const chunkCount = Math.ceil(totalSizeBytes / chunkSize);
    const uploadId = randomUUID();
    const now = new Date().toISOString();
    const session: BlobUploadSession = {
      uploadId,
      vaultId: params.vaultId,
      deviceId: params.deviceId,
      ciphertextHash: hash,
      totalSizeBytes,
      chunkSize,
      chunkCount,
      receivedChunkIndexes: [],
      status: "open",
      createdAt: now,
      updatedAt: now,
      completedBlobId: null,
      httpUploadToken: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
      objectUploadBlobId:
        typeof this.objectStore.createPresignedPut === "function" ? uploadId : null,
    };
    fs.mkdirSync(this.uploadDir(params.vaultId, uploadId), { recursive: true, mode: 0o700 });
    this.writeUploadMeta(session);
    return session;
  }

  putUploadChunk(params: {
    vaultId: string;
    uploadId: string;
    chunkIndex: number;
    data: Buffer;
  }): BlobUploadSession {
    const session = this.readUploadMeta(params.vaultId, params.uploadId);
    if (!session) {
      throw new Error("upload session not found");
    }
    if (session.status !== "open") {
      throw new Error("upload session not open");
    }
    const device = this.getDevice(session.vaultId, session.deviceId);
    if (!device || device.status !== "active") {
      throw new Error("device not active");
    }
    this.rateLimiter.check("putChunkPerWindow", `${session.vaultId}:${session.deviceId}`);

    const index = Math.floor(params.chunkIndex);
    if (!Number.isFinite(index) || index < 0 || index >= session.chunkCount) {
      throw new Error("invalid chunkIndex");
    }
    const expectedSize =
      index === session.chunkCount - 1
        ? session.totalSizeBytes - session.chunkSize * (session.chunkCount - 1)
        : session.chunkSize;
    if (params.data.length !== expectedSize) {
      throw new Error("chunk size mismatch");
    }

    const chunkPath = path.join(
      this.uploadDir(session.vaultId, session.uploadId),
      `chunk-${index}.bin`,
    );
    // Idempotent resume: rewriting the same chunk index is allowed.
    fs.writeFileSync(chunkPath, params.data, { mode: 0o600 });
    if (!session.receivedChunkIndexes.includes(index)) {
      session.receivedChunkIndexes = [...session.receivedChunkIndexes, index].toSorted(
        (a, b) => a - b,
      );
    }
    session.updatedAt = new Date().toISOString();
    this.writeUploadMeta(session);
    return session;
  }

  completeUploadSession(params: { vaultId: string; uploadId: string }): BlobRecord {
    const session = this.readUploadMeta(params.vaultId, params.uploadId);
    if (!session) {
      throw new Error("upload session not found");
    }
    if (session.status === "completed" && session.completedBlobId) {
      const existing = this.getBlobRecord(session.vaultId, session.completedBlobId);
      if (existing) {
        return existing;
      }
    }
    if (session.status !== "open") {
      throw new Error("upload session not open");
    }
    if (session.receivedChunkIndexes.length !== session.chunkCount) {
      throw new Error("upload incomplete");
    }
    for (let i = 0; i < session.chunkCount; i++) {
      if (!session.receivedChunkIndexes.includes(i)) {
        throw new Error("upload incomplete");
      }
    }

    const parts: Buffer[] = [];
    for (let i = 0; i < session.chunkCount; i++) {
      const chunkPath = path.join(
        this.uploadDir(session.vaultId, session.uploadId),
        `chunk-${i}.bin`,
      );
      if (!fs.existsSync(chunkPath)) {
        throw new Error("upload incomplete");
      }
      parts.push(fs.readFileSync(chunkPath));
    }
    const ciphertext = Buffer.concat(parts);
    if (ciphertext.length !== session.totalSizeBytes) {
      throw new Error("ciphertext size mismatch");
    }
    const actual = createHash("sha256").update(ciphertext).digest("hex");
    if (actual !== session.ciphertextHash) {
      throw new Error("ciphertext hash mismatch");
    }

    // Session already reserved quota via pending; finalize without re-checking pending for this size.
    // Temporarily mark aborted so pending drops, then putBlob checks usage only...
    // Better: internal put without rate/pending double-count.
    const record = this.finalizeBlobWrite({
      vaultId: session.vaultId,
      ciphertext,
      ciphertextHash: session.ciphertextHash,
      skipQuotaCheck: true,
    });

    session.status = "completed";
    session.completedBlobId = record.blobId;
    session.updatedAt = new Date().toISOString();
    this.writeUploadMeta(session);
    // Best-effort cleanup of chunk files (keep meta for audit/idempotent complete).
    for (let i = 0; i < session.chunkCount; i++) {
      try {
        fs.unlinkSync(
          path.join(this.uploadDir(session.vaultId, session.uploadId), `chunk-${i}.bin`),
        );
      } catch {
        // ignore
      }
    }
    return record;
  }

  async completeUploadSessionAsync(params: {
    vaultId: string;
    uploadId: string;
  }): Promise<BlobRecord> {
    const session = this.readUploadMeta(params.vaultId, params.uploadId);
    if (!session) {
      throw new Error("upload session not found");
    }
    if (session.status === "completed" && session.completedBlobId) {
      const existing = this.getBlobRecord(session.vaultId, session.completedBlobId);
      if (existing) {
        return existing;
      }
    }
    const objectBlobId = session.objectUploadBlobId?.trim();
    if (objectBlobId && typeof this.objectStore.getAsync === "function") {
      if (session.status !== "open") {
        throw new Error("upload session not open");
      }
      const storageKey =
        typeof this.objectStore.buildStorageKey === "function"
          ? this.objectStore.buildStorageKey(session.vaultId, objectBlobId)
          : `${session.vaultId}/${objectBlobId}`;
      const ciphertext = await this.objectStore.getAsync({
        vaultId: session.vaultId,
        storageKey,
      });
      if (!ciphertext || ciphertext.length !== session.totalSizeBytes) {
        throw new Error("upload incomplete");
      }
      const actual = createHash("sha256").update(ciphertext).digest("hex");
      if (actual !== session.ciphertextHash) {
        throw new Error("ciphertext hash mismatch");
      }
      // Object already resides at the presigned key; register blob metadata without re-put.
      const vault = this.getVault(session.vaultId);
      if (!vault) {
        throw new Error("vault not found");
      }
      if (vault.usageBytes + ciphertext.length > vault.quotaBytes) {
        throw new Error("quota exceeded");
      }
      const record: BlobRecord = {
        blobId: objectBlobId,
        vaultId: session.vaultId,
        sizeBytes: ciphertext.length,
        ciphertextHash: session.ciphertextHash,
        storageKey,
        createdAt: new Date().toISOString(),
      };
      const blobsFile = path.join(this.vaultDir(session.vaultId), "blobs.json");
      const blobs = this.readJson<BlobRecord[]>(blobsFile, []);
      blobs.push(record);
      this.writeJson(blobsFile, blobs);
      vault.usageBytes += ciphertext.length;
      this.writeJson(path.join(this.vaultDir(session.vaultId), "vault.json"), vault);
      this.mirrorVault(vault);
      this.mirrorBlob(record);
      session.status = "completed";
      session.completedBlobId = record.blobId;
      session.updatedAt = new Date().toISOString();
      this.writeUploadMeta(session);
      return record;
    }
    return this.completeUploadSession(params);
  }

  abortUploadSession(params: { vaultId: string; uploadId: string }): BlobUploadSession {
    const session = this.readUploadMeta(params.vaultId, params.uploadId);
    if (!session) {
      throw new Error("upload session not found");
    }
    if (session.status === "completed") {
      throw new Error("upload session already completed");
    }
    session.status = "aborted";
    session.updatedAt = new Date().toISOString();
    this.writeUploadMeta(session);
    const dir = this.uploadDir(session.vaultId, session.uploadId);
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith("chunk-")) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {
          // ignore
        }
      }
    }
    return session;
  }

  private getBlobRecord(vaultId: string, blobId: string): BlobRecord | null {
    const blobs = this.readJson<BlobRecord[]>(path.join(this.vaultDir(vaultId), "blobs.json"), []);
    return blobs.find((b) => b.blobId === blobId) ?? null;
  }

  private finalizeBlobWrite(params: {
    vaultId: string;
    ciphertext: Buffer;
    ciphertextHash: string;
    skipQuotaCheck?: boolean;
  }): BlobRecord {
    const vault = this.getVault(params.vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    if (!params.skipQuotaCheck) {
      this.assertQuotaAvailable(params.vaultId, params.ciphertext.length);
    } else if (vault.usageBytes + params.ciphertext.length > vault.quotaBytes) {
      // Absolute hard cap even if pending accounting drifted.
      throw new Error("quota exceeded");
    }
    const expected = params.ciphertextHash.toLowerCase();
    const actual = createHash("sha256").update(params.ciphertext).digest("hex");
    if (actual !== expected) {
      throw new Error("ciphertext hash mismatch");
    }
    const blobId = randomUUID();
    const putResult = this.objectStore.put({
      vaultId: params.vaultId,
      blobId,
      ciphertext: params.ciphertext,
    });
    if (putResult instanceof Promise) {
      throw new Error("object store put must be synchronous");
    }
    const record: BlobRecord = {
      blobId,
      vaultId: params.vaultId,
      sizeBytes: params.ciphertext.length,
      ciphertextHash: expected,
      storageKey: putResult.storageKey,
      createdAt: new Date().toISOString(),
    };
    const blobsFile = path.join(this.vaultDir(params.vaultId), "blobs.json");
    const blobs = this.readJson<BlobRecord[]>(blobsFile, []);
    blobs.push(record);
    this.writeJson(blobsFile, blobs);
    vault.usageBytes += params.ciphertext.length;
    this.writeJson(path.join(this.vaultDir(params.vaultId), "vault.json"), vault);
    this.mirrorVault(vault);
    this.mirrorBlob(record);
    return record;
  }

  putBlob(params: {
    vaultId: string;
    deviceId?: string;
    ciphertext: Buffer;
    ciphertextHash: string;
  }): BlobRecord {
    const vault = this.getVault(params.vaultId);
    if (!vault) {
      throw new Error("vault not found");
    }
    if (params.deviceId) {
      this.rateLimiter.check("putBlobPerWindow", `${params.vaultId}:${params.deviceId}`);
    }
    if (params.ciphertext.length > VAULT_SYNC_DIRECT_PUT_MAX_BYTES) {
      throw new Error("blob too large for direct put; use upload session");
    }
    return this.finalizeBlobWrite({
      vaultId: params.vaultId,
      ciphertext: params.ciphertext,
      ciphertextHash: params.ciphertextHash,
    });
  }

  getBlob(vaultId: string, blobId: string): Buffer | null {
    const blobs = this.readJson<BlobRecord[]>(path.join(this.vaultDir(vaultId), "blobs.json"), []);
    const record = blobs.find((b) => b.blobId === blobId);
    if (!record) {
      return null;
    }
    const data = this.objectStore.get({ vaultId, storageKey: record.storageKey });
    if (data instanceof Promise) {
      throw new Error("object store get must be synchronous");
    }
    return data;
  }

  getRevision(vaultId: string, revisionId: string): FileRevision | null {
    const revisions = this.readJson<FileRevision[]>(
      path.join(this.vaultDir(vaultId), "revisions.json"),
      [],
    );
    return revisions.find((r) => r.revisionId === revisionId) ?? null;
  }

  /**
   * Inventory heads whose latest revision is a tombstone (soft-deleted paths).
   * Still opaque — no plaintext paths.
   */
  getTrashPage(vaultId: string, cursor: string | null, limit = 500): InventoryPage {
    const inventory = this.getInventoryPage(vaultId, null, 10_000);
    const trashed = inventory.items.filter((item) => item.tombstone);
    const pageLimit = Math.min(Math.max(limit, 1), 2000);
    let start = 0;
    if (cursor) {
      const exact = trashed.findIndex((item) => item.opaquePathId === cursor);
      start = exact >= 0 ? exact + 1 : trashed.findIndex((item) => item.opaquePathId > cursor);
      if (start < 0) {
        start = trashed.length;
      }
    }
    const slice = trashed.slice(start, start + pageLimit);
    const hasMore = start + pageLimit < trashed.length;
    return {
      items: slice,
      nextCursor: hasMore ? (slice.at(-1)?.opaquePathId ?? null) : null,
      truncated: hasMore,
    };
  }

  getDevice(vaultId: string, deviceId: string): VaultDeviceRecord | null {
    const devices = this.readJson<VaultDeviceRecord[]>(
      path.join(this.vaultDir(vaultId), "devices.json"),
      [],
    );
    return devices.find((d) => d.deviceId === deviceId) ?? null;
  }

  private isAncestor(
    revisions: FileRevision[],
    ancestorId: string,
    descendantId: string,
    seen = new Set<string>(),
  ): boolean {
    if (ancestorId === descendantId) {
      return true;
    }
    if (seen.has(descendantId)) {
      return false;
    }
    seen.add(descendantId);
    const node = revisions.find((r) => r.revisionId === descendantId);
    if (!node) {
      return false;
    }
    return node.parentRevisionIds.some((p) => this.isAncestor(revisions, ancestorId, p, seen));
  }

  commitRevision(params: {
    revision: FileRevision;
    idempotencyKey?: string;
  }): CommitRevisionResult {
    const rev = params.revision;
    const vault = this.getVault(rev.vaultId);
    if (!vault) {
      return {
        status: "rejected",
        revisionId: rev.revisionId,
        conflictGroupId: null,
        heads: [],
        serverReceivedAt: new Date().toISOString(),
        reason: "vault not found",
      };
    }
    if (vault.mode === "e2ee_private" && vault.encryptionVersion < 1) {
      return {
        status: "rejected",
        revisionId: rev.revisionId,
        conflictGroupId: null,
        heads: [],
        serverReceivedAt: new Date().toISOString(),
        reason: "invalid vault",
      };
    }

    if (rev.encryptionVersion !== vault.encryptionVersion) {
      return {
        status: "rejected",
        revisionId: rev.revisionId,
        conflictGroupId: null,
        heads: [],
        serverReceivedAt: new Date().toISOString(),
        reason: "encryption version mismatch",
      };
    }

    const device = this.getDevice(rev.vaultId, rev.deviceId);
    if (!device || device.status !== "active") {
      return {
        status: "rejected",
        revisionId: rev.revisionId,
        conflictGroupId: null,
        heads: [],
        serverReceivedAt: new Date().toISOString(),
        reason: "device not active",
      };
    }

    try {
      this.rateLimiter.check("commitRevisionPerWindow", `${rev.vaultId}:${rev.deviceId}`);
    } catch {
      return {
        status: "rejected",
        revisionId: rev.revisionId,
        conflictGroupId: null,
        heads: [],
        serverReceivedAt: new Date().toISOString(),
        reason: "rate limited",
      };
    }

    const expectedId = computeRevisionId({
      vaultId: rev.vaultId,
      opaquePathId: rev.opaquePathId,
      deviceId: rev.deviceId,
      deviceSequence: rev.deviceSequence,
      ciphertextHash: rev.ciphertextHash,
      parentRevisionIds: rev.parentRevisionIds,
      protocolVersion: rev.protocolVersion,
    });
    if (expectedId !== rev.revisionId) {
      return {
        status: "rejected",
        revisionId: rev.revisionId,
        conflictGroupId: null,
        heads: [],
        serverReceivedAt: new Date().toISOString(),
        reason: "revisionId mismatch",
      };
    }

    const idemFile = path.join(this.vaultDir(rev.vaultId), "idempotency.json");
    const idem = this.readJson<Record<string, string>>(idemFile, {});
    if (params.idempotencyKey && idem[params.idempotencyKey]) {
      const existingId = idem[params.idempotencyKey];
      const headsMap = this.readJson<Record<string, string[]>>(
        path.join(this.vaultDir(rev.vaultId), "heads.json"),
        {},
      );
      return {
        status: "duplicate",
        revisionId: existingId,
        conflictGroupId: null,
        heads: headsMap[rev.opaquePathId] ?? [],
        serverReceivedAt: new Date().toISOString(),
      };
    }

    const revFile = path.join(this.vaultDir(rev.vaultId), "revisions.json");
    const revisions = this.readJson<FileRevision[]>(revFile, []);
    const existing = revisions.find((r) => r.revisionId === rev.revisionId);
    if (existing) {
      const headsMap = this.readJson<Record<string, string[]>>(
        path.join(this.vaultDir(rev.vaultId), "heads.json"),
        {},
      );
      return {
        status: "duplicate",
        revisionId: existing.revisionId,
        conflictGroupId: existing.conflictGroupId ?? null,
        heads: headsMap[rev.opaquePathId] ?? [],
        serverReceivedAt: new Date().toISOString(),
      };
    }

    // deviceSequence must be monotonic per device
    if (rev.deviceSequence <= device.lastSequence) {
      // allow exact replay only when revision already stored (handled above)
      return {
        status: "rejected",
        revisionId: rev.revisionId,
        conflictGroupId: null,
        heads: [],
        serverReceivedAt: new Date().toISOString(),
        reason: "deviceSequence not increasing",
      };
    }

    for (const parentId of rev.parentRevisionIds) {
      if (!revisions.some((r) => r.revisionId === parentId)) {
        return {
          status: "rejected",
          revisionId: rev.revisionId,
          conflictGroupId: null,
          heads: [],
          serverReceivedAt: new Date().toISOString(),
          reason: "unknown parent",
        };
      }
    }

    const headsFile = path.join(this.vaultDir(rev.vaultId), "heads.json");
    const headsMap = this.readJson<Record<string, string[]>>(headsFile, {});
    const currentHeads = [...(headsMap[rev.opaquePathId] ?? [])];

    let conflictGroupId: string | null = null;
    let nextHeads: string[];

    if (currentHeads.length === 0) {
      nextHeads = [rev.revisionId];
    } else if (
      rev.parentRevisionIds.length > 0 &&
      currentHeads.every((h) => rev.parentRevisionIds.includes(h)) &&
      rev.parentRevisionIds.every(
        (p) => currentHeads.includes(p) || this.isAncestor(revisions, p, currentHeads[0]),
      )
    ) {
      // Fast-forward / merge: parents cover current heads
      const covered = currentHeads.every((h) =>
        rev.parentRevisionIds.some(
          (p) => p === h || this.isAncestor(revisions, h, p) || this.isAncestor(revisions, p, h),
        ),
      );
      if (covered && rev.parentRevisionIds.some((p) => currentHeads.includes(p))) {
        nextHeads = [rev.revisionId];
      } else if (currentHeads.every((h) => rev.parentRevisionIds.includes(h))) {
        nextHeads = [rev.revisionId];
      } else {
        conflictGroupId = randomUUID();
        nextHeads = [...new Set([...currentHeads, rev.revisionId])];
      }
    } else if (currentHeads.some((h) => rev.parentRevisionIds.includes(h))) {
      // Replace the parent heads that are referenced; keep unrelated concurrent heads
      const remaining = currentHeads.filter((h) => !rev.parentRevisionIds.includes(h));
      if (remaining.length === 0) {
        nextHeads = [rev.revisionId];
      } else {
        conflictGroupId = randomUUID();
        nextHeads = [...remaining, rev.revisionId];
      }
    } else {
      // Concurrent update vs existing heads
      conflictGroupId = randomUUID();
      nextHeads = [...currentHeads, rev.revisionId];
    }

    const stored: FileRevision = {
      ...rev,
      conflictGroupId,
    };
    revisions.push(stored);
    headsMap[rev.opaquePathId] = nextHeads;
    this.writeJson(revFile, revisions);
    this.writeJson(headsFile, headsMap);

    device.lastSequence = rev.deviceSequence;
    const devices = this.readJson<VaultDeviceRecord[]>(
      path.join(this.vaultDir(rev.vaultId), "devices.json"),
      [],
    );
    const idx = devices.findIndex((d) => d.deviceId === device.deviceId);
    if (idx >= 0) {
      devices[idx] = device;
      this.writeJson(path.join(this.vaultDir(rev.vaultId), "devices.json"), devices);
      this.mirrorDevice(device);
    }

    if (params.idempotencyKey) {
      idem[params.idempotencyKey] = rev.revisionId;
      this.writeJson(idemFile, idem);
    }

    const status = conflictGroupId ? "conflict" : "accepted";
    const serverReceivedAt = new Date().toISOString();
    notifyVaultSyncRevisionsAvailable({
      vaultId: rev.vaultId,
      revisionId: rev.revisionId,
      opaquePathId: rev.opaquePathId,
      sourceDeviceId: rev.deviceId,
      serverReceivedAt,
      status,
    });

    this.mirrorRevision({
      revision: stored,
      serverReceivedAt,
      idempotencyKey: params.idempotencyKey,
      heads: nextHeads,
    });

    return {
      status,
      revisionId: rev.revisionId,
      conflictGroupId,
      heads: nextHeads,
      serverReceivedAt,
    };
  }

  listRevisionsSince(
    vaultId: string,
    sinceCursor: string | null,
    limit = 200,
  ): {
    revisions: FileRevision[];
    nextCursor: string | null;
  } {
    const revisions = this.readJson<FileRevision[]>(
      path.join(this.vaultDir(vaultId), "revisions.json"),
      [],
    );
    const sorted = [...revisions].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
    let start = 0;
    if (sinceCursor) {
      const idx = sorted.findIndex((r) => r.revisionId === sinceCursor);
      start = idx >= 0 ? idx + 1 : 0;
    }
    const slice = sorted.slice(start, start + limit);
    const hasMore = start + limit < sorted.length;
    return {
      revisions: slice,
      nextCursor: hasMore ? (slice.at(-1)?.revisionId ?? null) : null,
    };
  }

  getPathHistory(vaultId: string, opaquePathId: string): FileRevision[] {
    const revisions = this.readJson<FileRevision[]>(
      path.join(this.vaultDir(vaultId), "revisions.json"),
      [],
    );
    return revisions
      .filter((r) => r.opaquePathId === opaquePathId)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getInventoryPage(vaultId: string, cursor: string | null, limit = 500): InventoryPage {
    const pageLimit = Math.min(Math.max(limit, 1), 2000);
    const headsMap = this.readJson<Record<string, string[]>>(
      path.join(this.vaultDir(vaultId), "heads.json"),
      {},
    );
    const revisions = this.readJson<FileRevision[]>(
      path.join(this.vaultDir(vaultId), "revisions.json"),
      [],
    );
    const byId = new Map(revisions.map((r) => [r.revisionId, r]));
    const paths = Object.keys(headsMap).toSorted();
    let start = 0;
    if (cursor) {
      const exact = paths.indexOf(cursor);
      start = exact >= 0 ? exact + 1 : paths.findIndex((p) => p > cursor);
      if (start < 0) {
        start = paths.length;
      }
    }
    const slice = paths.slice(start, start + pageLimit);
    const hasMore = start + pageLimit < paths.length;
    return {
      items: slice.map((opaquePathId) => {
        const heads = headsMap[opaquePathId] ?? [];
        const latestRevisionId = heads[heads.length - 1] ?? "";
        const latest = byId.get(latestRevisionId);
        return {
          opaquePathId,
          heads,
          latestRevisionId,
          tombstone: Boolean(latest?.tombstone),
        };
      }),
      nextCursor: hasMore ? (slice.at(-1) ?? null) : null,
      truncated: hasMore,
    };
  }

  /**
   * Rebuild file-plane vault metadata from Postgres (Wave G cutover recovery).
   * Ciphertext blobs stay in object store; members/invites are not yet in PG schema.
   */
  async hydrateVaultMetadataFromPostgres(vaultId: string): Promise<VaultRecord> {
    if (!this.metadataMirror) {
      throw new Error("postgres metadata client required for hydrate");
    }
    await this.ensureMirrorSchema();
    const vault = await this.metadataMirror.getVault(vaultId);
    if (!vault) {
      throw new Error("vault not found in postgres");
    }
    const [revisions, heads, blobs, devices] = await Promise.all([
      this.metadataMirror.listRevisions(vaultId),
      this.metadataMirror.listHeads(vaultId),
      this.metadataMirror.listBlobs(vaultId),
      this.metadataMirror.listDevices(vaultId),
    ]);
    fs.mkdirSync(this.vaultDir(vaultId), { recursive: true, mode: 0o700 });
    this.writeJson(path.join(this.vaultDir(vaultId), "vault.json"), vault);
    this.writeJson(path.join(this.vaultDir(vaultId), "revisions.json"), revisions);
    this.writeJson(path.join(this.vaultDir(vaultId), "heads.json"), heads);
    this.writeJson(path.join(this.vaultDir(vaultId), "blobs.json"), blobs);
    this.writeJson(path.join(this.vaultDir(vaultId), "devices.json"), devices);
    // Preserve existing team files if present; otherwise empty.
    if (!fs.existsSync(this.membersFile(vaultId))) {
      this.writeJson(this.membersFile(vaultId), [] as VaultMemberRecord[]);
    }
    if (!fs.existsSync(this.invitesFile(vaultId))) {
      this.writeJson(this.invitesFile(vaultId), [] as VaultInviteRecord[]);
    }
    if (!fs.existsSync(path.join(this.vaultDir(vaultId), "audit.json"))) {
      this.writeJson(path.join(this.vaultDir(vaultId), "audit.json"), []);
    }
    return vault;
  }

  private enqueuePrimaryWrite(work: () => Promise<void>): void {
    if (!this.metadataMirror) {
      return;
    }
    const run = (async () => {
      await this.ensureMirrorSchema();
      await work();
    })();
    if (this.metadataPrimary === "postgres") {
      this.pendingPrimaryWrites.push(run);
      return;
    }
    void run.catch(() => {
      // Best-effort mirror — file plane remains authoritative.
    });
  }

  private mirrorVault(vault: VaultRecord): void {
    this.enqueuePrimaryWrite(async () => {
      await this.metadataMirror!.upsertVault(vault);
    });
  }

  private mirrorBlob(blob: BlobRecord): void {
    this.enqueuePrimaryWrite(async () => {
      await this.metadataMirror!.insertBlob(blob);
    });
  }

  private mirrorDevice(device: VaultDeviceRecord): void {
    this.enqueuePrimaryWrite(async () => {
      await this.metadataMirror!.upsertDevice(device);
    });
  }

  private mirrorRevision(params: {
    revision: FileRevision;
    serverReceivedAt: string;
    idempotencyKey?: string;
    heads: string[];
  }): void {
    this.enqueuePrimaryWrite(async () => {
      await this.metadataMirror!.insertRevision({
        revision: params.revision,
        serverReceivedAt: params.serverReceivedAt,
        idempotencyKey: params.idempotencyKey,
      });
      await this.metadataMirror!.replaceHeads(
        params.revision.vaultId,
        params.revision.opaquePathId,
        params.heads,
      );
    });
  }

  private async ensureMirrorSchema(): Promise<void> {
    if (!this.metadataMirror || this.mirrorSchemaReady) {
      return;
    }
    await this.metadataMirror.ensureSchema();
    this.mirrorSchemaReady = true;
  }
}

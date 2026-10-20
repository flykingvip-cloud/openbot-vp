import { randomUUID } from "node:crypto";
/**
 * Gateway RPC surface for Knowledge Vault Sync (P1).
 * Control plane is file-backed under the OpenBot state dir; blobs are ciphertext-only.
 *
 * R1 trust boundary: Gateway must not receive sync passwords, plaintext paths, or
 * decryptable content. Legacy gateway-side sync is opt-in via
 * OPENBOT_VAULT_SYNC_LEGACY_GATEWAY_SYNC=1.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertVaultManager,
  assertVaultMemberOrOwner,
  assertVaultOwner,
  assertVaultSyncActorMatches,
  legacyGatewaySyncEnabled,
  resolveVaultSyncActor,
  VaultSyncAuthError,
} from "../../vault-sync/gateway-auth.js";
import { vaultSyncHttpChunkPutPathTemplate } from "../../vault-sync/http-upload-handler.js";
import {
  acceptInviteWithSecret,
  createInviteWithPassword,
  createVaultSyncControlPlane,
  DeviceSyncEngine,
  enableTeamWithPassword,
  generateVaultSalt,
  resolveVaultSyncControlPlaneRoot,
  VaultSyncControlPlane,
  VAULT_SYNC_WS_CHUNK_MAX_BYTES,
} from "../../vault-sync/index.js";
import type { VaultSyncPresignedPut } from "../../vault-sync/store/object-store.js";
import type { FileRevision } from "../../vault-sync/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function resolveControlPlaneRoot(): string {
  return resolveVaultSyncControlPlaneRoot();
}

function getPlane(): VaultSyncControlPlane {
  return createVaultSyncControlPlane({ rootDir: resolveControlPlaneRoot() });
}

function ok(respond: RespondFn, payload: unknown) {
  respond(true, payload, undefined);
}

function fail(
  respond: RespondFn,
  message: string,
  code: (typeof ErrorCodes)[keyof typeof ErrorCodes] = ErrorCodes.INVALID_REQUEST,
) {
  respond(false, undefined, errorShape(code, message));
}

function failAuth(respond: RespondFn, error: unknown): boolean {
  if (error instanceof VaultSyncAuthError) {
    fail(respond, error.message);
    return true;
  }
  return false;
}

/** Resolve actor and ensure owner or active team member may access vault. */
function requireVaultMemberAccess(
  client: Parameters<typeof resolveVaultSyncActor>[0],
  vaultId: string,
): string {
  const actor = resolveVaultSyncActor(client);
  assertVaultMemberOrOwner(getPlane(), vaultId, actor);
  return actor;
}

function legacyGatewaySyncBlocked(respond: RespondFn): boolean {
  if (legacyGatewaySyncEnabled()) {
    return false;
  }
  fail(
    respond,
    "gateway-side vault sync disabled; use client-side E2EE sync (revisions.commit + ciphertext blobs only)",
  );
  return true;
}

function parseFileRevision(raw: unknown): FileRevision | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const required = [
    "vaultId",
    "opaquePathId",
    "revisionId",
    "deviceId",
    "encryptedMetadataB64",
    "ciphertextHash",
    "createdAt",
  ] as const;
  for (const key of required) {
    if (typeof r[key] !== "string" || !String(r[key]).trim()) {
      return null;
    }
  }
  if (typeof r.deviceSequence !== "number" || !Number.isFinite(r.deviceSequence)) {
    return null;
  }
  if (typeof r.plaintextSize !== "number" || !Number.isFinite(r.plaintextSize)) {
    return null;
  }
  if (typeof r.tombstone !== "boolean") {
    return null;
  }
  if (typeof r.protocolVersion !== "number" || typeof r.encryptionVersion !== "number") {
    return null;
  }
  const parentRevisionIds = Array.isArray(r.parentRevisionIds)
    ? r.parentRevisionIds.map((p) => String(p))
    : [];
  const ciphertextBlobId =
    r.ciphertextBlobId === null || r.ciphertextBlobId === undefined
      ? null
      : typeof r.ciphertextBlobId === "string"
        ? r.ciphertextBlobId
        : null;
  return {
    vaultId: String(r.vaultId).trim(),
    opaquePathId: String(r.opaquePathId).trim(),
    revisionId: String(r.revisionId).trim(),
    parentRevisionIds,
    deviceId: String(r.deviceId).trim(),
    deviceSequence: r.deviceSequence,
    encryptedMetadataB64: String(r.encryptedMetadataB64),
    ciphertextBlobId,
    plaintextSize: r.plaintextSize,
    ciphertextHash: String(r.ciphertextHash).trim().toLowerCase(),
    tombstone: r.tombstone,
    createdAt: String(r.createdAt),
    protocolVersion: r.protocolVersion,
    encryptionVersion: r.encryptionVersion,
    conflictGroupId:
      r.conflictGroupId === null || r.conflictGroupId === undefined
        ? null
        : typeof r.conflictGroupId === "string"
          ? r.conflictGroupId
          : null,
  };
}

export const vaultSyncHandlers: GatewayRequestHandlers = {
  "knowledge.vault-sync.create": async ({ params, respond, client }) => {
    try {
      const ownerAccountId = assertVaultSyncActorMatches(
        client,
        typeof params.ownerAccountId === "string" ? params.ownerAccountId : undefined,
        "ownerAccountId",
      );
      if (typeof params.password === "string" && params.password && !legacyGatewaySyncEnabled()) {
        fail(respond, "password must not be sent to gateway; derive keys on the client");
        return;
      }
      const deviceId =
        typeof params.deviceId === "string" && params.deviceId.trim()
          ? params.deviceId.trim()
          : undefined;
      const saltB64 =
        typeof params.saltB64 === "string" && params.saltB64.trim()
          ? params.saltB64.trim()
          : generateVaultSalt().toString("base64");
      const plane = getPlane();
      const vault = plane.createVault({ ownerAccountId, saltB64 });
      const registeredDeviceId = deviceId ?? randomUUID();
      plane.registerDevice({
        vaultId: vault.vaultId,
        deviceId: registeredDeviceId,
        platform: typeof params.platform === "string" ? params.platform : "desktop",
      });
      await plane.flushMetadataPrimary();
      ok(respond, {
        vaultId: vault.vaultId,
        deviceId: registeredDeviceId,
        saltB64: vault.saltB64,
        mode: "e2ee_private",
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "create failed");
    }
  },

  "knowledge.vault-sync.list": async ({ params, respond, client }) => {
    try {
      const ownerAccountId = assertVaultSyncActorMatches(
        client,
        typeof params.ownerAccountId === "string" ? params.ownerAccountId : undefined,
        "ownerAccountId",
      );
      const vaults = getPlane()
        .listVaults(ownerAccountId)
        .map((v) => ({
          vaultId: v.vaultId,
          mode: v.mode,
          quotaBytes: v.quotaBytes,
          usageBytes: v.usageBytes,
          createdAt: v.createdAt,
        }));
      ok(respond, { vaults });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "list failed");
    }
  },

  "knowledge.vault-sync.register-device": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const deviceId = typeof params.deviceId === "string" ? params.deviceId.trim() : "";
    if (!vaultId || !deviceId) {
      fail(respond, "vaultId and deviceId required");
      return;
    }
    try {
      const actor = resolveVaultSyncActor(client);
      assertVaultOwner(getPlane(), vaultId, actor);
      const plane = getPlane();
      const device = plane.registerDevice({
        vaultId,
        deviceId,
        platform: typeof params.platform === "string" ? params.platform : "desktop",
      });
      await plane.flushMetadataPrimary();
      ok(respond, { device });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "register failed");
    }
  },

  "knowledge.vault-sync.sync": async ({ params, respond }) => {
    if (legacyGatewaySyncBlocked(respond)) {
      return;
    }
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const deviceId = typeof params.deviceId === "string" ? params.deviceId.trim() : "";
    const rootPath = typeof params.rootPath === "string" ? params.rootPath.trim() : "";
    const password = typeof params.password === "string" ? params.password : "";
    if (!vaultId || !deviceId || !rootPath || !password) {
      fail(respond, "vaultId, deviceId, rootPath, and password required");
      return;
    }
    if (!fs.existsSync(rootPath)) {
      fail(respond, "rootPath not found");
      return;
    }
    try {
      const plane = getPlane();
      const localStoreDir = path.join(
        resolveControlPlaneRoot(),
        "..",
        "device-state",
        vaultId,
        deviceId,
      );
      const engine = new DeviceSyncEngine({
        controlPlane: plane,
        vaultId,
        deviceId,
        rootPath,
        localStoreDir,
      });
      engine.unlockAndVerify(password);
      if (params.selectiveSync && typeof params.selectiveSync === "object") {
        engine.setSelectiveSync(params.selectiveSync as Record<string, unknown>);
      }
      const push = engine.pushLocalChanges();
      const pull = engine.pullRemoteChanges();
      ok(respond, {
        status: engine.status,
        push,
        pull,
        selectiveSync: engine.getSelectiveSync(),
        reindexPaths: pull.touchedPaths,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync failed";
      if (message.includes("invalid sync password")) {
        fail(respond, "invalid sync password");
        return;
      }
      if (message.includes("device revoked")) {
        fail(respond, "device revoked");
        return;
      }
      fail(respond, message.includes("decryption") ? "decryption failed" : message);
    }
  },

  "knowledge.vault-sync.inventory": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    if (!vaultId) {
      fail(respond, "vaultId required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      const cursor = typeof params.cursor === "string" ? params.cursor : null;
      const limit = typeof params.limit === "number" ? params.limit : 500;
      ok(respond, getPlane().getInventoryPage(vaultId, cursor, limit));
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "inventory failed");
    }
  },

  "knowledge.vault-sync.status": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    if (!vaultId) {
      fail(respond, "vaultId required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      const vault = getPlane().getVault(vaultId);
      if (!vault) {
        fail(respond, "vault not found", ErrorCodes.INVALID_REQUEST);
        return;
      }
      ok(respond, {
        vaultId: vault.vaultId,
        mode: vault.mode,
        quotaBytes: vault.quotaBytes,
        usageBytes: vault.usageBytes,
        protocolVersion: vault.protocolVersion,
        encryptionVersion: vault.encryptionVersion,
        saltB64: vault.saltB64,
        kdfParams: vault.kdfParams,
        teamEnabled: Boolean(vault.teamEnabled),
        ownerAccountId: vault.ownerAccountId,
        quota: getPlane().getQuotaStatus(vaultId),
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "status failed");
    }
  },

  "knowledge.vault-sync.history": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const opaquePathId = typeof params.opaquePathId === "string" ? params.opaquePathId.trim() : "";
    const relativePath = typeof params.relativePath === "string" ? params.relativePath.trim() : "";
    const password = typeof params.password === "string" ? params.password : "";
    const deviceId =
      typeof params.deviceId === "string" ? params.deviceId.trim() : "history-reader";
    if (!vaultId || (!opaquePathId && !relativePath)) {
      fail(respond, "vaultId and opaquePathId or relativePath required");
      return;
    }
    if (relativePath && password) {
      if (legacyGatewaySyncBlocked(respond)) {
        return;
      }
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      const plane = getPlane();
      if (opaquePathId && !relativePath) {
        const revisions = plane.getPathHistory(vaultId, opaquePathId).map(summarizeRevision);
        ok(respond, { opaquePathId, revisions });
        return;
      }
      if (!password) {
        fail(respond, "password required to resolve relativePath");
        return;
      }
      const localStoreDir = path.join(
        resolveControlPlaneRoot(),
        "..",
        "device-state",
        vaultId,
        deviceId,
      );
      const engine = new DeviceSyncEngine({
        controlPlane: plane,
        vaultId,
        deviceId,
        rootPath: typeof params.rootPath === "string" ? params.rootPath : os.tmpdir(),
        localStoreDir,
      });
      engine.unlockAndVerify(password);
      const revisions = engine
        .getPathHistory({ relativePath, opaquePathId })
        .map(summarizeRevision);
      ok(respond, {
        opaquePathId: revisions[0]?.opaquePathId ?? opaquePathId,
        revisions,
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      const message = error instanceof Error ? error.message : "history failed";
      fail(respond, message.includes("password") ? "invalid sync password" : message);
    }
  },

  "knowledge.vault-sync.trash": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    if (!vaultId) {
      fail(respond, "vaultId required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      const cursor = typeof params.cursor === "string" ? params.cursor : null;
      const limit = typeof params.limit === "number" ? params.limit : 500;
      ok(respond, getPlane().getTrashPage(vaultId, cursor, limit));
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "trash failed");
    }
  },

  "knowledge.vault-sync.restore": async ({ params, respond }) => {
    if (legacyGatewaySyncBlocked(respond)) {
      return;
    }
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const deviceId = typeof params.deviceId === "string" ? params.deviceId.trim() : "";
    const rootPath = typeof params.rootPath === "string" ? params.rootPath.trim() : "";
    const password = typeof params.password === "string" ? params.password : "";
    const revisionId = typeof params.revisionId === "string" ? params.revisionId.trim() : "";
    if (!vaultId || !deviceId || !rootPath || !password || !revisionId) {
      fail(respond, "vaultId, deviceId, rootPath, password, and revisionId required");
      return;
    }
    if (!fs.existsSync(rootPath)) {
      fail(respond, "rootPath not found");
      return;
    }
    try {
      const plane = getPlane();
      const localStoreDir = path.join(
        resolveControlPlaneRoot(),
        "..",
        "device-state",
        vaultId,
        deviceId,
      );
      const engine = new DeviceSyncEngine({
        controlPlane: plane,
        vaultId,
        deviceId,
        rootPath,
        localStoreDir,
      });
      engine.unlockAndVerify(password);
      const restored = engine.restoreFromRevision(revisionId);
      ok(respond, {
        status: engine.status,
        ...restored,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "restore failed";
      if (message.includes("invalid sync password")) {
        fail(respond, "invalid sync password");
        return;
      }
      fail(respond, message.includes("decryption") ? "decryption failed" : message);
    }
  },

  "knowledge.vault-sync.selective-sync.get": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const deviceId = typeof params.deviceId === "string" ? params.deviceId.trim() : "";
    if (!vaultId || !deviceId) {
      fail(respond, "vaultId and deviceId required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "selective-sync get failed");
      return;
    }
    const localStoreDir = path.join(
      resolveControlPlaneRoot(),
      "..",
      "device-state",
      vaultId,
      deviceId,
    );
    const engine = new DeviceSyncEngine({
      controlPlane: getPlane(),
      vaultId,
      deviceId,
      rootPath: typeof params.rootPath === "string" ? params.rootPath : os.tmpdir(),
      localStoreDir,
    });
    ok(respond, { selectiveSync: engine.getSelectiveSync() });
  },

  "knowledge.vault-sync.selective-sync.set": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const deviceId = typeof params.deviceId === "string" ? params.deviceId.trim() : "";
    if (!vaultId || !deviceId) {
      fail(respond, "vaultId and deviceId required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "selective-sync set failed");
      return;
    }
    const localStoreDir = path.join(
      resolveControlPlaneRoot(),
      "..",
      "device-state",
      vaultId,
      deviceId,
    );
    const engine = new DeviceSyncEngine({
      controlPlane: getPlane(),
      vaultId,
      deviceId,
      rootPath: typeof params.rootPath === "string" ? params.rootPath : os.tmpdir(),
      localStoreDir,
    });
    const selectiveSync = engine.setSelectiveSync(
      params.selectiveSync && typeof params.selectiveSync === "object"
        ? (params.selectiveSync as Record<string, unknown>)
        : undefined,
    );
    ok(respond, { selectiveSync });
  },

  "knowledge.vault-sync.devices.list": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    if (!vaultId) {
      fail(respond, "vaultId required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      const devices = getPlane()
        .listDevices(vaultId)
        .map((d) => ({
          deviceId: d.deviceId,
          platform: d.platform,
          status: d.status,
          lastSequence: d.lastSequence,
          registeredAt: d.registeredAt,
          revokedAt: d.revokedAt ?? null,
        }));
      ok(respond, { vaultId, devices });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "list devices failed");
    }
  },

  "knowledge.vault-sync.devices.revoke": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const deviceId = typeof params.deviceId === "string" ? params.deviceId.trim() : "";
    if (!vaultId || !deviceId) {
      fail(respond, "vaultId and deviceId required");
      return;
    }
    try {
      const actor = resolveVaultSyncActor(client);
      assertVaultManager(getPlane(), vaultId, actor);
      const device = getPlane().revokeDevice(vaultId, deviceId);
      ok(respond, {
        vaultId,
        deviceId: device.deviceId,
        status: device.status,
        revokedAt: device.revokedAt ?? null,
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "revoke failed");
    }
  },

  "knowledge.vault-sync.encryption-version.bump": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    if (!vaultId) {
      fail(respond, "vaultId required");
      return;
    }
    const expectedCurrent =
      typeof params.expectedCurrent === "number" ? params.expectedCurrent : undefined;
    try {
      const actor = resolveVaultSyncActor(client);
      assertVaultManager(getPlane(), vaultId, actor);
      const vault = getPlane().bumpEncryptionVersion(vaultId, { expectedCurrent });
      ok(respond, {
        vaultId: vault.vaultId,
        encryptionVersion: vault.encryptionVersion,
        protocolVersion: vault.protocolVersion,
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "bump encryption version failed");
    }
  },

  "knowledge.vault-sync.revisions.commit": async ({ params, respond, client }) => {
    const revision = parseFileRevision(params.revision);
    if (!revision) {
      fail(respond, "valid revision object required");
      return;
    }
    try {
      const actor = resolveVaultSyncActor(client);
      assertVaultMemberOrOwner(getPlane(), revision.vaultId, actor);
      const plane = getPlane();
      const result = plane.commitRevision({
        revision,
        idempotencyKey:
          typeof params.idempotencyKey === "string" ? params.idempotencyKey : undefined,
      });
      await plane.flushMetadataPrimary();
      ok(respond, { result });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "commit revision failed");
    }
  },

  "knowledge.vault-sync.revisions.list-since": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    if (!vaultId) {
      fail(respond, "vaultId required");
      return;
    }
    const cursor = typeof params.cursor === "string" ? params.cursor : null;
    const limit = typeof params.limit === "number" ? params.limit : 100;
    try {
      const actor = resolveVaultSyncActor(client);
      assertVaultMemberOrOwner(getPlane(), vaultId, actor);
      const page = getPlane().listRevisionsSince(vaultId, cursor, limit);
      ok(respond, {
        revisions: page.revisions.map(summarizeRevision),
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "list revisions failed");
    }
  },

  "knowledge.vault-sync.revisions.get": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const revisionId = typeof params.revisionId === "string" ? params.revisionId.trim() : "";
    if (!vaultId || !revisionId) {
      fail(respond, "vaultId and revisionId required");
      return;
    }
    try {
      const actor = resolveVaultSyncActor(client);
      assertVaultMemberOrOwner(getPlane(), vaultId, actor);
      const revision = getPlane().getRevision(vaultId, revisionId);
      if (!revision) {
        fail(respond, "revision not found");
        return;
      }
      ok(respond, { revision: summarizeRevisionWire(revision) });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "get revision failed");
    }
  },

  "knowledge.vault-sync.revisions.list-for-path": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const opaquePathId = typeof params.opaquePathId === "string" ? params.opaquePathId.trim() : "";
    if (!vaultId || !opaquePathId) {
      fail(respond, "vaultId and opaquePathId required");
      return;
    }
    try {
      const actor = resolveVaultSyncActor(client);
      assertVaultMemberOrOwner(getPlane(), vaultId, actor);
      const revisions = getPlane().getPathHistory(vaultId, opaquePathId).map(summarizeRevisionWire);
      ok(respond, { opaquePathId, revisions });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "list path revisions failed");
    }
  },

  "knowledge.vault-sync.blobs.get": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const blobId = typeof params.blobId === "string" ? params.blobId.trim() : "";
    if (!vaultId || !blobId) {
      fail(respond, "vaultId and blobId required");
      return;
    }
    try {
      const actor = resolveVaultSyncActor(client);
      assertVaultMemberOrOwner(getPlane(), vaultId, actor);
      const data = getPlane().getBlob(vaultId, blobId);
      if (!data) {
        fail(respond, "blob not found");
        return;
      }
      ok(respond, {
        blobId,
        contentBase64: data.toString("base64"),
        sizeBytes: data.length,
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "get blob failed");
    }
  },

  "knowledge.vault-sync.blobs.put": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const deviceId = typeof params.deviceId === "string" ? params.deviceId.trim() : "";
    const ciphertextHash =
      typeof params.ciphertextHash === "string" ? params.ciphertextHash.trim().toLowerCase() : "";
    const contentBase64 = typeof params.contentBase64 === "string" ? params.contentBase64 : "";
    if (!vaultId || !deviceId || !ciphertextHash || !contentBase64) {
      fail(respond, "vaultId, deviceId, ciphertextHash, and contentBase64 required");
      return;
    }
    try {
      const actor = resolveVaultSyncActor(client);
      assertVaultMemberOrOwner(getPlane(), vaultId, actor);
      const data = Buffer.from(contentBase64, "base64");
      if (data.length > getPlane().getDirectPutMaxBytes()) {
        fail(respond, "blob too large for direct put; use upload-session");
        return;
      }
      const plane = getPlane();
      const blob = plane.putBlob({
        vaultId,
        deviceId,
        ciphertext: data,
        ciphertextHash,
      });
      await plane.flushMetadataPrimary();
      ok(respond, {
        blobId: blob.blobId,
        sizeBytes: blob.sizeBytes,
        ciphertextHash: blob.ciphertextHash,
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "put blob failed");
    }
  },

  "knowledge.vault-sync.blobs.upload-session.create": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const deviceId = typeof params.deviceId === "string" ? params.deviceId.trim() : "";
    const ciphertextHash =
      typeof params.ciphertextHash === "string" ? params.ciphertextHash.trim().toLowerCase() : "";
    const totalSizeBytes =
      typeof params.totalSizeBytes === "number" ? params.totalSizeBytes : Number.NaN;
    if (!vaultId || !deviceId || !ciphertextHash || !Number.isFinite(totalSizeBytes)) {
      fail(respond, "vaultId, deviceId, ciphertextHash, and totalSizeBytes required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      const plane = getPlane();
      const session = plane.createUploadSession({
        vaultId,
        deviceId,
        ciphertextHash,
        totalSizeBytes,
        chunkSize: typeof params.chunkSize === "number" ? params.chunkSize : undefined,
      });
      const httpToken = session.httpUploadToken ?? "";
      const objectStore = plane.getObjectStore();
      const blobIdForPresign = session.uploadId;
      let s3Presign: VaultSyncPresignedPut | null = null;
      if (objectStore.kind === "s3" && objectStore.createPresignedPut) {
        s3Presign = await Promise.resolve(
          objectStore.createPresignedPut({
            vaultId,
            blobId: blobIdForPresign,
            contentLength: Math.floor(totalSizeBytes),
          }),
        );
      }
      ok(respond, {
        session: {
          uploadId: session.uploadId,
          vaultId: session.vaultId,
          deviceId: session.deviceId,
          ciphertextHash: session.ciphertextHash,
          totalSizeBytes: session.totalSizeBytes,
          chunkSize: session.chunkSize,
          chunkCount: session.chunkCount,
          receivedChunkIndexes: session.receivedChunkIndexes,
          status: session.status,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          completedBlobId: session.completedBlobId ?? null,
          objectUploadBlobId: session.objectUploadBlobId ?? null,
        },
        httpUpload: httpToken
          ? {
              token: httpToken,
              chunkPutPathTemplate: vaultSyncHttpChunkPutPathTemplate(),
            }
          : null,
        objectUpload: s3Presign
          ? {
              backend: "s3",
              put: s3Presign,
            }
          : null,
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "create upload session failed");
    }
  },

  "knowledge.vault-sync.blobs.upload-session.get": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const uploadId = typeof params.uploadId === "string" ? params.uploadId.trim() : "";
    if (!vaultId || !uploadId) {
      fail(respond, "vaultId and uploadId required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      const session = getPlane().getUploadSession(vaultId, uploadId);
      if (!session) {
        fail(respond, "upload session not found");
        return;
      }
      ok(respond, { session });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "get upload session failed");
    }
  },

  "knowledge.vault-sync.blobs.upload-session.put-chunk": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const uploadId = typeof params.uploadId === "string" ? params.uploadId.trim() : "";
    const chunkIndex = typeof params.chunkIndex === "number" ? params.chunkIndex : Number.NaN;
    const contentBase64 = typeof params.contentBase64 === "string" ? params.contentBase64 : "";
    if (!vaultId || !uploadId || !Number.isFinite(chunkIndex) || !contentBase64) {
      fail(respond, "vaultId, uploadId, chunkIndex, and contentBase64 required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      const data = Buffer.from(contentBase64, "base64");
      // Hard cap for Gateway-proxied WS chunks — large blobs must use HTTP binary PUT.
      if (data.length > VAULT_SYNC_WS_CHUNK_MAX_BYTES) {
        fail(
          respond,
          "chunk too large for websocket Base64; use HTTP binary upload (upload-session httpUpload)",
        );
        return;
      }
      const session = getPlane().putUploadChunk({
        vaultId,
        uploadId,
        chunkIndex,
        data,
      });
      ok(respond, {
        session: {
          uploadId: session.uploadId,
          status: session.status,
          receivedChunkIndexes: session.receivedChunkIndexes,
          chunkCount: session.chunkCount,
        },
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "put chunk failed");
    }
  },

  "knowledge.vault-sync.blobs.upload-session.complete": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const uploadId = typeof params.uploadId === "string" ? params.uploadId.trim() : "";
    if (!vaultId || !uploadId) {
      fail(respond, "vaultId and uploadId required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      const plane = getPlane();
      const blob = await plane.completeUploadSessionAsync({ vaultId, uploadId });
      await plane.flushMetadataPrimary();
      ok(respond, {
        blobId: blob.blobId,
        sizeBytes: blob.sizeBytes,
        ciphertextHash: blob.ciphertextHash,
        quota: plane.getQuotaStatus(vaultId),
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "complete upload failed");
    }
  },

  "knowledge.vault-sync.blobs.upload-session.abort": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const uploadId = typeof params.uploadId === "string" ? params.uploadId.trim() : "";
    if (!vaultId || !uploadId) {
      fail(respond, "vaultId and uploadId required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      const session = getPlane().abortUploadSession({ vaultId, uploadId });
      ok(respond, {
        uploadId: session.uploadId,
        status: session.status,
        quota: getPlane().getQuotaStatus(vaultId),
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "abort upload failed");
    }
  },

  "knowledge.vault-sync.quota.get": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    if (!vaultId) {
      fail(respond, "vaultId required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      ok(respond, getPlane().getQuotaStatus(vaultId));
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "quota get failed");
    }
  },

  "knowledge.vault-sync.team.enable-with-password": async ({ params, respond }) => {
    if (legacyGatewaySyncBlocked(respond)) {
      return;
    }
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const ownerAccountId =
      typeof params.ownerAccountId === "string" ? params.ownerAccountId.trim() : "";
    const password = typeof params.password === "string" ? params.password : "";
    if (!vaultId || !ownerAccountId || !password) {
      fail(respond, "vaultId, ownerAccountId, and password required");
      return;
    }
    try {
      const member = enableTeamWithPassword({
        controlPlane: getPlane(),
        vaultId,
        ownerAccountId,
        password,
      });
      ok(respond, {
        vaultId,
        teamEnabled: true,
        member: summarizeMember(member),
      });
    } catch (error) {
      fail(respond, error instanceof Error ? error.message : "team enable failed");
    }
  },

  "knowledge.vault-sync.team.enable": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const publicKeyB64 = typeof params.publicKeyB64 === "string" ? params.publicKeyB64.trim() : "";
    const ephemeralPublicKeyB64 =
      typeof params.ephemeralPublicKeyB64 === "string" ? params.ephemeralPublicKeyB64.trim() : "";
    const wrappedBaseKeyB64 =
      typeof params.wrappedBaseKeyB64 === "string" ? params.wrappedBaseKeyB64.trim() : "";
    if (!vaultId || !publicKeyB64 || !ephemeralPublicKeyB64 || !wrappedBaseKeyB64) {
      fail(respond, "vaultId, publicKeyB64, ephemeralPublicKeyB64, and wrappedBaseKeyB64 required");
      return;
    }
    try {
      const ownerAccountId = assertVaultSyncActorMatches(
        client,
        typeof params.ownerAccountId === "string" ? params.ownerAccountId : undefined,
        "ownerAccountId",
      );
      assertVaultOwner(getPlane(), vaultId, ownerAccountId);
      const plane = getPlane();
      const member = plane.enableTeamWithOwner({
        vaultId,
        ownerAccountId,
        publicKeyB64,
        ephemeralPublicKeyB64,
        wrappedBaseKeyB64,
        keyEpoch: typeof params.keyEpoch === "number" ? params.keyEpoch : undefined,
      });
      await plane.flushMetadataPrimary();
      ok(respond, {
        vaultId,
        teamEnabled: true,
        member: summarizeMember(member),
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "team enable failed");
    }
  },

  "knowledge.vault-sync.members.list": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    if (!vaultId) {
      fail(respond, "vaultId required");
      return;
    }
    try {
      const actor = resolveVaultSyncActor(client);
      assertVaultMemberOrOwner(getPlane(), vaultId, actor);
      ok(respond, {
        vaultId,
        members: getPlane().listMembers(vaultId).map(summarizeMember),
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "list members failed");
    }
  },

  "knowledge.vault-sync.invites.create-with-password": async ({ params, respond }) => {
    if (legacyGatewaySyncBlocked(respond)) {
      return;
    }
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const invitedByAccountId =
      typeof params.invitedByAccountId === "string" ? params.invitedByAccountId.trim() : "";
    const password = typeof params.password === "string" ? params.password : "";
    if (!vaultId || !invitedByAccountId || !password) {
      fail(respond, "vaultId, invitedByAccountId, and password required");
      return;
    }
    try {
      const { invite, inviteSecret } = createInviteWithPassword({
        controlPlane: getPlane(),
        vaultId,
        invitedByAccountId,
        password,
        inviteeAccountId:
          typeof params.inviteeAccountId === "string" ? params.inviteeAccountId : null,
        role: params.role === "admin" || params.role === "member" ? params.role : "member",
        ttlMs: typeof params.ttlMs === "number" ? params.ttlMs : undefined,
      });
      ok(respond, {
        invite: summarizeInvite(invite),
        inviteSecret,
      });
    } catch (error) {
      fail(respond, error instanceof Error ? error.message : "create invite failed");
    }
  },

  "knowledge.vault-sync.invites.create": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const inviteSaltB64 =
      typeof params.inviteSaltB64 === "string" ? params.inviteSaltB64.trim() : "";
    const wrappedBaseKeyB64 =
      typeof params.wrappedBaseKeyB64 === "string" ? params.wrappedBaseKeyB64.trim() : "";
    if (!vaultId || !inviteSaltB64 || !wrappedBaseKeyB64) {
      fail(respond, "vaultId, inviteSaltB64, and wrappedBaseKeyB64 required");
      return;
    }
    try {
      const invitedByAccountId = assertVaultSyncActorMatches(
        client,
        typeof params.invitedByAccountId === "string" ? params.invitedByAccountId : undefined,
        "invitedByAccountId",
      );
      assertVaultManager(getPlane(), vaultId, invitedByAccountId);
      const plane = getPlane();
      const invite = plane.createInvite({
        vaultId,
        invitedByAccountId,
        inviteSaltB64,
        wrappedBaseKeyB64,
        inviteId: typeof params.inviteId === "string" ? params.inviteId : undefined,
        inviteeAccountId:
          typeof params.inviteeAccountId === "string" ? params.inviteeAccountId : null,
        role: params.role === "admin" || params.role === "member" ? params.role : "member",
        ttlMs: typeof params.ttlMs === "number" ? params.ttlMs : undefined,
      });
      await plane.flushMetadataPrimary();
      ok(respond, { invite: summarizeInvite(invite) });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "create invite failed");
    }
  },

  "knowledge.vault-sync.invites.list": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    if (!vaultId) {
      fail(respond, "vaultId required");
      return;
    }
    try {
      const actor = resolveVaultSyncActor(client);
      assertVaultManager(getPlane(), vaultId, actor);
      ok(respond, {
        vaultId,
        invites: getPlane().listInvites(vaultId).map(summarizeInvite),
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "list invites failed");
    }
  },

  "knowledge.vault-sync.invites.revoke": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const inviteId = typeof params.inviteId === "string" ? params.inviteId.trim() : "";
    if (!vaultId || !inviteId) {
      fail(respond, "vaultId and inviteId required");
      return;
    }
    try {
      const actorAccountId = assertVaultSyncActorMatches(
        client,
        typeof params.actorAccountId === "string" ? params.actorAccountId : undefined,
        "actorAccountId",
      );
      assertVaultManager(getPlane(), vaultId, actorAccountId);
      const plane = getPlane();
      const invite = plane.revokeInvite({ vaultId, inviteId, actorAccountId });
      await plane.flushMetadataPrimary();
      ok(respond, { invite: summarizeInvite(invite) });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "revoke invite failed");
    }
  },

  "knowledge.vault-sync.invites.accept-with-secret": async ({ params, respond }) => {
    if (legacyGatewaySyncBlocked(respond)) {
      return;
    }
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const inviteId = typeof params.inviteId === "string" ? params.inviteId.trim() : "";
    const memberAccountId =
      typeof params.memberAccountId === "string" ? params.memberAccountId.trim() : "";
    const inviteSecret = typeof params.inviteSecret === "string" ? params.inviteSecret.trim() : "";
    if (!vaultId || !inviteId || !memberAccountId || !inviteSecret) {
      fail(respond, "vaultId, inviteId, memberAccountId, and inviteSecret required");
      return;
    }
    try {
      const member = acceptInviteWithSecret({
        controlPlane: getPlane(),
        vaultId,
        inviteId,
        memberAccountId,
        inviteSecret,
      });
      ok(respond, { member: summarizeMember(member) });
    } catch (error) {
      fail(respond, error instanceof Error ? error.message : "accept invite failed");
    }
  },

  "knowledge.vault-sync.invites.accept": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const inviteId = typeof params.inviteId === "string" ? params.inviteId.trim() : "";
    const publicKeyB64 = typeof params.publicKeyB64 === "string" ? params.publicKeyB64.trim() : "";
    const ephemeralPublicKeyB64 =
      typeof params.ephemeralPublicKeyB64 === "string" ? params.ephemeralPublicKeyB64.trim() : "";
    const wrappedBaseKeyB64 =
      typeof params.wrappedBaseKeyB64 === "string" ? params.wrappedBaseKeyB64.trim() : "";
    if (!vaultId || !inviteId || !publicKeyB64 || !ephemeralPublicKeyB64 || !wrappedBaseKeyB64) {
      fail(
        respond,
        "vaultId, inviteId, publicKeyB64, ephemeralPublicKeyB64, and wrappedBaseKeyB64 required",
      );
      return;
    }
    try {
      const memberAccountId = assertVaultSyncActorMatches(
        client,
        typeof params.memberAccountId === "string" ? params.memberAccountId : undefined,
        "memberAccountId",
      );
      const plane = getPlane();
      const member = plane.acceptInvite({
        vaultId,
        inviteId,
        memberAccountId,
        publicKeyB64,
        ephemeralPublicKeyB64,
        wrappedBaseKeyB64,
      });
      await plane.flushMetadataPrimary();
      ok(respond, { member: summarizeMember(member) });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "accept invite failed");
    }
  },

  "knowledge.vault-sync.members.revoke": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const memberAccountId =
      typeof params.memberAccountId === "string" ? params.memberAccountId.trim() : "";
    if (!vaultId || !memberAccountId) {
      fail(respond, "vaultId and memberAccountId required");
      return;
    }
    try {
      const actorAccountId = assertVaultSyncActorMatches(
        client,
        typeof params.actorAccountId === "string" ? params.actorAccountId : undefined,
        "actorAccountId",
      );
      assertVaultManager(getPlane(), vaultId, actorAccountId);
      const plane = getPlane();
      const member = plane.revokeMember({ vaultId, memberAccountId, actorAccountId });
      await plane.flushMetadataPrimary();
      ok(respond, { member: summarizeMember(member) });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "revoke member failed");
    }
  },

  /** Wave M: atomic revoke + epoch bump + wrap replace (CAS on expectedCurrentEncryptionVersion). */
  "knowledge.vault-sync.members.revoke-and-rotate": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const memberAccountId =
      typeof params.memberAccountId === "string" ? params.memberAccountId.trim() : "";
    const expectedCurrentEncryptionVersion =
      typeof params.expectedCurrentEncryptionVersion === "number"
        ? params.expectedCurrentEncryptionVersion
        : Number.NaN;
    const wraps = Array.isArray(params.wraps) ? params.wraps : null;
    if (
      !vaultId ||
      !memberAccountId ||
      !Number.isFinite(expectedCurrentEncryptionVersion) ||
      !wraps
    ) {
      fail(
        respond,
        "vaultId, memberAccountId, expectedCurrentEncryptionVersion, and wraps required",
      );
      return;
    }
    try {
      const actorAccountId = assertVaultSyncActorMatches(
        client,
        typeof params.actorAccountId === "string" ? params.actorAccountId : undefined,
        "actorAccountId",
      );
      assertVaultManager(getPlane(), vaultId, actorAccountId);
      const plane = getPlane();
      const result = plane.revokeMemberAndRotateEpoch({
        vaultId,
        memberAccountId,
        actorAccountId,
        expectedCurrentEncryptionVersion,
        wraps: wraps.map((w) => ({
          memberAccountId: String((w as { memberAccountId?: string }).memberAccountId ?? ""),
          ephemeralPublicKeyB64: String(
            (w as { ephemeralPublicKeyB64?: string }).ephemeralPublicKeyB64 ?? "",
          ),
          wrappedBaseKeyB64: String((w as { wrappedBaseKeyB64?: string }).wrappedBaseKeyB64 ?? ""),
        })),
      });
      await plane.flushMetadataPrimary();
      ok(respond, {
        member: summarizeMember(result.revoked),
        encryptionVersion: result.encryptionVersion,
        members: result.members.map(summarizeMember),
      });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "revoke-and-rotate failed");
    }
  },

  "knowledge.vault-sync.members.rotate-wraps": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const keyEpoch = typeof params.keyEpoch === "number" ? params.keyEpoch : Number.NaN;
    const wraps = Array.isArray(params.wraps) ? params.wraps : null;
    if (!vaultId || !Number.isFinite(keyEpoch) || !wraps) {
      fail(respond, "vaultId, keyEpoch, and wraps required");
      return;
    }
    try {
      const actorAccountId = assertVaultSyncActorMatches(
        client,
        typeof params.actorAccountId === "string" ? params.actorAccountId : undefined,
        "actorAccountId",
      );
      assertVaultManager(getPlane(), vaultId, actorAccountId);
      const plane = getPlane();
      const members = plane.rotateMemberWraps({
        vaultId,
        actorAccountId,
        keyEpoch,
        wraps: wraps.map((w) => ({
          memberAccountId: String((w as { memberAccountId?: string }).memberAccountId ?? ""),
          ephemeralPublicKeyB64: String(
            (w as { ephemeralPublicKeyB64?: string }).ephemeralPublicKeyB64 ?? "",
          ),
          wrappedBaseKeyB64: String((w as { wrappedBaseKeyB64?: string }).wrappedBaseKeyB64 ?? ""),
        })),
      });
      await plane.flushMetadataPrimary();
      ok(respond, { members: members.map(summarizeMember) });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "rotate wraps failed");
    }
  },

  "knowledge.vault-sync.runtime.bind-kb": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    const knowledgeBaseId =
      typeof params.knowledgeBaseId === "string" ? params.knowledgeBaseId.trim() : "";
    if (!vaultId || !knowledgeBaseId) {
      fail(respond, "vaultId and knowledgeBaseId required");
      return;
    }
    try {
      requireVaultMemberAccess(client, vaultId);
      const { setVaultKnowledgeBaseBinding } = await import("../../vault-sync/vault-kb-binding.js");
      const binding = setVaultKnowledgeBaseBinding({
        vaultId,
        knowledgeBaseId,
        rootDir: resolveControlPlaneRoot(),
      });
      ok(respond, { binding });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "bind knowledge base failed");
    }
  },

  "knowledge.vault-sync.runtime.reindex": async ({ params, respond, client }) => {
    const vaultId = typeof params.vaultId === "string" ? params.vaultId.trim() : "";
    if (!vaultId) {
      fail(respond, "vaultId required");
      return;
    }
    const knowledgeBaseId =
      typeof params.knowledgeBaseId === "string" ? params.knowledgeBaseId.trim() : "";
    const rootPath = typeof params.rootPath === "string" ? params.rootPath.trim() : "";
    const touchedRelativePaths = Array.isArray(params.touchedRelativePaths)
      ? params.touchedRelativePaths.map((p) => String(p)).filter((p) => p.trim().length > 0)
      : [];
    const persistBinding = params.persistBinding !== false;
    try {
      requireVaultMemberAccess(client, vaultId);
      if (knowledgeBaseId && persistBinding) {
        const { setVaultKnowledgeBaseBinding } =
          await import("../../vault-sync/vault-kb-binding.js");
        setVaultKnowledgeBaseBinding({
          vaultId,
          knowledgeBaseId,
          rootDir: resolveControlPlaneRoot(),
        });
      }
      const { createSubsystemLogger } = await import("../../logging/subsystem.js");
      const { runVaultSyncRuntimeReindex } = await import("../vault-sync-runtime-hook.js");
      const summary = await runVaultSyncRuntimeReindex({
        vaultId,
        knowledgeBaseId: knowledgeBaseId || null,
        rootPath: rootPath || null,
        touchedRelativePaths: touchedRelativePaths.length > 0 ? touchedRelativePaths : ["."],
        log: createSubsystemLogger("vault-sync-runtime"),
      });
      ok(respond, { vaultId, ...summary });
    } catch (error) {
      if (failAuth(respond, error)) {
        return;
      }
      fail(respond, error instanceof Error ? error.message : "runtime reindex failed");
    }
  },
};

function summarizeMember(member: {
  memberAccountId: string;
  role: string;
  status: string;
  publicKeyB64: string;
  ephemeralPublicKeyB64: string | null;
  wrappedBaseKeyB64: string | null;
  keyEpoch: number;
  joinedAt: string;
  revokedAt?: string | null;
}) {
  return {
    memberAccountId: member.memberAccountId,
    role: member.role,
    status: member.status,
    publicKeyB64: member.publicKeyB64,
    hasWrappedKey: Boolean(member.wrappedBaseKeyB64 && member.ephemeralPublicKeyB64),
    keyEpoch: member.keyEpoch,
    joinedAt: member.joinedAt,
    revokedAt: member.revokedAt ?? null,
  };
}

function summarizeInvite(invite: {
  inviteId: string;
  invitedByAccountId: string;
  inviteeAccountId?: string | null;
  role: string;
  inviteSaltB64: string;
  wrappedBaseKeyB64: string;
  keyEpoch: number;
  status: string;
  createdAt: string;
  expiresAt: string;
  acceptedByAccountId?: string | null;
}) {
  return {
    inviteId: invite.inviteId,
    invitedByAccountId: invite.invitedByAccountId,
    inviteeAccountId: invite.inviteeAccountId ?? null,
    role: invite.role,
    inviteSaltB64: invite.inviteSaltB64,
    wrappedBaseKeyB64: invite.wrappedBaseKeyB64,
    keyEpoch: invite.keyEpoch,
    status: invite.status,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    acceptedByAccountId: invite.acceptedByAccountId ?? null,
  };
}

function summarizeRevision(rev: {
  revisionId: string;
  opaquePathId: string;
  parentRevisionIds: string[];
  deviceId: string;
  deviceSequence: number;
  plaintextSize: number;
  tombstone: boolean;
  createdAt: string;
  conflictGroupId?: string | null;
  ciphertextBlobId: string | null;
}) {
  return {
    revisionId: rev.revisionId,
    opaquePathId: rev.opaquePathId,
    parentRevisionIds: rev.parentRevisionIds,
    deviceId: rev.deviceId,
    deviceSequence: rev.deviceSequence,
    plaintextSize: rev.plaintextSize,
    tombstone: rev.tombstone,
    createdAt: rev.createdAt,
    conflictGroupId: rev.conflictGroupId ?? null,
    hasBlob: Boolean(rev.ciphertextBlobId),
  };
}

function summarizeRevisionWire(rev: {
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
}) {
  return {
    vaultId: rev.vaultId,
    opaquePathId: rev.opaquePathId,
    revisionId: rev.revisionId,
    parentRevisionIds: rev.parentRevisionIds,
    deviceId: rev.deviceId,
    deviceSequence: rev.deviceSequence,
    encryptedMetadataB64: rev.encryptedMetadataB64,
    ciphertextBlobId: rev.ciphertextBlobId,
    plaintextSize: rev.plaintextSize,
    ciphertextHash: rev.ciphertextHash,
    tombstone: rev.tombstone,
    createdAt: rev.createdAt,
    protocolVersion: rev.protocolVersion,
    encryptionVersion: rev.encryptionVersion,
    conflictGroupId: rev.conflictGroupId ?? null,
  };
}

export function createVaultSyncSaltB64(): string {
  return generateVaultSalt().toString("base64");
}

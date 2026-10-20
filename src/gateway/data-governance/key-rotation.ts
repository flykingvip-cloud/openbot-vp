/**
 * P5-b crypto rotation (L13). Rewrap existing DEKs, then CAS activeKeyGeneration.
 * Does not use filesystem mtimes as retire/commit truth. Does not fork promotion.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isGovernanceActionAllowed, type GovernanceAction } from "../governance-policy.js";
import { loadValidatedCatalogRecordSync } from "./catalog-store.js";
import { countWritableCanonicals } from "./cognitive-promotion-adapters.js";
import { PROMOTION_KEY_HMAC_KEY_ENV } from "./cognitive-promotion-key.js";
import {
  isGovernanceAuthenticatedCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import { isTenantKeyManagementAuth, type TenantKeyManagementAuth } from "./key-rotation-auth.js";
import {
  emptyTenantKeyService,
  mutateTenantKeyService,
  readTenantKeyService,
  type CoveredObject,
  type TenantKeyService,
} from "./key-rotation-store.js";
import { ownershipProofFromTenantUser } from "./ownership-proof.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import type {
  KeyGenerationRecord,
  KeyRetireReceipt,
  KeyRotationReceipt,
  RewrapReceipt,
  StorageBinding,
} from "./types.js";
import { assertOwnershipProofMatches } from "./write-gate.js";

const AES_ALGO = "aes-256-gcm";

export type KeyRotationDenyCode =
  | "key_ref_required"
  | "key_generation_corrupt"
  | "catalog_corrupt"
  | "rotation_not_prepared"
  | "rewrap_incomplete"
  | "prepared_rotation_open"
  | "retire_ttl_not_elapsed"
  | "retired_key_cannot_wrap"
  | "retired_key_reactivate_forbidden"
  | "algorithm_rewrite_not_required"
  | "object_not_found"
  | "mtime_truth_forbidden"
  | "actor_not_authorized"
  | "catalog_not_found"
  | "envelope_tenant_mismatch"
  | "ownership_mismatch";

/** Resource encrypt/decrypt/rewrite: branded call. Wire tenantId is forbidden. */
export type KeyRotationAuthParams = {
  call: GovernanceAuthenticatedCall;
  stateDir: string;
  tenantId?: never;
};

/** Tenant-wide rotation SM: branded key-management auth. Wire tenantId is forbidden. */
export type KeyManagementCommandParams = {
  auth: TenantKeyManagementAuth;
  stateDir: string;
  tenantId?: never;
};

export type KeyRotationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: KeyRotationDenyCode };

function hmacSecret(): string | null {
  const raw = process.env[PROMOTION_KEY_HMAC_KEY_ENV];
  return raw && raw.trim() !== "" ? raw : null;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function wrapKeyIdForGeneration(tenantId: string, generation: number): string {
  return `wrap:platform_tenant:${tenantId}:g${generation}`;
}

function wrapKeyBytes(params: { tenantId: string; generation: number }): Buffer {
  const secret = hmacSecret();
  if (!secret) {
    throw new Error("key_ref_required");
  }
  return createHash("sha256")
    .update(`${wrapKeyIdForGeneration(params.tenantId, params.generation)}:${secret}`, "utf8")
    .digest();
}

function wrapDek(params: { tenantId: string; generation: number; dek: Buffer }): string {
  const key = wrapKeyBytes(params);
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGO, key, iv);
  const wrapped = Buffer.concat([cipher.update(params.dek), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${wrapped.toString("base64url")}`;
}

function unwrapDek(params: { tenantId: string; generation: number; wrappedDek: string }): Buffer {
  const [iv, tag, wrapped] = params.wrappedDek.split(".");
  if (!iv || !tag || !wrapped) {
    throw new Error("key_generation_corrupt");
  }
  const key = wrapKeyBytes({ tenantId: params.tenantId, generation: params.generation });
  const decipher = createDecipheriv(AES_ALGO, key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(wrapped, "base64url")), decipher.final()]);
}

function activeWriteGenerations(service: TenantKeyService): KeyGenerationRecord[] {
  return Object.values(service.generations).filter((row) => row.state === "active");
}

function assertHealthyPointer(service: TenantKeyService): KeyRotationDenyCode | null {
  const actives = activeWriteGenerations(service);
  if (actives.length !== 1) {
    return "key_generation_corrupt";
  }
  if (actives[0]?.generation !== service.activeKeyGeneration) {
    return "key_generation_corrupt";
  }
  return null;
}

function rotationReplayId(tenantId: string, fromGeneration: number, toGeneration: number): string {
  return `rotate:${tenantId}:${fromGeneration}:${toGeneration}`;
}

function rewrapKey(resourceId: string, toGeneration: number): string {
  return `${resourceId}:${toGeneration}`;
}

export function refuseMtimeAsTruth(): KeyRotationResult<never> {
  return { ok: false, error: "mtime_truth_forbidden" };
}

export function assertSingleWritableCanonical(
  bindings: readonly StorageBinding[],
): KeyRotationResult<true> {
  if (countWritableCanonicals(bindings) !== 1) {
    return { ok: false, error: "catalog_corrupt" };
  }
  return { ok: true, value: true };
}

export function selectWriteKeyGeneration(service: TenantKeyService): KeyRotationResult<number> {
  const healthy = assertHealthyPointer(service);
  if (healthy) {
    return { ok: false, error: healthy };
  }
  return { ok: true, value: service.activeKeyGeneration };
}

export function readableKeyGenerations(service: TenantKeyService): readonly number[] {
  return Object.values(service.generations)
    .filter((row) => row.state === "active" || row.state === "readable")
    .map((row) => row.generation)
    .toSorted((a, b) => a - b);
}

function authorizeKeyRotationCall(params: {
  call: unknown;
  stateDir: string;
  tenantId?: unknown;
}): KeyRotationResult<{ tenantId: string; call: GovernanceAuthenticatedCall }> {
  if (params.tenantId != null) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isGovernanceAuthenticatedCall(params.call)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const tenantId = params.call.callerTenantId?.trim() ?? "";
  if (!tenantId || params.call.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  return { ok: true, value: { tenantId, call: params.call } };
}

function authorizeKeyManagementCommand(
  params: {
    auth: unknown;
    stateDir: string;
    tenantId?: unknown;
  },
  action: GovernanceAction = "write",
): KeyRotationResult<{ tenantId: string; auth: TenantKeyManagementAuth }> {
  if (params.tenantId != null) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isTenantKeyManagementAuth(params.auth)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const tenantId = params.auth.callerTenantId.trim();
  if (!tenantId || params.auth.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  const allowed = isGovernanceActionAllowed(
    {
      role: params.auth.role,
      tenantId,
      userId: params.auth.actor.userId,
    },
    action,
    { kind: "tenant", tenantId },
  );
  if (!allowed) {
    return { ok: false, error: "actor_not_authorized" };
  }
  return { ok: true, value: { tenantId, auth: params.auth } };
}

function authorizeKeyResource(params: {
  call: GovernanceAuthenticatedCall;
  tenantId: string;
  stateDir: string;
  resourceId: string;
}): KeyRotationResult<true> {
  const loaded = loadValidatedCatalogRecordSync({
    storePath: resolveDataGovernanceCatalogPath(params.stateDir),
    resourceId: params.resourceId,
  });
  if (!loaded) {
    return { ok: false, error: "catalog_not_found" };
  }
  if (loaded.record.envelope.tenantId !== params.tenantId) {
    return { ok: false, error: "envelope_tenant_mismatch" };
  }
  if (params.call.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  try {
    assertOwnershipProofMatches(
      loaded.record,
      ownershipProofFromTenantUser({
        tenantId: params.tenantId,
        userId: params.call.actor.userId,
      }),
    );
  } catch {
    return { ok: false, error: "ownership_mismatch" };
  }
  return { ok: true, value: true };
}

export function bootstrapTenantKeyService(
  params: KeyManagementCommandParams,
): KeyRotationResult<TenantKeyService> {
  const authorized = authorizeKeyManagementCommand(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  if (!hmacSecret()) {
    return { ok: false, error: "key_ref_required" };
  }
  const mutated = mutateTenantKeyService({
    stateDir: params.stateDir,
    tenantId,
    fn: (service) => {
      if (service.revision === 0 && Object.keys(service.objects).length === 0) {
        return { ok: true, value: service, service: emptyTenantKeyService(tenantId) };
      }
      const healthy = assertHealthyPointer(service);
      if (healthy) {
        return { ok: false, error: healthy };
      }
      return { ok: true, value: service, service };
    },
  });
  return mutated.ok
    ? { ok: true, value: mutated.service }
    : { ok: false, error: mutated.error as KeyRotationDenyCode };
}

export function generateNextKeyGeneration(
  params: KeyManagementCommandParams,
): KeyRotationResult<{ generation: KeyGenerationRecord; receipt: KeyRotationReceipt }> {
  const authorized = authorizeKeyManagementCommand(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  if (!hmacSecret()) {
    return { ok: false, error: "key_ref_required" };
  }
  const mutated = mutateTenantKeyService({
    stateDir: params.stateDir,
    tenantId,
    fn: (service) => {
      const healthy = assertHealthyPointer(service);
      if (healthy) {
        return { ok: false, error: healthy };
      }
      const fromGeneration = service.activeKeyGeneration;
      const toGeneration = fromGeneration + 1;
      const replayId = rotationReplayId(tenantId, fromGeneration, toGeneration);
      const existing = service.rotationReceipts[replayId];
      const existingGen = service.generations[String(toGeneration)];
      if (existing && existingGen?.state === "prepared") {
        return {
          ok: true,
          value: { generation: existingGen, receipt: existing },
          service,
        };
      }
      const generation: KeyGenerationRecord = {
        generation: toGeneration,
        state: "prepared",
        wrapKeyId: wrapKeyIdForGeneration(tenantId, toGeneration),
      };
      const receipt: KeyRotationReceipt = {
        kind: "p5_key_rotation_receipt",
        receiptId: `krr_${sha256(Buffer.from(replayId, "utf8"))}`,
        replayId,
        tenantId,
        fromGeneration,
        toGeneration,
        state: "prepared",
      };
      return {
        ok: true,
        value: { generation, receipt },
        service: {
          ...service,
          generations: { ...service.generations, [String(toGeneration)]: generation },
          rotationReceipts: { ...service.rotationReceipts, [replayId]: receipt },
        },
      };
    },
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: mutated.error as KeyRotationDenyCode };
}

export function encryptCanonicalWrite(
  params: KeyRotationAuthParams & {
    resourceId: string;
    plaintext: Buffer;
    algorithm?: CoveredObject["algorithm"];
  },
): KeyRotationResult<CoveredObject> {
  const authorized = authorizeKeyRotationCall(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const scoped = authorizeKeyResource({
    call: authorized.value.call,
    tenantId,
    stateDir: params.stateDir,
    resourceId: params.resourceId,
  });
  if (!scoped.ok) {
    return scoped;
  }
  if (!hmacSecret()) {
    return { ok: false, error: "key_ref_required" };
  }
  const mutated = mutateTenantKeyService({
    stateDir: params.stateDir,
    tenantId,
    fn: (service) => {
      const healthy = assertHealthyPointer(service);
      if (healthy) {
        return { ok: false, error: healthy };
      }
      const generation = service.activeKeyGeneration;
      const record = service.generations[String(generation)];
      if (!record || record.state !== "active") {
        return { ok: false, error: "key_generation_corrupt" };
      }
      const dek = randomBytes(32);
      const iv = randomBytes(12);
      const cipher = createCipheriv(AES_ALGO, dek, iv);
      const ciphertext = Buffer.concat([cipher.update(params.plaintext), cipher.final()]);
      const object: CoveredObject = {
        resourceId: params.resourceId,
        tenantId,
        algorithm: params.algorithm ?? "aes-256-gcm",
        contentIv: iv.toString("base64url"),
        contentTag: cipher.getAuthTag().toString("base64url"),
        contentCiphertext: ciphertext.toString("base64url"),
        wraps: {
          [String(generation)]: {
            generation,
            wrapKeyId: record.wrapKeyId,
            wrappedDek: wrapDek({ tenantId, generation, dek }),
          },
        },
      };
      return {
        ok: true,
        value: object,
        service: {
          ...service,
          objects: { ...service.objects, [params.resourceId]: object },
        },
      };
    },
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: mutated.error as KeyRotationDenyCode };
}

export function rewrapCoveredObjects(
  params: KeyManagementCommandParams & { toGeneration: number },
): KeyRotationResult<readonly RewrapReceipt[]> {
  const authorized = authorizeKeyManagementCommand(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  if (!hmacSecret()) {
    return { ok: false, error: "key_ref_required" };
  }
  const mutated = mutateTenantKeyService({
    stateDir: params.stateDir,
    tenantId,
    fn: (service) => {
      const healthy = assertHealthyPointer(service);
      if (healthy) {
        return { ok: false, error: healthy };
      }
      const target = service.generations[String(params.toGeneration)];
      if (!target || target.state !== "prepared") {
        return { ok: false, error: "rotation_not_prepared" };
      }
      const fromGeneration = service.activeKeyGeneration;
      const receipts: RewrapReceipt[] = [];
      const objects: Record<string, CoveredObject> = { ...service.objects };
      const rewrapReceipts = { ...service.rewrapReceipts };
      for (const object of Object.values(service.objects)) {
        const existing = rewrapReceipts[rewrapKey(object.resourceId, params.toGeneration)];
        if (existing?.state === "applied") {
          receipts.push(existing);
          continue;
        }
        const currentWrap = object.wraps[String(fromGeneration)];
        if (!currentWrap) {
          return { ok: false, error: "rewrap_incomplete" };
        }
        const dek = unwrapDek({
          tenantId,
          generation: fromGeneration,
          wrappedDek: currentWrap.wrappedDek,
        });
        const nextWrap = wrapDek({
          tenantId,
          generation: params.toGeneration,
          dek,
        });
        const nextObject: CoveredObject = {
          ...object,
          wraps: {
            ...object.wraps,
            [String(params.toGeneration)]: {
              generation: params.toGeneration,
              wrapKeyId: target.wrapKeyId,
              wrappedDek: nextWrap,
            },
          },
        };
        const receipt: RewrapReceipt = {
          kind: "p5_rewrap_receipt",
          receiptId: `rwr_${sha256(Buffer.from(`${object.resourceId}:${params.toGeneration}`, "utf8"))}`,
          tenantId,
          resourceId: object.resourceId,
          fromGeneration,
          toGeneration: params.toGeneration,
          wrapChecksum: sha256(Buffer.from(nextWrap, "utf8")),
          contentChecksum: sha256(Buffer.from(object.contentCiphertext, "utf8")),
          state: "applied",
        };
        objects[object.resourceId] = nextObject;
        rewrapReceipts[rewrapKey(object.resourceId, params.toGeneration)] = receipt;
        receipts.push(receipt);
      }
      return {
        ok: true,
        value: receipts,
        service: { ...service, objects, rewrapReceipts },
      };
    },
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: mutated.error as KeyRotationDenyCode };
}

export function commitActiveKeyGeneration(
  params: KeyManagementCommandParams & { toGeneration: number },
): KeyRotationResult<KeyRotationReceipt> {
  const authorized = authorizeKeyManagementCommand(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const mutated = mutateTenantKeyService({
    stateDir: params.stateDir,
    tenantId,
    fn: (service) => {
      const healthy = assertHealthyPointer(service);
      if (healthy) {
        return { ok: false, error: healthy };
      }
      const fromGeneration = service.activeKeyGeneration;
      const replayId = rotationReplayId(tenantId, fromGeneration, params.toGeneration);
      const receipt = service.rotationReceipts[replayId];
      const nextGen = service.generations[String(params.toGeneration)];
      const currentGen = service.generations[String(fromGeneration)];
      if (
        !receipt ||
        receipt.state !== "prepared" ||
        nextGen?.state !== "prepared" ||
        !currentGen
      ) {
        return { ok: false, error: "rotation_not_prepared" };
      }
      for (const resourceId of Object.keys(service.objects)) {
        const rewrap = service.rewrapReceipts[rewrapKey(resourceId, params.toGeneration)];
        if (rewrap?.state !== "applied") {
          return { ok: false, error: "rewrap_incomplete" };
        }
      }
      const applied: KeyRotationReceipt = { ...receipt, state: "applied" };
      return {
        ok: true,
        value: applied,
        service: {
          ...service,
          activeKeyGeneration: params.toGeneration,
          generations: {
            ...service.generations,
            [String(fromGeneration)]: { ...currentGen, state: "readable" },
            [String(params.toGeneration)]: { ...nextGen, state: "active" },
          },
          rotationReceipts: { ...service.rotationReceipts, [replayId]: applied },
        },
      };
    },
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: mutated.error as KeyRotationDenyCode };
}

export function reclaimOrphanWraps(params: KeyManagementCommandParams): KeyRotationResult<number> {
  const authorized = authorizeKeyManagementCommand(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const mutated = mutateTenantKeyService({
    stateDir: params.stateDir,
    tenantId,
    fn: (service) => {
      const healthy = assertHealthyPointer(service);
      if (healthy) {
        return { ok: false, error: healthy };
      }
      const active = service.activeKeyGeneration;
      let removed = 0;
      const objects: Record<string, CoveredObject> = {};
      for (const [resourceId, object] of Object.entries(service.objects)) {
        const wraps: CoveredObject["wraps"] = {};
        for (const [key, wrap] of Object.entries(object.wraps)) {
          const gen = service.generations[String(wrap.generation)];
          if (wrap.generation !== active && gen?.state === "prepared") {
            removed += 1;
            continue;
          }
          wraps[key] = wrap;
        }
        objects[resourceId] = { ...object, wraps };
      }
      const rewrapReceipts = Object.fromEntries(
        Object.entries(service.rewrapReceipts).filter(([, receipt]) => {
          const gen = service.generations[String(receipt.toGeneration)];
          return gen?.state !== "prepared";
        }),
      );
      return {
        ok: true,
        value: removed,
        service: { ...service, objects, rewrapReceipts },
      };
    },
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: mutated.error as KeyRotationDenyCode };
}

export function retireKeyGeneration(
  params: KeyManagementCommandParams & {
    generation: number;
    now: string;
    retireNotBefore: string;
  },
): KeyRotationResult<KeyRetireReceipt> {
  const authorized = authorizeKeyManagementCommand(params, "revoke");
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const nowMs = Date.parse(params.now);
  const ttlMs = Date.parse(params.retireNotBefore);
  if (!Number.isFinite(nowMs) || !Number.isFinite(ttlMs)) {
    return { ok: false, error: "retire_ttl_not_elapsed" };
  }
  const mutated = mutateTenantKeyService({
    stateDir: params.stateDir,
    tenantId,
    fn: (service) => {
      const healthy = assertHealthyPointer(service);
      if (healthy) {
        return { ok: false, error: healthy };
      }
      const target = service.generations[String(params.generation)];
      if (!target || target.state === "active" || target.state === "prepared") {
        return { ok: false, error: "retired_key_cannot_wrap" };
      }
      if (target.state === "retired") {
        const existing = Object.values(service.retireReceipts).find(
          (row) => row.generation === params.generation,
        );
        return existing
          ? { ok: true, value: existing, service }
          : { ok: false, error: "retired_key_reactivate_forbidden" };
      }
      if (Object.values(service.rotationReceipts).some((row) => row.state === "prepared")) {
        return { ok: false, error: "prepared_rotation_open" };
      }
      const successor = service.activeKeyGeneration;
      for (const object of Object.values(service.objects)) {
        if (!object.wraps[String(successor)]) {
          return { ok: false, error: "rewrap_incomplete" };
        }
      }
      if (nowMs < ttlMs) {
        return { ok: false, error: "retire_ttl_not_elapsed" };
      }
      const receipt: KeyRetireReceipt = {
        kind: "p5_key_retire_receipt",
        receiptId: `krt_${sha256(Buffer.from(`${tenantId}:${params.generation}`, "utf8"))}`,
        tenantId,
        generation: params.generation,
        retireNotBefore: params.retireNotBefore,
        retiredAt: params.now,
        state: "applied",
      };
      const objects: Record<string, CoveredObject> = {};
      for (const [resourceId, object] of Object.entries(service.objects)) {
        const wraps = { ...object.wraps };
        delete wraps[String(params.generation)];
        objects[resourceId] = { ...object, wraps };
      }
      return {
        ok: true,
        value: receipt,
        service: {
          ...service,
          generations: {
            ...service.generations,
            [String(params.generation)]: { ...target, state: "retired" },
          },
          retireReceipts: {
            ...service.retireReceipts,
            [String(params.generation)]: receipt,
          },
          objects,
        },
      };
    },
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: mutated.error as KeyRotationDenyCode };
}

export function reactivateRetiredKey(
  params: KeyManagementCommandParams & { generation: number },
): KeyRotationResult<never> {
  const authorized = authorizeKeyManagementCommand(params, "revoke");
  if (!authorized.ok) {
    return authorized;
  }
  const service = readTenantKeyService({
    stateDir: params.stateDir,
    tenantId: authorized.value.tenantId,
  });
  if (!service) {
    return { ok: false, error: "key_generation_corrupt" };
  }
  const target = service.generations[String(params.generation)];
  if (target?.state === "retired") {
    return { ok: false, error: "retired_key_reactivate_forbidden" };
  }
  return { ok: false, error: "key_generation_corrupt" };
}

export function decryptCoveredObject(
  params: KeyRotationAuthParams & { resourceId: string },
): KeyRotationResult<{ plaintext: Buffer; resourceId: string; usedGeneration: number }> {
  const authorized = authorizeKeyRotationCall(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const scoped = authorizeKeyResource({
    call: authorized.value.call,
    tenantId,
    stateDir: params.stateDir,
    resourceId: params.resourceId,
  });
  if (!scoped.ok) {
    return scoped;
  }
  if (!hmacSecret()) {
    return { ok: false, error: "key_ref_required" };
  }
  const service = readTenantKeyService({ stateDir: params.stateDir, tenantId });
  if (!service) {
    return { ok: false, error: "key_generation_corrupt" };
  }
  const healthy = assertHealthyPointer(service);
  if (healthy) {
    return { ok: false, error: healthy };
  }
  const object = service.objects[params.resourceId];
  if (!object) {
    return { ok: false, error: "object_not_found" };
  }
  if (object.tenantId !== tenantId) {
    return { ok: false, error: "envelope_tenant_mismatch" };
  }
  const readable = readableKeyGenerations(service);
  for (const generation of readable.toReversed()) {
    const wrap = object.wraps[String(generation)];
    if (!wrap) {
      continue;
    }
    try {
      const dek = unwrapDek({
        tenantId,
        generation,
        wrappedDek: wrap.wrappedDek,
      });
      const decipher = createDecipheriv(AES_ALGO, dek, Buffer.from(object.contentIv, "base64url"));
      decipher.setAuthTag(Buffer.from(object.contentTag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(object.contentCiphertext, "base64url")),
        decipher.final(),
      ]);
      return {
        ok: true,
        value: { plaintext, resourceId: object.resourceId, usedGeneration: generation },
      };
    } catch {
      // try next readable generation
    }
  }
  return { ok: false, error: "key_generation_corrupt" };
}

export function rewriteCiphertextForAlgorithmRetirement(
  params: KeyRotationAuthParams & { resourceId: string },
): KeyRotationResult<CoveredObject> {
  const authorized = authorizeKeyRotationCall(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const scoped = authorizeKeyResource({
    call: authorized.value.call,
    tenantId,
    stateDir: params.stateDir,
    resourceId: params.resourceId,
  });
  if (!scoped.ok) {
    return scoped;
  }
  if (!hmacSecret()) {
    return { ok: false, error: "key_ref_required" };
  }
  const mutated = mutateTenantKeyService({
    stateDir: params.stateDir,
    tenantId,
    fn: (service) => {
      const healthy = assertHealthyPointer(service);
      if (healthy) {
        return { ok: false, error: healthy };
      }
      const object = service.objects[params.resourceId];
      if (!object) {
        return { ok: false, error: "object_not_found" };
      }
      if (object.algorithm !== "aes-256-gcm-legacy") {
        return { ok: false, error: "algorithm_rewrite_not_required" };
      }
      const generation = service.activeKeyGeneration;
      const wrap = object.wraps[String(generation)] ?? object.wraps[String(generation - 1)];
      if (!wrap) {
        return { ok: false, error: "rewrap_incomplete" };
      }
      const dek = unwrapDek({
        tenantId,
        generation: wrap.generation,
        wrappedDek: wrap.wrappedDek,
      });
      const decipher = createDecipheriv(AES_ALGO, dek, Buffer.from(object.contentIv, "base64url"));
      decipher.setAuthTag(Buffer.from(object.contentTag, "base64url"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(object.contentCiphertext, "base64url")),
        decipher.final(),
      ]);
      const iv = randomBytes(12);
      const cipher = createCipheriv(AES_ALGO, dek, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const rewritten: CoveredObject = {
        ...object,
        algorithm: "aes-256-gcm",
        contentIv: iv.toString("base64url"),
        contentTag: cipher.getAuthTag().toString("base64url"),
        contentCiphertext: ciphertext.toString("base64url"),
      };
      return {
        ok: true,
        value: rewritten,
        service: {
          ...service,
          objects: { ...service.objects, [params.resourceId]: rewritten },
        },
      };
    },
  });
  return mutated.ok
    ? { ok: true, value: mutated.value }
    : { ok: false, error: mutated.error as KeyRotationDenyCode };
}

export function loadTenantKeyService(params: KeyManagementCommandParams): TenantKeyService | null {
  const authorized = authorizeKeyManagementCommand(params);
  if (!authorized.ok) {
    return null;
  }
  return readTenantKeyService({
    stateDir: params.stateDir,
    tenantId: authorized.value.tenantId,
  });
}

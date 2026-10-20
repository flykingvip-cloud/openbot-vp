/**
 * P4-c first-wave adapters: local filesystem + managed encrypted cloud.
 * P4-L-a/b/c/d later-wave adapters are implemented (tenant-cloud, dedicated, BYOS, cold-archive).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveContainedAdapterObjectPath } from "./cognitive-promotion-adapter-path.js";
import {
  wrapKeyIdForArchiveTenant,
  wrapKeyIdForByosCustomer,
  wrapKeyIdForDedicatedTenant,
  wrapKeyIdForTenant,
  type ArchiveTenantKeyRef,
  type ByosCustomerKeyRef,
  type DedicatedTenantKeyRef,
  type PlatformTenantKeyRef,
} from "./cognitive-promotion-key.js";
import {
  resolveByosRoot,
  resolveCloudProjectionRoot,
  resolveColdArchiveRoot,
  resolveDedicatedRegionalRoot,
  resolveManagedEncryptedCloudRoot,
  resolveTenantManagedCloudRoot,
} from "./paths.js";
import type { CloudProjectionEnvelope, StorageBinding } from "./types.js";

const AES_ALGO = "aes-256-gcm";

export type LaterWaveAdapterKind = "byos" | "tenant-cloud" | "cold-archive" | "dedicated";

export type AdapterDenyCode =
  | "first_wave_adapter_unavailable"
  | "key_tenant_mismatch"
  | "dedicated_key_unsupported"
  | "projection_envelope_invalid"
  | "canonical_bytes_missing"
  | "catalog_corrupt";

export type EncryptedCloudObject = {
  kind:
    | "managed_encrypted_cloud_object"
    | "tenant_managed_cloud_object"
    | "dedicated_regional_object"
    | "byos_object"
    | "cold_archive_object";
  tenantId: string;
  region: string;
  keyRefId: string;
  wrapKeyId: string;
  iv: string;
  tag: string;
  wrappedDek: string;
  ciphertext: string;
};

function durableWrite(dest: string, payload: string | Buffer): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest);
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function tenantDek(params: { tenantId: string; keyRefId: string }): Buffer {
  const secret = process.env.OPENBOT_PROMOTION_KEY_HMAC_KEY;
  if (!secret) {
    throw new Error("key_ref_required");
  }
  return createHash("sha256")
    .update(`dek:${params.tenantId}:${params.keyRefId}:${secret}`, "utf8")
    .digest();
}

function wrapDek(params: { tenantId: string; dek: Buffer; wrapKeyId?: string }): {
  iv: string;
  tag: string;
  wrappedDek: string;
} {
  const secret = process.env.OPENBOT_PROMOTION_KEY_HMAC_KEY;
  if (!secret) {
    throw new Error("key_ref_required");
  }
  const wrapKeyId = params.wrapKeyId ?? wrapKeyIdForTenant(params.tenantId);
  const wrap = createHash("sha256").update(`wrap-key:${wrapKeyId}:${secret}`, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGO, wrap, iv);
  const wrapped = Buffer.concat([cipher.update(params.dek), cipher.final()]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    wrappedDek: wrapped.toString("base64url"),
  };
}

export function hashCanonicalBytes(bytes: Buffer): string {
  return sha256Hex(bytes);
}

export function readLocalCanonicalBytes(locator: string): Buffer | null {
  if (!fs.existsSync(locator) || !fs.statSync(locator).isFile()) {
    return null;
  }
  return fs.readFileSync(locator);
}

export function writeLocalCanonicalBytes(params: { locator: string; bytes: Buffer }): void {
  durableWrite(params.locator, params.bytes);
}

function adapterObjectPath(
  root: string,
  params: { tenantId: string; region: string; objectKey: string },
): string {
  return resolveContainedAdapterObjectPath({
    root,
    tenantId: params.tenantId,
    region: params.region,
    objectKey: params.objectKey,
  });
}

function assertEncryptKeyKind(params: {
  keyRef: { kind: string; tenantId: string };
  tenantId: string;
  expected: "platform_tenant" | "dedicated_tenant" | "byos_customer" | "archive_tenant";
}): void {
  if (params.keyRef.tenantId !== params.tenantId) {
    throw new Error("key_tenant_mismatch");
  }
  if (params.keyRef.kind !== params.expected) {
    throw new Error("dedicated_key_unsupported");
  }
}

export function coldArchiveObjectPath(params: {
  stateDir: string;
  tenantId: string;
  region: string;
  objectKey: string;
}): string {
  return adapterObjectPath(resolveColdArchiveRoot(params.stateDir), params);
}

export function byosObjectPath(params: {
  stateDir: string;
  tenantId: string;
  region: string;
  objectKey: string;
}): string {
  return adapterObjectPath(resolveByosRoot(params.stateDir), params);
}

export function dedicatedRegionalObjectPath(params: {
  stateDir: string;
  tenantId: string;
  region: string;
  objectKey: string;
}): string {
  return adapterObjectPath(resolveDedicatedRegionalRoot(params.stateDir), params);
}

export function tenantManagedCloudObjectPath(params: {
  stateDir: string;
  tenantId: string;
  region: string;
  objectKey: string;
}): string {
  return adapterObjectPath(resolveTenantManagedCloudRoot(params.stateDir), params);
}

export function managedCloudObjectPath(params: {
  stateDir: string;
  tenantId: string;
  region: string;
  objectKey: string;
}): string {
  return adapterObjectPath(resolveManagedEncryptedCloudRoot(params.stateDir), params);
}

export function projectionEnvelopePath(params: {
  stateDir: string;
  tenantId: string;
  resourceId: string;
}): string {
  return path.join(
    resolveCloudProjectionRoot(params.stateDir),
    params.tenantId,
    `${params.resourceId}.json`,
  );
}

export function projectionBodyPath(params: {
  stateDir: string;
  tenantId: string;
  resourceId: string;
}): string {
  return path.join(
    resolveCloudProjectionRoot(params.stateDir),
    params.tenantId,
    `${params.resourceId}.body`,
  );
}

export function projectionTombstonePath(params: {
  stateDir: string;
  tenantId: string;
  resourceId: string;
}): string {
  return path.join(
    resolveCloudProjectionRoot(params.stateDir),
    params.tenantId,
    `${params.resourceId}.tombstone`,
  );
}

export function encryptColdArchiveObject(params: {
  bytes: Buffer;
  tenantId: string;
  region: string;
  keyRef: ArchiveTenantKeyRef;
}): EncryptedCloudObject {
  assertEncryptKeyKind({
    keyRef: params.keyRef,
    tenantId: params.tenantId,
    expected: "archive_tenant",
  });
  const dek = tenantDek({ tenantId: params.tenantId, keyRefId: params.keyRef.keyRefId });
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGO, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(params.bytes), cipher.final()]);
  const wrapKeyId = wrapKeyIdForArchiveTenant(params.tenantId);
  const wrapped = wrapDek({ tenantId: params.tenantId, dek, wrapKeyId });
  return {
    kind: "cold_archive_object",
    tenantId: params.tenantId,
    region: params.region,
    keyRefId: params.keyRef.keyRefId,
    wrapKeyId,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    wrappedDek: `${wrapped.iv}.${wrapped.tag}.${wrapped.wrappedDek}`,
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function encryptByosObject(params: {
  bytes: Buffer;
  tenantId: string;
  region: string;
  keyRef: ByosCustomerKeyRef;
}): EncryptedCloudObject {
  assertEncryptKeyKind({
    keyRef: params.keyRef,
    tenantId: params.tenantId,
    expected: "byos_customer",
  });
  const dek = tenantDek({ tenantId: params.tenantId, keyRefId: params.keyRef.keyRefId });
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGO, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(params.bytes), cipher.final()]);
  const wrapKeyId = wrapKeyIdForByosCustomer(params.tenantId);
  const wrapped = wrapDek({ tenantId: params.tenantId, dek, wrapKeyId });
  return {
    kind: "byos_object",
    tenantId: params.tenantId,
    region: params.region,
    keyRefId: params.keyRef.keyRefId,
    wrapKeyId,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    wrappedDek: `${wrapped.iv}.${wrapped.tag}.${wrapped.wrappedDek}`,
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function encryptDedicatedRegionalObject(params: {
  bytes: Buffer;
  tenantId: string;
  region: string;
  keyRef: DedicatedTenantKeyRef;
}): EncryptedCloudObject {
  assertEncryptKeyKind({
    keyRef: params.keyRef,
    tenantId: params.tenantId,
    expected: "dedicated_tenant",
  });
  const dek = tenantDek({ tenantId: params.tenantId, keyRefId: params.keyRef.keyRefId });
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGO, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(params.bytes), cipher.final()]);
  const wrapKeyId = wrapKeyIdForDedicatedTenant(params.tenantId);
  const wrapped = wrapDek({ tenantId: params.tenantId, dek, wrapKeyId });
  return {
    kind: "dedicated_regional_object",
    tenantId: params.tenantId,
    region: params.region,
    keyRefId: params.keyRef.keyRefId,
    wrapKeyId,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    wrappedDek: `${wrapped.iv}.${wrapped.tag}.${wrapped.wrappedDek}`,
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function encryptTenantManagedCloudObject(params: {
  bytes: Buffer;
  tenantId: string;
  region: string;
  keyRef: PlatformTenantKeyRef;
}): EncryptedCloudObject {
  assertEncryptKeyKind({
    keyRef: params.keyRef,
    tenantId: params.tenantId,
    expected: "platform_tenant",
  });
  const encrypted = encryptManagedCloudObject(params);
  return { ...encrypted, kind: "tenant_managed_cloud_object" };
}

export function encryptManagedCloudObject(params: {
  bytes: Buffer;
  tenantId: string;
  region: string;
  keyRef: PlatformTenantKeyRef;
}): EncryptedCloudObject {
  assertEncryptKeyKind({
    keyRef: params.keyRef,
    tenantId: params.tenantId,
    expected: "platform_tenant",
  });
  const dek = tenantDek({ tenantId: params.tenantId, keyRefId: params.keyRef.keyRefId });
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGO, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(params.bytes), cipher.final()]);
  const wrapped = wrapDek({ tenantId: params.tenantId, dek });
  return {
    kind: "managed_encrypted_cloud_object",
    tenantId: params.tenantId,
    region: params.region,
    keyRefId: params.keyRef.keyRefId,
    wrapKeyId: wrapKeyIdForTenant(params.tenantId),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    wrappedDek: `${wrapped.iv}.${wrapped.tag}.${wrapped.wrappedDek}`,
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function writeColdArchiveObject(params: {
  stateDir: string;
  objectKey: string;
  object: EncryptedCloudObject;
}): string {
  const dest = coldArchiveObjectPath({
    stateDir: params.stateDir,
    tenantId: params.object.tenantId,
    region: params.object.region,
    objectKey: params.objectKey,
  });
  durableWrite(dest, `${JSON.stringify(params.object, null, 2)}\n`);
  return dest;
}

export function writeByosObject(params: {
  stateDir: string;
  objectKey: string;
  object: EncryptedCloudObject;
}): string {
  const dest = byosObjectPath({
    stateDir: params.stateDir,
    tenantId: params.object.tenantId,
    region: params.object.region,
    objectKey: params.objectKey,
  });
  durableWrite(dest, `${JSON.stringify(params.object, null, 2)}\n`);
  return dest;
}

export function writeDedicatedRegionalObject(params: {
  stateDir: string;
  objectKey: string;
  object: EncryptedCloudObject;
}): string {
  const dest = dedicatedRegionalObjectPath({
    stateDir: params.stateDir,
    tenantId: params.object.tenantId,
    region: params.object.region,
    objectKey: params.objectKey,
  });
  durableWrite(dest, `${JSON.stringify(params.object, null, 2)}\n`);
  return dest;
}

export function writeTenantManagedCloudObject(params: {
  stateDir: string;
  objectKey: string;
  object: EncryptedCloudObject;
}): string {
  const dest = tenantManagedCloudObjectPath({
    stateDir: params.stateDir,
    tenantId: params.object.tenantId,
    region: params.object.region,
    objectKey: params.objectKey,
  });
  durableWrite(dest, `${JSON.stringify(params.object, null, 2)}\n`);
  return dest;
}

export function writeManagedEncryptedCloudObject(params: {
  stateDir: string;
  objectKey: string;
  object: EncryptedCloudObject;
}): string {
  const dest = managedCloudObjectPath({
    stateDir: params.stateDir,
    tenantId: params.object.tenantId,
    region: params.object.region,
    objectKey: params.objectKey,
  });
  durableWrite(dest, `${JSON.stringify(params.object, null, 2)}\n`);
  return dest;
}

export function unlinkColdArchiveObject(params: {
  stateDir: string;
  tenantId: string;
  region: string;
  objectKey: string;
}): void {
  const dest = coldArchiveObjectPath(params);
  if (fs.existsSync(dest)) {
    fs.unlinkSync(dest);
  }
}

export function unlinkByosObject(params: {
  stateDir: string;
  tenantId: string;
  region: string;
  objectKey: string;
}): void {
  const dest = byosObjectPath(params);
  if (fs.existsSync(dest)) {
    fs.unlinkSync(dest);
  }
}

export function unlinkDedicatedRegionalObject(params: {
  stateDir: string;
  tenantId: string;
  region: string;
  objectKey: string;
}): void {
  const dest = dedicatedRegionalObjectPath(params);
  if (fs.existsSync(dest)) {
    fs.unlinkSync(dest);
  }
}

export function unlinkTenantManagedCloudObject(params: {
  stateDir: string;
  tenantId: string;
  region: string;
  objectKey: string;
}): void {
  const dest = tenantManagedCloudObjectPath(params);
  if (fs.existsSync(dest)) {
    fs.unlinkSync(dest);
  }
}

export function unlinkManagedEncryptedCloudObject(params: {
  stateDir: string;
  tenantId: string;
  region: string;
  objectKey: string;
}): void {
  const dest = managedCloudObjectPath(params);
  if (fs.existsSync(dest)) {
    fs.unlinkSync(dest);
  }
}

export function parseCloudProjectionEnvelope(value: unknown): CloudProjectionEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const strings = [
    "resourceId",
    "scope",
    "privacyLevel",
    "contentVersion",
    "checksum",
    "consentVersion",
    "policyVersion",
  ] as const;
  for (const key of strings) {
    if (typeof raw[key] !== "string" || raw[key].trim() === "") {
      return null;
    }
  }
  if (
    !Array.isArray(raw.permittedClaims) ||
    !raw.permittedClaims.every((c): c is string => typeof c === "string")
  ) {
    return null;
  }
  if (
    !Array.isArray(raw.provenanceRefs) ||
    !raw.provenanceRefs.every((c): c is string => typeof c === "string")
  ) {
    return null;
  }
  if (
    typeof raw.tombstoneVersion !== "number" ||
    !Number.isInteger(raw.tombstoneVersion) ||
    raw.tombstoneVersion < 0
  ) {
    return null;
  }
  if (raw.atomId !== undefined && raw.atomId !== null && typeof raw.atomId !== "string") {
    return null;
  }
  return {
    resourceId: raw.resourceId as string,
    ...(raw.atomId === undefined ? {} : { atomId: raw.atomId }),
    permittedClaims: raw.permittedClaims,
    scope: raw.scope as string,
    privacyLevel: raw.privacyLevel as string,
    contentVersion: raw.contentVersion as string,
    checksum: raw.checksum as string,
    provenanceRefs: raw.provenanceRefs,
    consentVersion: raw.consentVersion as string,
    policyVersion: raw.policyVersion as string,
    tombstoneVersion: raw.tombstoneVersion,
  };
}

export function writeCloudProjection(params: {
  stateDir: string;
  tenantId: string;
  envelope: CloudProjectionEnvelope;
  encryptedBody: EncryptedCloudObject;
}): { envelopePath: string; bodyPath: string } {
  const parsed = parseCloudProjectionEnvelope(params.envelope);
  if (!parsed) {
    throw new Error("projection_envelope_invalid");
  }
  const envelopePath = projectionEnvelopePath({
    stateDir: params.stateDir,
    tenantId: params.tenantId,
    resourceId: parsed.resourceId,
  });
  const bodyPath = projectionBodyPath({
    stateDir: params.stateDir,
    tenantId: params.tenantId,
    resourceId: parsed.resourceId,
  });
  durableWrite(envelopePath, `${JSON.stringify(parsed, null, 2)}\n`);
  durableWrite(bodyPath, `${JSON.stringify(params.encryptedBody, null, 2)}\n`);
  return { envelopePath, bodyPath };
}

export function readCloudProjectionEnvelope(params: {
  stateDir: string;
  tenantId: string;
  resourceId: string;
}): CloudProjectionEnvelope | null {
  const dest = projectionEnvelopePath(params);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return parseCloudProjectionEnvelope(JSON.parse(fs.readFileSync(dest, "utf8")));
  } catch {
    return null;
  }
}

export function writeProjectionTombstone(params: {
  stateDir: string;
  tenantId: string;
  envelope: CloudProjectionEnvelope;
}): { path: string; checksum: string } {
  const parsed = parseCloudProjectionEnvelope(params.envelope);
  if (!parsed) {
    throw new Error("projection_envelope_invalid");
  }
  const payload = `${JSON.stringify(parsed, null, 2)}\n`;
  const dest = projectionTombstonePath({
    stateDir: params.stateDir,
    tenantId: params.tenantId,
    resourceId: parsed.resourceId,
  });
  durableWrite(dest, payload);
  return { path: dest, checksum: sha256Hex(Buffer.from(payload, "utf8")) };
}

export function readProjectionTombstone(params: {
  stateDir: string;
  tenantId: string;
  resourceId: string;
}): CloudProjectionEnvelope | null {
  const dest = projectionTombstonePath(params);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return parseCloudProjectionEnvelope(JSON.parse(fs.readFileSync(dest, "utf8")));
  } catch {
    return null;
  }
}

export function markProjectionBodyUnreadable(params: {
  stateDir: string;
  tenantId: string;
  resourceId: string;
}): void {
  const dest = projectionBodyPath(params);
  if (fs.existsSync(dest)) {
    fs.unlinkSync(dest);
  }
}

export type LaterWaveAdapterAvailability =
  | { ok: false; error: "first_wave_adapter_unavailable" }
  | { ok: true; adapter: "tenant-cloud" | "dedicated" | "byos" | "cold-archive" };

export function laterWaveAdapterAvailability(
  kind: LaterWaveAdapterKind,
): LaterWaveAdapterAvailability {
  if (kind === "tenant-cloud") {
    return { ok: true, adapter: "tenant-cloud" };
  }
  if (kind === "dedicated") {
    return { ok: true, adapter: "dedicated" };
  }
  if (kind === "byos") {
    return { ok: true, adapter: "byos" };
  }
  if (kind === "cold-archive") {
    return { ok: true, adapter: "cold-archive" };
  }
  return { ok: false, error: "first_wave_adapter_unavailable" };
}

export function laterWaveAdapterUnavailable(
  kind: LaterWaveAdapterKind,
): LaterWaveAdapterAvailability {
  return laterWaveAdapterAvailability(kind);
}

export function countWritableCanonicals(bindings: readonly StorageBinding[]): number {
  return bindings.filter((binding) => binding.role === "canonical" && binding.state === "active")
    .length;
}

export function catalogProjectionFields(envelope: CloudProjectionEnvelope): Record<string, string> {
  return {
    checksum: envelope.checksum,
    consentVersion: envelope.consentVersion,
    contentVersion: envelope.contentVersion,
    policyVersion: envelope.policyVersion,
    tombstoneVersion: String(envelope.tombstoneVersion),
  };
}

/** Decrypt is test/read-path only; never used to resurrect a tombstoned body. */
export function decryptManagedCloudObjectForTests(object: EncryptedCloudObject): Buffer {
  const dek = tenantDek({ tenantId: object.tenantId, keyRefId: object.keyRefId });
  const decipher = createDecipheriv(AES_ALGO, dek, Buffer.from(object.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(object.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(object.ciphertext, "base64url")),
    decipher.final(),
  ]);
}

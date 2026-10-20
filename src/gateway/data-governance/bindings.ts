import { CATALOG_FIELD_LIMITS } from "./limits.js";
import type { StorageBinding, StorageRole } from "./types.js";

const ROLES = new Set<StorageRole>([
  "canonical",
  "replica",
  "derived",
  "archive",
  "cache",
  "compatibility",
]);

const STORAGE_KINDS = new Set<StorageBinding["storageKind"]>([
  "filesystem",
  "sqlite",
  "postgres",
  "object-store",
  "byos",
]);

const STATES = new Set<StorageBinding["state"]>(["active", "read_only", "retired"]);

const BINDING_KEYS = new Set([
  "bindingId",
  "resourceId",
  "role",
  "storageKind",
  "locator",
  "state",
  "contentVersion",
  "objectKey",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Strict whitelist parse of StorageBinding[]. Rejects unknown keys and enforces
 * single active canonical matching envelope.canonicalBindingId.
 */
export function parseCatalogBindings(params: {
  bindings: unknown;
  resourceId: string;
  canonicalBindingId: string;
}): StorageBinding[] {
  if (!Array.isArray(params.bindings) || params.bindings.length === 0) {
    throw new Error("governance_catalog_invalid:bindings_required");
  }
  if (params.bindings.length > CATALOG_FIELD_LIMITS.maxBindingsPerRecord) {
    throw new Error("governance_catalog_invalid:too_many_bindings");
  }

  const parsed: StorageBinding[] = [];
  const seenIds = new Set<string>();

  for (const item of params.bindings) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("governance_catalog_invalid:binding_not_object");
    }
    const raw = item as Record<string, unknown>;
    for (const key of Object.keys(raw)) {
      if (!BINDING_KEYS.has(key)) {
        throw new Error(`governance_catalog_invalid:unknown_binding_field:${key}`);
      }
    }
    if (
      !isNonEmptyString(raw.bindingId) ||
      raw.bindingId.length > CATALOG_FIELD_LIMITS.bindingIdMax
    ) {
      throw new Error("governance_catalog_invalid:binding_id");
    }
    if (seenIds.has(raw.bindingId)) {
      throw new Error("governance_catalog_invalid:duplicate_binding_id");
    }
    seenIds.add(raw.bindingId);

    if (!isNonEmptyString(raw.resourceId) || raw.resourceId !== params.resourceId) {
      throw new Error("governance_catalog_invalid:binding_resource_mismatch");
    }
    if (!isNonEmptyString(raw.role) || !ROLES.has(raw.role as StorageRole)) {
      throw new Error("governance_catalog_invalid:binding_role");
    }
    if (
      !isNonEmptyString(raw.storageKind) ||
      !STORAGE_KINDS.has(raw.storageKind as StorageBinding["storageKind"])
    ) {
      throw new Error("governance_catalog_invalid:binding_storage_kind");
    }
    if (!isNonEmptyString(raw.locator) || raw.locator.length > CATALOG_FIELD_LIMITS.locatorMax) {
      throw new Error("governance_catalog_invalid:binding_locator");
    }
    if (!isNonEmptyString(raw.state) || !STATES.has(raw.state as StorageBinding["state"])) {
      throw new Error("governance_catalog_invalid:binding_state");
    }
    if (
      !isNonEmptyString(raw.contentVersion) ||
      raw.contentVersion.length > CATALOG_FIELD_LIMITS.contentVersionMax
    ) {
      throw new Error("governance_catalog_invalid:binding_content_version");
    }
    let objectKey: string | null | undefined;
    if (raw.objectKey !== undefined && raw.objectKey !== null) {
      if (
        !isNonEmptyString(raw.objectKey) ||
        raw.objectKey.length > CATALOG_FIELD_LIMITS.bindingIdMax
      ) {
        throw new Error("governance_catalog_invalid:binding_object_key");
      }
      objectKey = raw.objectKey.trim();
    } else if (raw.objectKey === null) {
      objectKey = null;
    }

    parsed.push({
      bindingId: raw.bindingId.trim(),
      resourceId: params.resourceId,
      role: raw.role as StorageRole,
      storageKind: raw.storageKind as StorageBinding["storageKind"],
      locator: raw.locator.trim(),
      state: raw.state as StorageBinding["state"],
      contentVersion: raw.contentVersion.trim(),
      ...(objectKey !== undefined ? { objectKey } : {}),
    });
  }

  const activeCanonicals = parsed.filter((b) => b.role === "canonical" && b.state === "active");
  if (activeCanonicals.length === 0) {
    throw new Error("governance_catalog_invalid:canonical_binding_missing");
  }
  if (activeCanonicals.length > 1) {
    throw new Error("governance_catalog_invalid:multiple_active_canonicals");
  }
  const canonical = activeCanonicals[0];
  if (canonical.bindingId !== params.canonicalBindingId) {
    throw new Error("governance_catalog_invalid:canonical_id_mismatch");
  }
  // Named canonicalBindingId must not point at a non-active/non-canonical row.
  const named = parsed.find((b) => b.bindingId === params.canonicalBindingId);
  if (!named || named.role !== "canonical" || named.state !== "active") {
    throw new Error("governance_catalog_invalid:canonical_binding_inactive");
  }

  return parsed;
}

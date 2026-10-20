/**
 * On-disk persistence for `LocalDeviceBinding`.
 *
 * A binding is the sole authority for "which device, which user, which digital
 * humans" (design 4.3), so it has to outlive a gateway restart — otherwise every
 * restart silently revokes disk access for every user.
 *
 * Follows the device-pairing store conventions: atomic write, `0o600`, and a
 * versioned envelope so a future shape change is detectable rather than silently
 * misread.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { writeJsonAtomic } from "../infra/json-files.js";
import {
  LOCAL_FILES_OPERATIONS,
  LOCAL_FILES_READONLY_PROFILE,
  type LocalDeviceBinding,
  type LocalFilesOperation,
  type RememberedLocalGrant,
} from "./types.js";

const BINDINGS_FILE = "local-files-bindings.json";

type StoredBindings = {
  version: 1;
  bindings: LocalDeviceBinding[];
};

export function resolveLocalDeviceBindingsPath(baseDir?: string): string {
  return path.join(baseDir ?? resolveStateDir(), BINDINGS_FILE);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate a stored record before it is trusted.
 *
 * A malformed or partially-written entry is dropped rather than coerced: a binding
 * with a missing field would otherwise become an authorization decision made on
 * defaults.
 */
export function parseStoredBinding(value: unknown): LocalDeviceBinding | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const r = value as Record<string, unknown>;
  if (
    !isNonEmptyString(r.tenantId) ||
    !isNonEmptyString(r.userId) ||
    !isNonEmptyString(r.nodeId) ||
    !isNonEmptyString(r.devicePublicKey)
  ) {
    return null;
  }
  if (r.capabilityProfile !== LOCAL_FILES_READONLY_PROFILE) {
    return null;
  }
  if (r.status !== "active" && r.status !== "revoked") {
    return null;
  }
  if (!Array.isArray(r.allowedAgentIds) || !r.allowedAgentIds.every(isNonEmptyString)) {
    return null;
  }
  if (typeof r.createdAtMs !== "number" || !Number.isFinite(r.createdAtMs)) {
    return null;
  }
  const binding: LocalDeviceBinding = {
    tenantId: r.tenantId,
    userId: r.userId,
    nodeId: r.nodeId,
    devicePublicKey: r.devicePublicKey,
    allowedAgentIds: [...r.allowedAgentIds],
    capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
    status: r.status,
    createdAtMs: r.createdAtMs,
  };
  if (typeof r.revokedAtMs === "number" && Number.isFinite(r.revokedAtMs)) {
    binding.revokedAtMs = r.revokedAtMs;
  }
  const remembered = parseRememberedGrants(r.rememberedGrants);
  if (remembered.length > 0) {
    binding.rememberedGrants = remembered;
  }
  return binding;
}

function parseRememberedGrants(value: unknown): RememberedLocalGrant[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const grants: RememberedLocalGrant[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const grant = entry as Record<string, unknown>;
    const canonicalPath = typeof grant.canonicalPath === "string" ? grant.canonicalPath.trim() : "";
    const targetKind =
      grant.targetKind === "file" || grant.targetKind === "directory" ? grant.targetKind : null;
    if (!canonicalPath || !targetKind || !Array.isArray(grant.operations)) {
      continue;
    }
    const operations = grant.operations.filter(
      (op): op is LocalFilesOperation =>
        typeof op === "string" && (LOCAL_FILES_OPERATIONS as readonly string[]).includes(op),
    );
    if (operations.length === 0) {
      continue;
    }
    grants.push({ canonicalPath, targetKind, operations });
  }
  return grants;
}

export type LocalDeviceBindingPersistence = {
  load(): Promise<LocalDeviceBinding[]>;
  save(bindings: readonly LocalDeviceBinding[]): Promise<void>;
};

/**
 * File-backed persistence.
 *
 * A missing file means "no bindings", which is the fail-closed reading: no device
 * may be read from. A corrupt file also yields no bindings rather than a partial
 * set, so a damaged store denies access instead of granting a subset nobody
 * intended.
 */
export function createFileBindingPersistence(baseDir?: string): LocalDeviceBindingPersistence {
  const filePath = resolveLocalDeviceBindingsPath(baseDir);
  return {
    async load(): Promise<LocalDeviceBinding[]> {
      let raw: string;
      try {
        raw = await fs.readFile(filePath, "utf8");
      } catch {
        return [];
      }
      try {
        const parsed = JSON.parse(raw) as StoredBindings;
        if (parsed?.version !== 1 || !Array.isArray(parsed.bindings)) {
          return [];
        }
        return parsed.bindings
          .map(parseStoredBinding)
          .filter((entry): entry is LocalDeviceBinding => entry !== null);
      } catch {
        return [];
      }
    },
    async save(bindings: readonly LocalDeviceBinding[]): Promise<void> {
      const stored: StoredBindings = { version: 1, bindings: [...bindings] };
      await writeJsonAtomic(filePath, stored, { mode: 0o600 });
    },
  };
}

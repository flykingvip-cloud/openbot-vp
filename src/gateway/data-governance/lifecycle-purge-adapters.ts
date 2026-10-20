/**
 * P2-d / P2-e purge destructive adapters.
 *
 * Cloud / object-store without a registered adapter → fail closed (no success stub).
 * PostgreSQL → fail closed (dedicated adapter missing; never filesystem rm).
 * SQLite → filesystem eraser only when locator is a local file shape.
 * Filesystem and SQLite erasers require allowedRoots containment (not locator self-auth).
 */

import {
  assertPurgePathContained,
  isLocalSqliteFileShape,
  removePathDurable,
} from "./lifecycle-durable-fs.js";
import type { CatalogRecord, GovernanceDeletionAuthMarker, GovernedResourceType } from "./types.js";

export type PurgeEraseTarget = {
  bindingId: string;
  locator: string;
  objectKey: string | null;
};

export type PurgeDestructiveOutcome = {
  status: "succeeded" | "failed";
  errorCode?: string;
};

export type PurgeDestructiveContext = {
  record: CatalogRecord;
  marker: GovernanceDeletionAuthMarker;
  eraseTarget: PurgeEraseTarget;
  /**
   * Server-derived (or handle-validated) storage roots. Never a caller path list.
   */
  allowedRoots: string[];
};

/**
 * Filesystem erase using Catalog-derived eraseTarget only after allowed-root
 * containment of the real path and parent directory.
 * Missing path still parent-dir fsyncs before success (restart resume).
 * fsync unsupported/failed → fail closed (never treated as purged).
 */
export async function eraseFilesystemCanonical(
  ctx: PurgeDestructiveContext,
): Promise<PurgeDestructiveOutcome> {
  const contained = assertPurgePathContained({
    locator: ctx.eraseTarget.locator,
    allowedRoots: ctx.allowedRoots,
  });
  if (!contained.ok) {
    return { status: "failed", errorCode: contained.reason };
  }
  try {
    removePathDurable(ctx.eraseTarget.locator);
    return { status: "succeeded" };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    return {
      status: "failed",
      errorCode: msg.startsWith("dir_fsync_failed:")
        ? msg
        : `filesystem_erase_failed:${msg.slice(0, 160)}`,
    };
  }
}

/**
 * Object-store / BYOS: P2 has no cloud adapter → fail closed (gate: no success stub).
 */
export async function eraseCloudFailClosed(
  ctx: PurgeDestructiveContext,
): Promise<PurgeDestructiveOutcome> {
  void ctx;
  return {
    status: "failed",
    errorCode: "cloud_purge_adapter_missing",
  };
}

async function erasePostgresFailClosed(
  ctx: PurgeDestructiveContext,
): Promise<PurgeDestructiveOutcome> {
  void ctx;
  return {
    status: "failed",
    errorCode: "postgres_purge_adapter_missing",
  };
}

async function eraseSqliteNonLocalFailClosed(
  ctx: PurgeDestructiveContext,
): Promise<PurgeDestructiveOutcome> {
  void ctx;
  return {
    status: "failed",
    errorCode: "sqlite_locator_not_local_file",
  };
}

/**
 * Resolve destructive adapter for a Catalog record.
 * - objectKey set or storageKind object-store/byos → cloud fail-closed
 * - postgres → dedicated adapter missing (never filesystem rm)
 * - sqlite → filesystem erase only for a local file shape; containment is enforced at erase
 * - filesystem → durable filesystem erase with the same containment
 */
export function resolvePurgeDestructiveAdapter(
  record: CatalogRecord,
): (ctx: PurgeDestructiveContext) => Promise<PurgeDestructiveOutcome> {
  const canonical =
    record.bindings.find((b) => b.bindingId === record.envelope.canonicalBindingId) ??
    record.bindings.find((b) => b.role === "canonical");
  if (!canonical) {
    return async () => ({ status: "failed", errorCode: "missing_canonical_binding" });
  }
  if (
    canonical.objectKey ||
    canonical.storageKind === "object-store" ||
    canonical.storageKind === "byos"
  ) {
    return eraseCloudFailClosed;
  }
  if (canonical.storageKind === "postgres") {
    return erasePostgresFailClosed;
  }
  if (canonical.storageKind === "sqlite") {
    if (!isLocalSqliteFileShape(canonical.locator)) {
      return eraseSqliteNonLocalFailClosed;
    }
    return eraseFilesystemCanonical;
  }
  if (canonical.storageKind === "filesystem") {
    return eraseFilesystemCanonical;
  }
  return async () => ({ status: "failed", errorCode: "unsupported_storage_kind" });
}

/** Types with a registered local purge destructive path in P2. */
export const P2_PURGE_ADAPTER_RESOURCE_TYPES: readonly GovernedResourceType[] = [
  "conversation_archive",
  "memory",
  "workspace",
  "agent",
  "knowledge",
  "operational_identity",
] as const;

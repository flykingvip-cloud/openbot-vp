/**
 * Resolver-issued purge storage handle.
 * Roots are server-derived at issue time; resume re-checks binding and that
 * handle roots stay inside the trusted tenant root (no caller expansion).
 */

import {
  isPathInsideOrEqualRoot,
  normalizePurgeAllowedRoots,
  resolvePurgeAllowedRoots,
} from "./lifecycle-durable-fs.js";
import type { CatalogRecord } from "./types.js";

export type PurgeStorageHandle = {
  resourceId: string;
  tenantId: string | null;
  bindingId: string;
  operationId: string;
  allowedRoots: readonly string[];
};

export function issuePurgeStorageHandle(params: {
  record: CatalogRecord;
  operationId: string;
  stateDir?: string;
}): { ok: true; handle: PurgeStorageHandle } | { ok: false; reason: string } {
  const canonical =
    params.record.bindings.find(
      (b) => b.bindingId === params.record.envelope.canonicalBindingId && b.role === "canonical",
    ) ?? params.record.bindings.find((b) => b.role === "canonical");
  if (!canonical) {
    return { ok: false, reason: "missing_canonical" };
  }
  const allowedRoots = resolvePurgeAllowedRoots({
    tenantId: params.record.envelope.tenantId,
    stateDir: params.stateDir,
  });
  if (normalizePurgeAllowedRoots(allowedRoots).length === 0) {
    return { ok: false, reason: "purge_allowed_roots_missing" };
  }
  return {
    ok: true,
    handle: {
      resourceId: params.record.envelope.resourceId,
      tenantId: params.record.envelope.tenantId,
      bindingId: canonical.bindingId,
      operationId: params.operationId,
      allowedRoots,
    },
  };
}

export function validatePurgeStorageHandle(params: {
  handle: PurgeStorageHandle;
  record: CatalogRecord;
  operationId: string;
  trustedRoots: string[];
}): { ok: true; allowedRoots: string[] } | { ok: false; reason: string } {
  const canonical =
    params.record.bindings.find(
      (b) => b.bindingId === params.record.envelope.canonicalBindingId && b.role === "canonical",
    ) ?? params.record.bindings.find((b) => b.role === "canonical");
  if (!canonical) {
    return { ok: false, reason: "missing_canonical" };
  }
  if (params.handle.resourceId !== params.record.envelope.resourceId) {
    return { ok: false, reason: "purge_handle_resource_mismatch" };
  }
  if (params.handle.tenantId !== params.record.envelope.tenantId) {
    return { ok: false, reason: "purge_handle_tenant_mismatch" };
  }
  if (params.handle.bindingId !== canonical.bindingId) {
    return { ok: false, reason: "purge_handle_binding_mismatch" };
  }
  if (params.handle.operationId !== params.operationId) {
    return { ok: false, reason: "purge_handle_operation_mismatch" };
  }
  const trusted = normalizePurgeAllowedRoots(params.trustedRoots);
  if (trusted.length === 0) {
    return { ok: false, reason: "purge_allowed_roots_missing" };
  }
  const handleRoots = normalizePurgeAllowedRoots([...params.handle.allowedRoots]);
  if (handleRoots.length === 0) {
    return { ok: false, reason: "purge_handle_root_not_contained" };
  }
  for (const handleRoot of handleRoots) {
    if (!trusted.some((root) => isPathInsideOrEqualRoot(root, handleRoot))) {
      return { ok: false, reason: "purge_handle_root_not_contained" };
    }
  }
  return { ok: true, allowedRoots: handleRoots };
}

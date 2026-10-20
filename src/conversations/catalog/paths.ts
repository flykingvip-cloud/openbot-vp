/**
 * Catalog paths: canonical under Data Root (never State Dir unique copy).
 * Plan §4.3 / §3.6.
 *
 * Managed multi-tenant: Catalog lives under the tenant live root
 * (`OPENBOT_TENANTS_ROOT/<tid>/.meta/conversations/catalog.sqlite`) so planes
 * never share a sqlite file. Callers should pass dataRoot from
 * resolveConversationDataRoot / ManagedPlaneTarget when known.
 */
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { isManagedDataMode, resolveDataRoot } from "../../config/data-space.js";
import { resolveTenantLiveRoot } from "../../gateway/tenant-store-paths.js";
import type { ConversationTenantContext } from "../types.js";

/** Portable catalog location under Data Space. */
export function resolveConversationCatalogPath(params: {
  cfg?: OpenBotConfig;
  dataRoot?: string;
  ctx?: Pick<ConversationTenantContext, "dataPlaneId" | "mode" | "tenantId">;
}): string {
  // Explicit dataRoot wins (system jobs pass tenant live root).
  if (params.dataRoot) {
    return path.join(params.dataRoot, ".meta", "conversations", "catalog.sqlite");
  }

  if (params.ctx?.mode === "managed" && params.ctx.tenantId) {
    try {
      const tenantRoot = resolveTenantLiveRoot(params.ctx.tenantId);
      return path.join(tenantRoot, ".meta", "conversations", "catalog.sqlite");
    } catch {
      // fall through to shared data root partition
    }
    const dataRoot = resolveDataRoot(params.cfg);
    return path.join(
      dataRoot,
      ".meta",
      "conversations",
      "tenants",
      params.ctx.tenantId,
      "catalog.sqlite",
    );
  }

  if (isManagedDataMode(params.cfg) && params.ctx?.tenantId) {
    try {
      const tenantRoot = resolveTenantLiveRoot(params.ctx.tenantId);
      return path.join(tenantRoot, ".meta", "conversations", "catalog.sqlite");
    } catch {
      // ignore
    }
  }

  const dataRoot = resolveDataRoot(params.cfg);
  return path.join(dataRoot, ".meta", "conversations", "catalog.sqlite");
}

export function resolveConversationArchiveRoot(params: {
  cfg?: OpenBotConfig;
  dataRoot?: string;
}): string {
  const dataRoot = params.dataRoot ?? resolveDataRoot(params.cfg);
  return path.join(dataRoot, "conversations", "archive");
}

export function resolveConversationExportsRoot(params: {
  cfg?: OpenBotConfig;
  dataRoot?: string;
}): string {
  const dataRoot = params.dataRoot ?? resolveDataRoot(params.cfg);
  return path.join(dataRoot, "conversations", "exports");
}

/** Rebuildable projection cache may live under state dir; not canonical. */
export function resolveConversationProjectionStateDir(stateDir: string): string {
  return path.join(stateDir, "conversations", "projections");
}

/**
 * Resolve Catalog conversationId/bindingId for a session transcript seal.
 * Prefer existing binding; optionally lazy-backfill Conversation when enabled.
 */
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveConversationCatalogPath } from "../conversations/catalog/paths.js";
import { SqliteConversationCatalog } from "../conversations/catalog/sqlite-catalog.js";
import { resolveConversationFlags } from "../conversations/flags.js";
import {
  deriveBindingIdFromMigration,
  deriveConversationIdFromMigration,
  inferSurfaceFromSessionKey,
} from "../conversations/ids.js";
import { ensureConversationForSession } from "../conversations/lazy-mapping.js";
import {
  computeLocalDataPlaneId,
  resolveConversationTenantContext,
} from "../conversations/tenant-context.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("memory/session-catalog-identity");

export type SessionCatalogIdentity = {
  dataPlaneId: string;
  conversationId: string;
  bindingId: string;
  sessionId: string;
  source: "catalog" | "lazy_backfill" | "synthetic";
};

export type ResolveSessionCatalogIdentityParams = {
  cfg?: OpenBotConfig | null;
  dataRoot: string | null;
  sessionId: string;
  sessionKey?: string | null;
  /** Absolute or relative session file (for synthetic fallback only). */
  sessionFile?: string;
  principalId?: string;
  /** Managed plane: prefer authenticated dataPlaneId over local hash of root. */
  dataPlaneId?: string | null;
  tenantId?: string | null;
};

/**
 * Map a runtime session to Catalog IDs for MemorySourceIdentity.
 * Never throws — falls back to deterministic synthetic IDs.
 */
export async function resolveSessionCatalogIdentity(
  params: ResolveSessionCatalogIdentityParams,
): Promise<SessionCatalogIdentity> {
  const sessionId = params.sessionId.trim() || "unknown";
  const dataRoot = params.dataRoot;
  // Prefer explicit dataPlaneId (managed tenant); else hash data root for local.
  const dataPlaneId =
    (params.dataPlaneId?.trim() || null) ??
    (dataRoot ? computeLocalDataPlaneId(dataRoot) : "dp_local");
  const flags = resolveConversationFlags(params.cfg ?? null, {
    tenantId: params.tenantId,
    principalId: params.principalId,
  });

  if (dataRoot && flags.catalogEnabled) {
    try {
      const catalogPath = resolveConversationCatalogPath({
        dataRoot,
        ctx: params.tenantId
          ? {
              dataPlaneId,
              mode: "managed" as const,
              tenantId: params.tenantId,
            }
          : undefined,
      });
      const catalog = new SqliteConversationCatalog({ path: catalogPath });
      try {
        const existing = await catalog.findBindingBySessionId(dataPlaneId, sessionId);
        if (existing) {
          return {
            dataPlaneId: existing.dataPlaneId || dataPlaneId,
            conversationId: existing.conversationId,
            bindingId: existing.bindingId,
            sessionId: existing.sessionId,
            source: "catalog",
          };
        }

        if (flags.lazyBackfill && params.sessionKey?.trim()) {
          const ctx = resolveConversationTenantContext({
            cfg: params.cfg ?? { data: { root: dataRoot, mode: "local", schemaVersion: 1 } },
            principalId: params.principalId ?? "system",
          });
          // Prefer dataPlane from ctx when local matches.
          const planeId = ctx.dataPlaneId || dataPlaneId;
          const mapped = await ensureConversationForSession({
            catalog,
            ctx: { ...ctx, dataPlaneId: planeId },
            sessionKey: params.sessionKey.trim(),
            sessionId,
          });
          return {
            dataPlaneId: planeId,
            conversationId: mapped.record.conversationId,
            bindingId: mapped.binding.bindingId,
            sessionId: mapped.binding.sessionId,
            source: "lazy_backfill",
          };
        }

        // Deterministic migration ids without creating catalog rows when lazy backfill off.
        const sessionKey = params.sessionKey?.trim() || `agent:main:main`;
        const surface = inferSurfaceFromSessionKey(sessionKey);
        const conversationId = deriveConversationIdFromMigration({
          dataPlaneId,
          sessionId,
          bindingRole: surface.bindingRole,
        });
        const bindingId = deriveBindingIdFromMigration({
          dataPlaneId,
          conversationId,
          sessionId,
          bindingRole: surface.bindingRole,
        });
        return {
          dataPlaneId,
          conversationId,
          bindingId,
          sessionId,
          source: "synthetic",
        };
      } finally {
        catalog.close();
      }
    } catch (err) {
      log.debug?.(`catalog identity resolve failed session=${sessionId}: ${String(err)}`);
    }
  }

  // Last resort: stable synthetic ids (not path-based).
  const digest = path
    .basename(sessionId)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 48);
  return {
    dataPlaneId,
    conversationId: `sessconv_${digest}`,
    bindingId: `sessbind_${digest}`,
    sessionId,
    source: "synthetic",
  };
}

import { loadConfig, type OpenBotConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { resolveStorePath } from "../config/sessions.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type { EnterpriseHandoverSessionDataTransfer } from "./enterprise-seat-assets-store.js";
import { archiveSessionTranscripts } from "./session-utils.fs.js";
import {
  listSessionsFromStore,
  loadCombinedSessionStoreForGateway,
  resolveGatewaySessionStoreTarget,
} from "./session-utils.js";

export const HANDOVER_RECENT_SESSION_WINDOW_DAYS = 30;

export type EnterpriseHandoverSessionTransferResult = {
  archivedSessionIds: string[];
  recentSessionIds: string[];
  archivedTranscriptPaths: string[];
};

export type EnterpriseHandoverSessionTransferDeps = {
  loadContext?: () => {
    cfg: ReturnType<typeof loadConfig>;
    storePath: string;
    store: Record<string, SessionEntry>;
    resolveAgentStorePath?: (agentId: string) => string;
  };
  archiveTranscripts?: typeof archiveSessionTranscripts;
  nowMs?: number;
};

/**
 * Session store path for managed handover.
 * Ownership (tenant/user) lives on the record; the store follows the conversation
 * under the default agents/<bot>/sessions path — do not move files on handoff.
 */
export function buildHandoverSessionStorePathResolver(params: {
  tenantId: string;
  outgoingEmployeeId: string;
  cfg?: OpenBotConfig;
}): ((agentId: string) => string) | undefined {
  const cfg = params.cfg ?? loadConfig();
  // Always the conversation-following store (same as buildSessionStorePathResolver).
  // tenantId / outgoingEmployeeId remain available to callers for ownership filters.
  void params.tenantId;
  void params.outgoingEmployeeId;
  const storeConfig = cfg.session?.store;
  return (agentId: string) => resolveStorePath(storeConfig, { agentId });
}

export function executeHandoverSessionDataTransfer(params: {
  transfer: EnterpriseHandoverSessionDataTransfer;
  tenantId?: string;
  outgoingEmployeeId?: string;
  deps?: EnterpriseHandoverSessionTransferDeps;
}): EnterpriseHandoverSessionTransferResult {
  const result: EnterpriseHandoverSessionTransferResult = {
    archivedSessionIds: [],
    recentSessionIds: [],
    archivedTranscriptPaths: [],
  };
  if (!params.transfer.recentSessions && !params.transfer.historyArchive) {
    return result;
  }
  if (params.transfer.coveredAgentIds.length === 0) {
    return result;
  }

  const loadContext =
    params.deps?.loadContext ??
    (() => {
      const cfg = loadConfig();
      const resolveAgentStorePath = buildHandoverSessionStorePathResolver({
        cfg,
        tenantId: params.tenantId ?? "",
        outgoingEmployeeId: params.outgoingEmployeeId ?? "",
      });
      const { storePath, store } = loadCombinedSessionStoreForGateway(
        cfg,
        resolveAgentStorePath ? { resolveAgentStorePath } : {},
      );
      return {
        cfg,
        storePath,
        store,
        ...(resolveAgentStorePath ? { resolveAgentStorePath } : {}),
      };
    });
  const archiveTranscripts = params.deps?.archiveTranscripts ?? archiveSessionTranscripts;
  const nowMs = params.deps?.nowMs ?? Date.now();
  const recentCutoffMs = nowMs - HANDOVER_RECENT_SESSION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const { cfg, storePath, store, resolveAgentStorePath } = loadContext();

  for (const rawAgentId of params.transfer.coveredAgentIds) {
    const agentId = normalizeAgentId(rawAgentId);
    const list = listSessionsFromStore({
      cfg,
      storePath,
      store,
      opts: {
        agentId,
        includeGlobal: false,
        includeUnknown: false,
        limit: 5000,
      },
    });

    for (const session of list.sessions) {
      const sessionId = session.sessionId?.trim();
      if (!sessionId) {
        continue;
      }
      const updatedAt = session.updatedAt ?? 0;
      const isRecent = updatedAt >= recentCutoffMs;

      if (params.transfer.recentSessions && isRecent) {
        result.recentSessionIds.push(sessionId);
      }

      if (!params.transfer.historyArchive || isRecent) {
        continue;
      }

      const entry = store[session.key];
      const target = resolveGatewaySessionStoreTarget({
        cfg,
        key: session.key,
        store,
        ...(resolveAgentStorePath ? { resolveAgentStorePath } : {}),
      });
      const archived = archiveTranscripts({
        sessionId,
        storePath: target.storePath,
        sessionFile: entry?.sessionFile,
        agentId: target.agentId ?? agentId,
        reason: "reset",
        restrictToStoreDir: true,
      });
      if (archived.length === 0) {
        continue;
      }
      result.archivedSessionIds.push(sessionId);
      result.archivedTranscriptPaths.push(...archived);
    }
  }

  result.archivedSessionIds = [...new Set(result.archivedSessionIds)].toSorted();
  result.recentSessionIds = [...new Set(result.recentSessionIds)].toSorted();
  result.archivedTranscriptPaths = [...new Set(result.archivedTranscriptPaths)].toSorted();
  return result;
}

export function mergeHandoverSessionTransferExecution(params: {
  plan: EnterpriseHandoverSessionDataTransfer;
  execution: EnterpriseHandoverSessionTransferResult;
  executedAt: string;
}): EnterpriseHandoverSessionDataTransfer {
  return {
    ...params.plan,
    executedAt: params.executedAt,
    archivedSessionIds: params.execution.archivedSessionIds,
    recentSessionIds: params.execution.recentSessionIds,
    archivedTranscriptCount: params.execution.archivedTranscriptPaths.length,
  };
}

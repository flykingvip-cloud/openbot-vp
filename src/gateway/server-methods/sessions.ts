import fs from "node:fs";
import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { cleanupSessionContinuityCheckpoints } from "../../auto-reply/reply/session-continuity.js";
import { loadConfig } from "../../config/config.js";
import {
  loadSessionStore,
  resolveMainSessionKey,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { maybeArchiveConversationToDataSpace } from "../../data/conversation-archive.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import { filterSessionKeysForEmployeeActor } from "../actor-scope.js";
import { listGatewayCollaborationSpaces } from "../collaboration-learning.js";
import {
  buildAuditableGroupBotSessionSet,
  filterAgentsForEmployeeActor,
  buildArchivedCollaborationGroupIdSet,
  filterSessionsForEmployeeActor,
  buildEmployeeSessionVisibilityContext,
  isArchivedCollaborationSpace,
  isPersonalWorkbenchClient,
  resolveEmployeeWorkbenchActor,
} from "../employee-workbench-scope.js";
import { requireResolvedEnterpriseTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import { isGatewayControlUiClientId } from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  validateSessionsCompactParams,
  validateSessionsDeleteParams,
  validateSessionsListParams,
  validateSessionsPatchParams,
  validateSessionsPreviewParams,
  validateSessionsResetParams,
  validateSessionsResolveParams,
} from "../protocol/index.js";
import {
  archiveSessionTranscriptsForSession,
  cleanupSessionBeforeMutation,
  emitSessionUnboundLifecycleEvent,
  performGatewaySessionReset,
} from "../session-reset-service.js";
import { deriveSessionTenant, buildAccountTenantIndex } from "../session-tenant-derivation.js";
import {
  archiveFileOnDisk,
  listAgentsForGateway,
  listSessionsFromStore,
  loadCombinedSessionStoreForGateway,
  loadSessionEntry,
  pruneLegacyStoreKeys,
  readSessionPreviewItemsFromTranscript,
  resolveGatewaySessionStoreTarget,
  resolveSessionModelRef,
  resolveSessionTranscriptCandidates,
  type SessionsPatchResult,
  type SessionsPreviewEntry,
  type SessionsPreviewResult,
  readSessionMessages,
} from "../session-utils.js";
import { applySessionsPatchToStore } from "../sessions-patch.js";
import { resolveSessionKeyFromResolveParams } from "../sessions-resolve.js";
import { loadTenantConfigStore } from "../tenant-config.js";
import { buildSessionStorePathResolver } from "../tenant-context.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

function requireSessionKey(key: unknown, respond: RespondFn): string | null {
  const raw =
    typeof key === "string"
      ? key
      : typeof key === "number"
        ? String(key)
        : typeof key === "bigint"
          ? String(key)
          : "";
  const normalized = raw.trim();
  if (!normalized) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
    return null;
  }
  return normalized;
}

function resolveGatewaySessionTargetFromKey(key: string) {
  const cfg = loadConfig();
  const target = resolveGatewaySessionStoreTarget({ cfg, key });
  return { cfg, target, storePath: target.storePath };
}

function rejectWebchatSessionMutation(params: {
  action: "patch" | "delete";
  client: GatewayClient | null;
  isWebchatConnect: (params: GatewayClient["connect"] | null | undefined) => boolean;
  respond: RespondFn;
}): boolean {
  if (!params.client?.connect || !params.isWebchatConnect(params.client.connect)) {
    return false;
  }
  if (isGatewayControlUiClientId(params.client.connect.client.id)) {
    return false;
  }
  params.respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `webchat clients cannot ${params.action} sessions; use chat.send for session-scoped updates`,
    ),
  );
  return true;
}

function migrateAndPruneSessionStoreKey(params: {
  cfg: ReturnType<typeof loadConfig>;
  key: string;
  store: Record<string, SessionEntry>;
}) {
  const target = resolveGatewaySessionStoreTarget({
    cfg: params.cfg,
    key: params.key,
    store: params.store,
  });
  const primaryKey = target.canonicalKey;
  if (!params.store[primaryKey]) {
    const existingKey = target.storeKeys.find((candidate) => Boolean(params.store[candidate]));
    if (existingKey) {
      params.store[primaryKey] = params.store[existingKey];
    }
  }
  pruneLegacyStoreKeys({
    store: params.store,
    canonicalKey: primaryKey,
    candidates: target.storeKeys,
  });
  return { target, primaryKey, entry: params.store[primaryKey] };
}

export const sessionsHandlers: GatewayRequestHandlers = {
  "sessions.list": async ({ params, respond, client, context }) => {
    if (!assertValidParams(params, validateSessionsListParams, "sessions.list", respond)) {
      return;
    }
    const p = params;
    const cfg = loadConfig();
    // Conversation-following session store (ownership on the record, not path).
    // Personal workbench visibility is enforced via actor filters below.
    let storePath: string;
    let store: ReturnType<typeof loadCombinedSessionStoreForGateway>["store"];
    try {
      const resolveAgentStorePath = await buildSessionStorePathResolver(client, cfg);
      ({ storePath, store } = loadCombinedSessionStoreForGateway(cfg, { resolveAgentStorePath }));
    } catch (err) {
      if (isPersonalWorkbenchClient(client)) {
        context.logGateway?.warn?.(
          `sessions.list denied: unresolved tenant session store (${String(err)})`,
        );
        respond(true, { path: "(denied)", count: 0, sessions: [] }, undefined);
        return;
      }
      ({ storePath, store } = loadCombinedSessionStoreForGateway(cfg));
    }
    const result = listSessionsFromStore({
      cfg,
      storePath,
      store,
      opts: p,
    });
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (actor) {
      const visibleAgents = filterAgentsForEmployeeActor(listAgentsForGateway(cfg).agents, actor);
      // Owner-audit: expose the actor's own bot transcripts inside groups the
      // actor is not a member of (read-only; gated by roster membership).
      let auditableGroupBotSessions = new Set<string>();
      let archivedGroupIds = new Set<string>();
      let collaborationSpaces: Awaited<
        ReturnType<typeof listGatewayCollaborationSpaces>
      >["spaces"] = [];
      try {
        const spaces = await listGatewayCollaborationSpaces();
        collaborationSpaces = spaces.spaces;
        archivedGroupIds = buildArchivedCollaborationGroupIdSet(spaces.spaces);
        auditableGroupBotSessions = buildAuditableGroupBotSessionSet(
          actor,
          spaces.spaces.filter((space) => !isArchivedCollaborationSpace(space)),
        );
      } catch (err) {
        context.logGateway?.warn?.(
          `failed to resolve auditable group bot sessions: ${String(err)}`,
        );
      }
      const scopedSessions = filterSessionsForEmployeeActor(
        result.sessions,
        actor,
        visibleAgents,
        auditableGroupBotSessions,
        archivedGroupIds,
        collaborationSpaces,
      );
      respond(
        true,
        { ...result, count: scopedSessions.length, sessions: scopedSessions },
        undefined,
      );
      return;
    }
    // A personal-workbench session (employee/enterprise) that fails to resolve an
    // actor must NOT fall through to the unscoped platform view below (which
    // returns every session on the install). Return empty instead of leaking.
    if (isPersonalWorkbenchClient(client)) {
      respond(true, { ...result, count: 0, sessions: [] }, undefined);
      return;
    }
    // Tenant scope (task 2.4): when a tenant is requested, resolve the trusted
    // tenant and filter sessions to those whose channel account belongs to it
    // (derived from the tenant-config store). Unattributed sessions are
    // platform-global and excluded. No tenantId = platform view (all sessions).
    const tenantScope = (p as { tenantId?: string }).tenantId;
    if (typeof tenantScope === "string" && tenantScope.trim()) {
      const tenantId = await requireResolvedEnterpriseTenantId({
        client,
        params: params as Record<string, unknown>,
        respond,
      });
      if (!tenantId) {
        return;
      }
      const index = buildAccountTenantIndex(await loadTenantConfigStore());
      const scoped = result.sessions.filter((row) => deriveSessionTenant(row, index) === tenantId);
      respond(true, { ...result, count: scoped.length, sessions: scoped }, undefined);
      return;
    }
    respond(true, result, undefined);
  },
  "sessions.preview": async ({ params, respond, client, context }) => {
    if (!assertValidParams(params, validateSessionsPreviewParams, "sessions.preview", respond)) {
      return;
    }
    const p = params;
    const keysRaw = Array.isArray(p.keys) ? p.keys : [];
    let keys = keysRaw
      .map((key) => String(key ?? "").trim())
      .filter(Boolean)
      .slice(0, 64);
    const visibility = await buildEmployeeSessionVisibilityContext({
      client,
      logGateway: context.logGateway,
    });
    if (visibility) {
      keys = filterSessionKeysForEmployeeActor(keys, visibility);
    } else if (isPersonalWorkbenchClient(client)) {
      keys = [];
    }
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit) ? Math.max(1, p.limit) : 12;
    const maxChars =
      typeof p.maxChars === "number" && Number.isFinite(p.maxChars)
        ? Math.max(20, p.maxChars)
        : 240;

    if (keys.length === 0) {
      respond(true, { ts: Date.now(), previews: [] } satisfies SessionsPreviewResult, undefined);
      return;
    }

    const cfg = loadConfig();
    // Resolve the conversation-following store; personal workbench visibility
    // is enforced by key filtering above (ownership metadata, not path segments).
    let resolveAgentStorePath: ((agentId: string) => string) | undefined;
    try {
      resolveAgentStorePath = await buildSessionStorePathResolver(client, cfg);
    } catch (err) {
      if (isPersonalWorkbenchClient(client)) {
        context.logGateway?.warn?.(
          `sessions.preview denied: unresolved tenant session store (${String(err)})`,
        );
        respond(true, { ts: Date.now(), previews: [] } satisfies SessionsPreviewResult, undefined);
        return;
      }
    }
    const storeCache = new Map<string, Record<string, SessionEntry>>();
    const previews: SessionsPreviewEntry[] = [];

    for (const key of keys) {
      try {
        const storeTarget = resolveGatewaySessionStoreTarget({
          cfg,
          key,
          scanLegacyKeys: false,
          resolveAgentStorePath,
        });
        const store =
          storeCache.get(storeTarget.storePath) ?? loadSessionStore(storeTarget.storePath);
        storeCache.set(storeTarget.storePath, store);
        const target = resolveGatewaySessionStoreTarget({
          cfg,
          key,
          store,
          resolveAgentStorePath,
        });
        const entry = target.storeKeys.map((candidate) => store[candidate]).find(Boolean);
        if (!entry?.sessionId) {
          previews.push({ key, status: "missing", items: [] });
          continue;
        }
        const items = readSessionPreviewItemsFromTranscript(
          entry.sessionId,
          target.storePath,
          entry.sessionFile,
          target.agentId,
          limit,
          maxChars,
        );
        previews.push({
          key,
          status: items.length > 0 ? "ok" : "empty",
          items,
        });
      } catch {
        previews.push({ key, status: "error", items: [] });
      }
    }

    respond(true, { ts: Date.now(), previews } satisfies SessionsPreviewResult, undefined);
  },
  "sessions.resolve": async ({ params, respond }) => {
    if (!assertValidParams(params, validateSessionsResolveParams, "sessions.resolve", respond)) {
      return;
    }
    const p = params;
    const cfg = loadConfig();

    const resolved = await resolveSessionKeyFromResolveParams({ cfg, p });
    if (!resolved.ok) {
      respond(false, undefined, resolved.error);
      return;
    }
    respond(true, { ok: true, key: resolved.key }, undefined);
  },
  "sessions.patch": async ({ params, respond, context, client, isWebchatConnect }) => {
    if (!assertValidParams(params, validateSessionsPatchParams, "sessions.patch", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    if (rejectWebchatSessionMutation({ action: "patch", client, isWebchatConnect, respond })) {
      return;
    }

    const { cfg, target, storePath } = resolveGatewaySessionTargetFromKey(key);
    const applied = await updateSessionStore(storePath, async (store) => {
      const { primaryKey } = migrateAndPruneSessionStoreKey({ cfg, key, store });
      return await applySessionsPatchToStore({
        cfg,
        store,
        storeKey: primaryKey,
        patch: p,
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
      });
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    const parsed = parseAgentSessionKey(target.canonicalKey ?? key);
    const agentId = normalizeAgentId(parsed?.agentId ?? resolveDefaultAgentId(cfg));
    const resolved = resolveSessionModelRef(cfg, applied.entry, agentId);
    const result: SessionsPatchResult = {
      ok: true,
      path: storePath,
      key: target.canonicalKey,
      entry: applied.entry,
      resolved: {
        modelProvider: resolved.provider,
        model: resolved.model,
      },
    };
    respond(true, result, undefined);
  },
  "sessions.reset": async ({ params, respond }) => {
    if (!assertValidParams(params, validateSessionsResetParams, "sessions.reset", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }

    const reason = p.reason === "new" ? "new" : "reset";
    const result = await performGatewaySessionReset({
      key,
      reason,
      commandSource: "gateway:sessions.reset",
    });
    if (!result.ok) {
      respond(false, undefined, result.error);
      return;
    }
    respond(true, { ok: true, key: result.key, entry: result.entry }, undefined);
  },
  "sessions.delete": async ({ params, respond, client, isWebchatConnect }) => {
    if (!assertValidParams(params, validateSessionsDeleteParams, "sessions.delete", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    if (rejectWebchatSessionMutation({ action: "delete", client, isWebchatConnect, respond })) {
      return;
    }

    const { cfg, target, storePath } = resolveGatewaySessionTargetFromKey(key);
    const mainKey = resolveMainSessionKey(cfg);
    if (target.canonicalKey === mainKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Cannot delete the main session (${mainKey}).`),
      );
      return;
    }

    const deleteTranscript = typeof p.deleteTranscript === "boolean" ? p.deleteTranscript : true;

    const { entry, legacyKey, canonicalKey } = loadSessionEntry(key);
    const mutationCleanupError = await cleanupSessionBeforeMutation({
      cfg,
      key,
      target,
      entry,
      legacyKey,
      canonicalKey,
      reason: "session-delete",
    });
    if (mutationCleanupError) {
      respond(false, undefined, mutationCleanupError);
      return;
    }
    const sessionId = entry?.sessionId;
    const deleted = await updateSessionStore(storePath, (store) => {
      const { primaryKey } = migrateAndPruneSessionStoreKey({ cfg, key, store });
      const hadEntry = Boolean(store[primaryKey]);
      if (hadEntry) {
        delete store[primaryKey];
      }
      return hadEntry;
    });

    const archived =
      deleted && deleteTranscript
        ? archiveSessionTranscriptsForSession({
            sessionId,
            storePath,
            sessionFile: entry?.sessionFile,
            agentId: target.agentId,
            reason: "deleted",
          })
        : [];
    if (deleted && deleteTranscript && sessionId && target.agentId) {
      await maybeArchiveConversationToDataSpace({
        cfg,
        agentId: target.agentId,
        sessionId,
        runtimePath: entry?.sessionFile ? path.resolve(entry.sessionFile) : undefined,
      });
    }
    if (deleted) {
      // Remove this session's rollback checkpoints + snapshot data (R9.2),
      // preserving other sessions' data in the shared scope store.
      await cleanupSessionContinuityCheckpoints({
        cfg,
        workspaceDir: resolveAgentWorkspaceDir(cfg, target.agentId) ?? process.cwd(),
        agentId: target.agentId,
        sessionKey: key,
        sessionEntry: entry,
      });
      const emitLifecycleHooks = p.emitLifecycleHooks !== false;
      await emitSessionUnboundLifecycleEvent({
        targetSessionKey: target.canonicalKey ?? key,
        reason: "session-delete",
        emitHooks: emitLifecycleHooks,
      });
    }

    respond(true, { ok: true, key: target.canonicalKey, deleted, archived }, undefined);
  },
  "sessions.get": ({ params, respond }) => {
    const p = params;
    const key = requireSessionKey(p.key ?? p.sessionKey, respond);
    if (!key) {
      return;
    }
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit)
        ? Math.max(1, Math.floor(p.limit))
        : 200;

    const { target, storePath } = resolveGatewaySessionTargetFromKey(key);
    const store = loadSessionStore(storePath);
    const entry = target.storeKeys.map((k) => store[k]).find(Boolean);
    if (!entry?.sessionId) {
      respond(true, { messages: [] }, undefined);
      return;
    }
    const allMessages = readSessionMessages(entry.sessionId, storePath, entry.sessionFile);
    const messages = limit < allMessages.length ? allMessages.slice(-limit) : allMessages;
    respond(true, { messages }, undefined);
  },
  "sessions.compact": async ({ params, respond }) => {
    if (!assertValidParams(params, validateSessionsCompactParams, "sessions.compact", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }

    const maxLines =
      typeof p.maxLines === "number" && Number.isFinite(p.maxLines)
        ? Math.max(1, Math.floor(p.maxLines))
        : 400;

    const { cfg, target, storePath } = resolveGatewaySessionTargetFromKey(key);
    // Lock + read in a short critical section; transcript work happens outside.
    const compactTarget = await updateSessionStore(storePath, (store) => {
      const { entry, primaryKey } = migrateAndPruneSessionStoreKey({ cfg, key, store });
      return { entry, primaryKey };
    });
    const entry = compactTarget.entry;
    const sessionId = entry?.sessionId;
    if (!sessionId) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no sessionId",
        },
        undefined,
      );
      return;
    }

    const filePath = resolveSessionTranscriptCandidates(
      sessionId,
      storePath,
      entry?.sessionFile,
      target.agentId,
    ).find((candidate) => fs.existsSync(candidate));
    if (!filePath) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no transcript",
        },
        undefined,
      );
      return;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= maxLines) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          kept: lines.length,
        },
        undefined,
      );
      return;
    }

    const archived = archiveFileOnDisk(filePath, "bak");
    const keptLines = lines.slice(-maxLines);
    fs.writeFileSync(filePath, `${keptLines.join("\n")}\n`, "utf-8");

    await updateSessionStore(storePath, (store) => {
      const entryKey = compactTarget.primaryKey;
      const entryToUpdate = store[entryKey];
      if (!entryToUpdate) {
        return;
      }
      delete entryToUpdate.inputTokens;
      delete entryToUpdate.outputTokens;
      delete entryToUpdate.totalTokens;
      delete entryToUpdate.totalTokensFresh;
      entryToUpdate.updatedAt = Date.now();
    });

    respond(
      true,
      {
        ok: true,
        key: target.canonicalKey,
        compacted: true,
        archived,
        kept: keptLines.length,
      },
      undefined,
    );
  },
};

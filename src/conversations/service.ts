import { createHash } from "node:crypto";
/**
 * Conversation service — create/list/get/rename/close/archive/restore (CL-P1-01).
 */
import type { OpenBotConfig } from "../config/config.js";
import { resolveSessionFilePath, resolveSessionFilePathOptions } from "../config/sessions/paths.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { authorizeConversationAction } from "./acl.js";
import {
  archiveConversationTranscript,
  resolveConversationArchivePath,
  restoreConversationTranscript,
} from "./archive-ops.js";
import { resolveConversationCatalogPath, resolveConversationArchiveRoot } from "./catalog/paths.js";
import type { ConversationCatalogRepository } from "./catalog/repository.js";
import { CatalogConcurrencyError, CatalogNotFoundError } from "./catalog/repository.js";
import { SqliteConversationCatalog } from "./catalog/sqlite-catalog.js";
import { notifyCogniWeaveConversationLifecycle } from "./cogniweave-bridge.js";
import { createBindingId, createConversationId, createEtag } from "./ids.js";
import { ensureConversationForSession } from "./lazy-mapping.js";
import { resolveConversationDataRoot } from "./managed-planes.js";
import {
  buildConversationSessionKey,
  createRuntimeSessionForConversation,
} from "./session-runtime.js";
import type {
  ConversationLifecycleStatus,
  ConversationRecord,
  ConversationSessionBinding,
  ConversationSurfaceType,
  ConversationTenantContext,
} from "./types.js";
import { validateConversationRecord } from "./validation.js";

export type ConversationServiceDeps = {
  cfg: OpenBotConfig;
  ctx: ConversationTenantContext;
  catalog?: ConversationCatalogRepository;
  /** Explicit plane data root (managed tenant live root). */
  dataRoot?: string;
};

const catalogCache = new Map<string, SqliteConversationCatalog>();

export function getOrOpenCatalog(
  cfg: OpenBotConfig,
  ctx: ConversationTenantContext,
  options?: { dataRoot?: string },
): ConversationCatalogRepository {
  const path = resolveConversationCatalogPath({
    cfg,
    ctx,
    dataRoot: options?.dataRoot,
  });
  const existing = catalogCache.get(path);
  if (existing) {
    return existing;
  }
  const catalog = new SqliteConversationCatalog({ path });
  catalogCache.set(path, catalog);
  return catalog;
}

/** Test helper: drop cached catalog handles. */
export function resetConversationCatalogCache(): void {
  for (const c of catalogCache.values()) {
    c.close?.();
  }
  catalogCache.clear();
}

function requireCatalog(deps: ConversationServiceDeps): ConversationCatalogRepository {
  return deps.catalog ?? getOrOpenCatalog(deps.cfg, deps.ctx, { dataRoot: deps.dataRoot });
}

function autoTitleFromHint(hint?: string | null): string {
  const t = hint?.trim();
  if (!t) {
    return "New conversation";
  }
  const oneLine = t.split(/\r?\n/)[0]?.trim() ?? t;
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}

export async function createConversation(params: {
  deps: ConversationServiceDeps;
  surfaceType: ConversationSurfaceType;
  agentId?: string | null;
  groupId?: string | null;
  title?: string | null;
  requestId?: string | null;
}): Promise<{
  record: ConversationRecord;
  binding: ConversationSessionBinding;
  sessionKey: string;
}> {
  const catalog = requireCatalog(params.deps);
  const { ctx, cfg } = params.deps;
  const surfaceType = params.surfaceType;
  const agentId =
    surfaceType === "AGENT"
      ? normalizeAgentId(params.agentId ?? "main")
      : params.agentId
        ? normalizeAgentId(params.agentId)
        : "main";
  const groupId = surfaceType === "COLLABORATION_GROUP" ? params.groupId?.trim() || null : null;
  if (surfaceType === "COLLABORATION_GROUP" && !groupId) {
    throw new Error("groupId required for collaboration conversation");
  }

  const now = new Date().toISOString();
  const conversationId = createConversationId();
  const bindingId = createBindingId();
  const sessionKey = buildConversationSessionKey({
    surfaceType,
    agentId,
    groupId,
    conversationId,
  });

  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  const runtime = await createRuntimeSessionForConversation({
    cfg,
    agentId,
    sessionKey,
    label: autoTitleFromHint(params.title),
    storePath,
  });

  const ownershipScopeType =
    surfaceType === "COLLABORATION_GROUP"
      ? ("GROUP" as const)
      : ctx.mode === "managed" && ctx.seatId
        ? ("SEAT" as const)
        : ("USER" as const);
  const ownershipScopeId =
    ownershipScopeType === "GROUP"
      ? groupId!
      : ownershipScopeType === "SEAT"
        ? ctx.seatId!
        : ctx.principalId;

  const record: ConversationRecord = {
    schemaVersion: 1,
    conversationId,
    dataPlaneId: ctx.dataPlaneId,
    tenantId: ctx.tenantId,
    ownershipScopeType,
    ownershipScopeId,
    createdByUserId: ctx.principalId,
    surfaceType,
    agentId,
    groupId,
    title: autoTitleFromHint(params.title),
    titleSource: params.title?.trim() ? "USER" : "AUTO",
    lifecycleStatus: "ACTIVE",
    lifecycleStatusBeforeArchive: null,
    storageTier: "HOT",
    retentionState: "RETAIN",
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    archivedAt: null,
    deletedAt: null,
    lastMessageAt: null,
    messageCount: 0,
    participantIds: [ctx.principalId],
    primaryBindingId: bindingId,
    etag: createEtag(),
  };
  const validation = validateConversationRecord(record);
  if (!validation.ok) {
    throw new Error(`invalid conversation: ${validation.reasonCode}`);
  }

  const binding: ConversationSessionBinding = {
    schemaVersion: 1,
    bindingId,
    dataPlaneId: ctx.dataPlaneId,
    conversationId,
    sessionKey,
    sessionId: runtime.sessionId,
    agentId,
    role: surfaceType === "COLLABORATION_GROUP" ? "GROUP_PUBLIC" : "PRIMARY",
    aliasTargetBindingId: null,
    transcriptState: "LIVE",
    createdAt: now,
    endedAt: null,
  };

  await catalog.createConversation(record, binding);
  return { record, binding, sessionKey };
}

export async function listConversations(params: {
  deps: ConversationServiceDeps;
  agentId?: string;
  groupId?: string;
  lifecycleStatus?: ConversationLifecycleStatus | ConversationLifecycleStatus[];
  limit?: number;
  cursor?: string | null;
}): Promise<{ rows: ConversationRecord[]; nextCursor: string | null }> {
  const catalog = requireCatalog(params.deps);
  // List by data plane + optional agent/group; ACL filters membership (USER/SEAT/GROUP).
  const page = await catalog.listConversations({
    dataPlaneId: params.deps.ctx.dataPlaneId,
    tenantId: params.deps.ctx.tenantId,
    agentId: params.agentId,
    groupId: params.groupId,
    lifecycleStatus: params.lifecycleStatus ?? ["ACTIVE", "CLOSED"],
    // Fetch a bit more so ACL filtering still yields a full page when possible.
    limit: Math.min((params.limit ?? 50) + 20, 200),
    cursor: params.cursor,
  });
  const allowed = page.rows.filter((record) => {
    const decision = authorizeConversationAction({
      ctx: params.deps.ctx,
      record,
      action: "read",
    });
    return decision.allowed;
  });
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const rows = allowed.slice(0, limit);
  // Preserve catalog cursor only when we did not over-trim; otherwise clients re-list with last etag/time later.
  const nextCursor = rows.length < allowed.length || page.nextCursor ? page.nextCursor : null;
  return { rows, nextCursor };
}

export async function getConversation(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
}): Promise<{ record: ConversationRecord; bindings: ConversationSessionBinding[] }> {
  const catalog = requireCatalog(params.deps);
  const record = await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId);
  if (!record) {
    throw new CatalogNotFoundError();
  }
  const auth = authorizeConversationAction({
    ctx: params.deps.ctx,
    record,
    action: "read",
  });
  if (!auth.allowed) {
    throw new Error(auth.reasonCode);
  }
  const bindings = await catalog.listBindings(params.deps.ctx.dataPlaneId, params.conversationId);
  return { record, bindings };
}

export async function renameConversation(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
  title: string;
  etag: string;
}): Promise<ConversationRecord> {
  const catalog = requireCatalog(params.deps);
  const record = await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId);
  if (!record) {
    throw new CatalogNotFoundError();
  }
  const auth = authorizeConversationAction({
    ctx: params.deps.ctx,
    record,
    action: "rename",
  });
  if (!auth.allowed) {
    throw new Error(auth.reasonCode);
  }
  const title = params.title.trim();
  if (!title) {
    throw new Error("title required");
  }
  const next: ConversationRecord = {
    ...record,
    title: title.slice(0, 200),
    titleSource: "USER",
    updatedAt: new Date().toISOString(),
    etag: createEtag(),
  };
  return catalog.updateConversation(next, params.etag);
}

export async function closeConversation(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
  etag: string;
}): Promise<ConversationRecord> {
  const catalog = requireCatalog(params.deps);
  const record = await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId);
  if (!record) {
    throw new CatalogNotFoundError();
  }
  const auth = authorizeConversationAction({
    ctx: params.deps.ctx,
    record,
    action: "close",
  });
  if (!auth.allowed) {
    throw new Error(auth.reasonCode);
  }
  if (record.lifecycleStatus === "ARCHIVED" || record.lifecycleStatus === "DELETED") {
    throw new Error("cannot close archived or deleted conversation");
  }
  const now = new Date().toISOString();
  const next: ConversationRecord = {
    ...record,
    lifecycleStatus: "CLOSED",
    closedAt: now,
    updatedAt: now,
    etag: createEtag(),
  };
  return catalog.updateConversation(next, params.etag);
}

async function resolveLiveTranscriptPath(params: {
  cfg: OpenBotConfig;
  binding: ConversationSessionBinding;
}): Promise<string> {
  const agentId = params.binding.agentId ?? "main";
  const storePath = resolveStorePath(params.cfg.session?.store, { agentId });
  const pathOpts = resolveSessionFilePathOptions({ agentId, storePath });
  return resolveSessionFilePath(params.binding.sessionId, undefined, pathOpts);
}

function activeLifecycleBindings(
  bindings: ConversationSessionBinding[],
): ConversationSessionBinding[] {
  return bindings.filter((b) => b.role !== "LEGACY_ALIAS" && !b.endedAt);
}

/**
 * Plane data root: explicit deps.dataRoot wins; else tenant-aware resolution
 * (managed → tenant live root, local → Data Space). Never silently mix planes.
 */
export function planeRoot(deps: ConversationServiceDeps): string {
  if (deps.dataRoot?.trim()) {
    return deps.dataRoot.trim();
  }
  return resolveConversationDataRoot({
    cfg: deps.cfg,
    tenantId: deps.ctx.tenantId,
    mode: deps.ctx.mode,
  });
}

/** Per-binding archive/restore receipt (independent checksums). */
export type BindingLifecycleReceipt = {
  bindingId: string;
  sessionId: string;
  checksum: string;
  bytes: number;
  /** Server-local path for internal use only — never return to clients. */
  path: string;
};

export type MultiBindingArchiveResult = {
  record: ConversationRecord;
  binding: ConversationSessionBinding;
  archivePath: string;
  checksum: string;
  bytes: number;
  archivedBindings: ConversationSessionBinding[];
  /** Independent checksum/bytes per binding (audit receipt). */
  bindingReceipts: BindingLifecycleReceipt[];
};

export type MultiBindingRestoreResult = {
  record: ConversationRecord;
  binding: ConversationSessionBinding;
  livePath: string;
  checksum: string;
  restoredBindings: ConversationSessionBinding[];
  bindingReceipts: BindingLifecycleReceipt[];
};

export async function archiveConversation(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
  /**
   * Optimistic concurrency for first attempt only.
   * Job resume / FAILED_RETRYABLE must pass undefined so a prior partial
   * Catalog etag bump does not block recovery.
   */
  etag?: string;
}): Promise<MultiBindingArchiveResult> {
  const catalog = requireCatalog(params.deps);
  let record = await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId);
  if (!record) {
    throw new CatalogNotFoundError();
  }
  if (params.etag && params.etag !== record.etag) {
    throw new CatalogConcurrencyError();
  }
  const auth = authorizeConversationAction({
    ctx: params.deps.ctx,
    record,
    action: "archive",
  });
  if (!auth.allowed) {
    throw new Error(auth.reasonCode);
  }
  const bindings = activeLifecycleBindings(
    await catalog.listBindings(params.deps.ctx.dataPlaneId, params.conversationId),
  );
  if (bindings.length === 0) {
    throw new Error("no binding for conversation");
  }
  const dataRoot = planeRoot(params.deps);
  const archiveRoot = resolveConversationArchiveRoot({ dataRoot });

  // Archive every active binding's transcript; Catalog lifecycle flips once (first binding).
  // Fail closed on partial binding failures — no silent ARCHIVED without archive bytes.
  // Box so nested/loop assignments are visible to control-flow (closures don't narrow).
  const archiveState: {
    primary: {
      record: ConversationRecord;
      binding: ConversationSessionBinding;
      archivePath: string;
      checksum: string;
      bytes: number;
    } | null;
  } = { primary: null };
  const archivedBindings: ConversationSessionBinding[] = [];
  const bindingReceipts: BindingLifecycleReceipt[] = [];
  let catalogArchived = record.lifecycleStatus === "ARCHIVED";
  const bindingErrors: string[] = [];
  const primaryBindingId = record.primaryBindingId;

  const pushReceipt = (
    binding: ConversationSessionBinding,
    archivePath: string,
    checksum: string,
    bytes: number,
    current: ConversationRecord,
  ) => {
    bindingReceipts.push({
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      checksum,
      bytes,
      path: archivePath,
    });
    archivedBindings.push(binding);
    if (
      !archiveState.primary ||
      binding.bindingId === primaryBindingId ||
      binding.role === "PRIMARY" ||
      binding.role === "GROUP_PUBLIC"
    ) {
      archiveState.primary = {
        record: current,
        binding,
        archivePath,
        checksum,
        bytes,
      };
    }
  };

  for (const binding of bindings) {
    const livePath = await resolveLiveTranscriptPath({ cfg: params.deps.cfg, binding });
    const archivePath = resolveConversationArchivePath({
      archiveRoot,
      conversationId: record.conversationId,
      sessionId: binding.sessionId,
    });
    const current =
      (await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId)) ?? record;
    try {
      await fsAccess(livePath);
    } catch {
      // Idempotent re-entry: ARCHIVED without live is OK only when archive copy
      // exists and has a verifiable checksum (never treat missing archive as success).
      if (binding.transcriptState === "ARCHIVED") {
        try {
          const verified = await verifyTranscriptFile(archivePath);
          pushReceipt(binding, archivePath, verified.checksum, verified.bytes, current);
          // §2.5: still compensate CogniWeave even when Catalog/transcript already archived.
          const cwErr = await compensateCogniWeaveBindingLifecycle({
            deps: params.deps,
            mode: "archive",
            binding,
            conversationId: record.conversationId,
            transcriptPath: archivePath,
            dataRoot,
          });
          if (cwErr) {
            bindingErrors.push(cwErr);
          }
          continue;
        } catch {
          bindingErrors.push(`archive_missing_or_invalid:${binding.bindingId}`);
          continue;
        }
      }
      bindingErrors.push(`live_missing:${binding.bindingId}`);
      continue;
    }
    // Live exists and already ARCHIVED: re-verify archive copy checksum matches live.
    if (binding.transcriptState === "ARCHIVED") {
      try {
        const liveHash = await verifyTranscriptFile(livePath);
        const archHash = await verifyTranscriptFile(archivePath);
        if (liveHash.checksum !== archHash.checksum) {
          bindingErrors.push(`archive_checksum_mismatch:${binding.bindingId}`);
          continue;
        }
        pushReceipt(binding, archivePath, archHash.checksum, archHash.bytes, current);
        const cwErr = await compensateCogniWeaveBindingLifecycle({
          deps: params.deps,
          mode: "archive",
          binding,
          conversationId: record.conversationId,
          transcriptPath: livePath,
          dataRoot,
        });
        if (cwErr) {
          bindingErrors.push(cwErr);
        }
        continue;
      } catch {
        bindingErrors.push(`archive_verify_failed:${binding.bindingId}`);
        continue;
      }
    }
    const result = await archiveConversationTranscript({
      catalog,
      record: current,
      binding,
      liveTranscriptPath: livePath,
      archiveDir: archiveRoot,
      bindingOnly: catalogArchived,
    });
    record = result.record;
    catalogArchived = true;
    pushReceipt(result.binding, result.archivePath, result.checksum, result.bytes, result.record);
    const cwErr = await compensateCogniWeaveBindingLifecycle({
      deps: params.deps,
      mode: "archive",
      binding: result.binding,
      conversationId: record.conversationId,
      transcriptPath: livePath,
      dataRoot,
    });
    if (cwErr) {
      bindingErrors.push(cwErr);
    }
  }
  if (bindingErrors.length > 0) {
    throw new Error(`ARCHIVE_PARTIAL_FAILURE:${bindingErrors.join(";")}`);
  }
  if (!archiveState.primary) {
    throw new Error("no live transcript to archive");
  }
  return {
    record: archiveState.primary.record,
    binding: archiveState.primary.binding,
    archivePath: archiveState.primary.archivePath,
    checksum: archiveState.primary.checksum,
    bytes: archiveState.primary.bytes,
    archivedBindings,
    bindingReceipts,
  };
}

async function fsAccess(p: string): Promise<void> {
  const { access } = await import("node:fs/promises");
  await access(p);
}

/**
 * Always run CogniWeave source lifecycle for a binding — including idempotent
 * archive/restore re-entry (remediation §2.5). Catalog/transcript success alone
 * must not skip CW compensation on retry.
 *
 * @returns error token for bindingErrors, or null when ok / soft-skipped.
 */
async function compensateCogniWeaveBindingLifecycle(params: {
  deps: ConversationServiceDeps;
  mode: "archive" | "restore";
  binding: ConversationSessionBinding;
  conversationId: string;
  /** Path used for sealed-id lookup + locator (prefer live; archive when live gone). */
  transcriptPath: string;
  dataRoot: string;
}): Promise<string | null> {
  const { loadSealedSourceIdentityIds } = await import("../memory/session-source-index.js");
  const sourceIdentityIds = await loadSealedSourceIdentityIds({
    dataRoot: params.dataRoot,
    sessionFile: params.transcriptPath,
  });
  let cogniweaveBackend = false;
  try {
    const { resolveMemoryBackendConfig } = await import("../memory/backend-config.js");
    cogniweaveBackend =
      resolveMemoryBackendConfig({
        cfg: params.deps.cfg,
        agentId: params.binding.agentId ?? "main",
      }).backend === "cogniweave";
  } catch {
    cogniweaveBackend = false;
  }
  const cwFailClosed = sourceIdentityIds.length > 0 || cogniweaveBackend;
  // Stable operationId so retries replay the same receipt (CW2 idempotency).
  const operationId = `conv-${params.mode}-${params.conversationId}-${params.binding.bindingId}`;
  const cw = await notifyCogniWeaveConversationLifecycle({
    cfg: params.deps.cfg,
    agentId: params.binding.agentId ?? "main",
    mode: params.mode,
    liveTranscriptPath: params.transcriptPath,
    conversationId: params.conversationId,
    operationId,
    sourceIdentityIds,
    tenantId: params.deps.ctx.tenantId,
    dataPlaneId: params.deps.ctx.dataPlaneId,
    dataRoot: params.dataRoot,
    failClosed: cwFailClosed,
  });
  if (cwFailClosed && !cw.ok) {
    return `cogniweave_${params.mode}:${params.binding.bindingId}:${cw.errors.join(",")}`;
  }
  return null;
}

/** Fail-closed: file must exist, be non-empty, and yield a stable checksum. */
async function verifyTranscriptFile(
  filePath: string,
): Promise<{ checksum: string; bytes: number }> {
  const { access, readFile, stat } = await import("node:fs/promises");
  await access(filePath);
  const st = await stat(filePath);
  if (!st.isFile() || st.size <= 0) {
    throw new Error("transcript empty or not a file");
  }
  const buf = await readFile(filePath);
  return {
    checksum: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
  };
}

export async function restoreConversation(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
  /** First-attempt optimistic concurrency only; omit on job resume. */
  etag?: string;
  targetLifecycle?: "ACTIVE" | "CLOSED";
}): Promise<MultiBindingRestoreResult> {
  const catalog = requireCatalog(params.deps);
  let record = await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId);
  if (!record) {
    throw new CatalogNotFoundError();
  }
  if (params.etag && params.etag !== record.etag) {
    throw new CatalogConcurrencyError();
  }
  const auth = authorizeConversationAction({
    ctx: params.deps.ctx,
    record,
    action: "restore",
  });
  if (!auth.allowed) {
    throw new Error(auth.reasonCode);
  }
  const bindings = (
    await catalog.listBindings(params.deps.ctx.dataPlaneId, params.conversationId)
  ).filter((b) => b.role !== "LEGACY_ALIAS");
  if (bindings.length === 0) {
    throw new Error("no binding for conversation");
  }
  const dataRoot = planeRoot(params.deps);
  const archiveRoot = resolveConversationArchiveRoot({ dataRoot });
  const restoreTarget =
    record.lifecycleStatusBeforeArchive === "ACTIVE" ||
    record.lifecycleStatusBeforeArchive === "CLOSED"
      ? record.lifecycleStatusBeforeArchive
      : (params.targetLifecycle ?? "CLOSED");

  const restoreState: {
    primary: {
      record: ConversationRecord;
      binding: ConversationSessionBinding;
      livePath: string;
      checksum: string;
    } | null;
  } = { primary: null };
  const restoredBindings: ConversationSessionBinding[] = [];
  const bindingReceipts: BindingLifecycleReceipt[] = [];
  let catalogRestored = record.lifecycleStatus !== "ARCHIVED";
  const bindingErrors: string[] = [];
  const restorePrimaryBindingId = record.primaryBindingId;

  const pushRestoreReceipt = (
    binding: ConversationSessionBinding,
    livePath: string,
    checksum: string,
    bytes: number,
    currentRecord: ConversationRecord,
  ) => {
    bindingReceipts.push({
      bindingId: binding.bindingId,
      sessionId: binding.sessionId,
      checksum,
      bytes,
      path: livePath,
    });
    restoredBindings.push(binding);
    if (
      !restoreState.primary ||
      binding.bindingId === restorePrimaryBindingId ||
      binding.role === "PRIMARY" ||
      binding.role === "GROUP_PUBLIC"
    ) {
      restoreState.primary = {
        record: currentRecord,
        binding,
        livePath,
        checksum,
      };
    }
  };

  for (const binding of bindings) {
    const livePath = await resolveLiveTranscriptPath({ cfg: params.deps.cfg, binding });
    const archivePath = resolveConversationArchivePath({
      archiveRoot,
      conversationId: record.conversationId,
      sessionId: binding.sessionId,
    });
    try {
      await fsAccess(archivePath);
    } catch {
      // Idempotent re-entry: LIVE/READ_ONLY without archive is OK only when live
      // file exists and is non-empty with a verifiable checksum.
      if (binding.transcriptState === "LIVE" || binding.transcriptState === "READ_ONLY") {
        try {
          const liveHash = await verifyTranscriptFile(livePath);
          pushRestoreReceipt(binding, livePath, liveHash.checksum, liveHash.bytes, record);
          // §2.5: Catalog already restored — still compensate CogniWeave on retry.
          const cwErr = await compensateCogniWeaveBindingLifecycle({
            deps: params.deps,
            mode: "restore",
            binding,
            conversationId: record.conversationId,
            transcriptPath: livePath,
            dataRoot,
          });
          if (cwErr) {
            bindingErrors.push(cwErr);
          }
          continue;
        } catch {
          bindingErrors.push(`live_missing_or_invalid:${binding.bindingId}`);
          continue;
        }
      }
      if (binding.transcriptState === "ARCHIVED") {
        bindingErrors.push(`archive_missing:${binding.bindingId}`);
      }
      continue;
    }
    const current =
      (await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId)) ?? record;
    const result = await restoreConversationTranscript({
      catalog,
      record: current,
      binding,
      liveTranscriptPath: livePath,
      archivePath,
      targetLifecycle: restoreTarget,
      bindingOnly: catalogRestored,
    });
    record = result.record;
    catalogRestored = true;
    // Fail closed: post-restore live must verify; never emit success with bytes:0.
    let liveStat: { checksum: string; bytes: number };
    try {
      liveStat = await verifyTranscriptFile(result.livePath);
    } catch {
      bindingErrors.push(`live_verify_failed:${binding.bindingId}`);
      continue;
    }
    if (result.checksum && liveStat.checksum !== result.checksum) {
      bindingErrors.push(`live_checksum_mismatch:${binding.bindingId}`);
      continue;
    }
    pushRestoreReceipt(
      result.binding,
      result.livePath,
      liveStat.checksum,
      liveStat.bytes,
      result.record,
    );
    const cwErr = await compensateCogniWeaveBindingLifecycle({
      deps: params.deps,
      mode: "restore",
      binding: result.binding,
      conversationId: record.conversationId,
      transcriptPath: livePath,
      dataRoot,
    });
    if (cwErr) {
      bindingErrors.push(cwErr);
    }
  }
  if (bindingErrors.length > 0) {
    throw new Error(`RESTORE_PARTIAL_FAILURE:${bindingErrors.join(";")}`);
  }
  if (!restoreState.primary) {
    throw new Error("no archive transcript to restore");
  }
  return {
    record: restoreState.primary.record,
    binding: restoreState.primary.binding,
    livePath: restoreState.primary.livePath,
    checksum: restoreState.primary.checksum,
    restoredBindings,
    bindingReceipts,
  };
}

/**
 * Project conversation metadata onto a sessions.list row (compat surface).
 * When `createIfMissing` is false (lazy backfill off), only existing catalog
 * rows are projected — no new Conversation is created.
 */
export async function projectConversationOntoSession(params: {
  deps: ConversationServiceDeps;
  sessionKey: string;
  sessionId?: string | null;
  derivedTitle?: string | null;
  /** Default true. sessions.list passes flags.lazyBackfill. */
  createIfMissing?: boolean;
}): Promise<{
  conversationId?: string;
  conversationLifecycleStatus?: ConversationLifecycleStatus;
  conversationTitle?: string;
  storageTier?: ConversationRecord["storageTier"];
  retentionState?: ConversationRecord["retentionState"];
}> {
  if (!params.sessionId) {
    return {};
  }
  try {
    const catalog = requireCatalog(params.deps);
    if (params.createIfMissing === false) {
      const existing = await catalog.findBindingBySessionId(
        params.deps.ctx.dataPlaneId,
        params.sessionId,
      );
      if (!existing) {
        return {};
      }
      const record = await catalog.getConversation(
        params.deps.ctx.dataPlaneId,
        existing.conversationId,
      );
      if (!record) {
        return {};
      }
      return {
        conversationId: record.conversationId,
        conversationLifecycleStatus: record.lifecycleStatus,
        conversationTitle: record.title,
        storageTier: record.storageTier,
        retentionState: record.retentionState,
      };
    }
    const mapped = await ensureConversationForSession({
      catalog,
      ctx: params.deps.ctx,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      title: params.derivedTitle,
    });
    return {
      conversationId: mapped.record.conversationId,
      conversationLifecycleStatus: mapped.record.lifecycleStatus,
      conversationTitle: mapped.record.title,
      storageTier: mapped.record.storageTier,
      retentionState: mapped.record.retentionState,
    };
  } catch {
    return {};
  }
}

const SESSION_PROJECTION_BATCH = 8;

/**
 * Enrich Gateway-style session rows with Conversation Catalog fields (CL-P1-01).
 */
export async function enrichSessionRowsWithConversationProjection<
  T extends {
    key: string;
    sessionId?: string;
    derivedTitle?: string;
    displayName?: string;
    label?: string;
  },
>(params: {
  deps: ConversationServiceDeps;
  sessions: T[];
  createIfMissing: boolean;
}): Promise<
  Array<
    T & {
      conversationId?: string;
      conversationLifecycleStatus?: ConversationLifecycleStatus;
      conversationTitle?: string;
      storageTier?: ConversationRecord["storageTier"];
      retentionState?: ConversationRecord["retentionState"];
    }
  >
> {
  const out = params.sessions.map((row) => ({ ...row }));
  for (let i = 0; i < out.length; i += SESSION_PROJECTION_BATCH) {
    const chunk = out.slice(i, i + SESSION_PROJECTION_BATCH);
    const projected = await Promise.all(
      chunk.map(async (row) => {
        if (!row.sessionId) {
          return row;
        }
        const fields = await projectConversationOntoSession({
          deps: params.deps,
          sessionKey: row.key,
          sessionId: row.sessionId,
          derivedTitle: row.derivedTitle ?? row.displayName ?? row.label,
          createIfMissing: params.createIfMissing,
        });
        if (!fields.conversationId) {
          return row;
        }
        return { ...row, ...fields };
      }),
    );
    for (let j = 0; j < projected.length; j += 1) {
      out[i + j] = projected[j];
    }
  }
  return out;
}

export async function resolveBindingForHistory(params: {
  deps: ConversationServiceDeps;
  conversationId?: string;
  sessionKey?: string;
  sessionId?: string;
  bindingRole?: ConversationSessionBinding["role"];
}): Promise<{
  record: ConversationRecord;
  binding: ConversationSessionBinding;
} | null> {
  const catalog = requireCatalog(params.deps);
  const dataPlaneId = params.deps.ctx.dataPlaneId;

  // Prefer conversationId; fall back to sessionId / sessionKey embedding for chat.send guard.
  let conversationId = params.conversationId?.trim() || "";

  if (!conversationId && params.sessionId?.trim()) {
    const bySession = await catalog.findBindingBySessionId(dataPlaneId, params.sessionId.trim());
    if (bySession) {
      conversationId = bySession.conversationId;
    }
  }

  if (!conversationId && params.sessionKey?.trim()) {
    const key = params.sessionKey.trim();
    const convMatch = key.match(/:conversation:(conv_[a-z0-9_]+)/i);
    if (convMatch?.[1]) {
      conversationId = convMatch[1];
    }
  }

  if (!conversationId) {
    return null;
  }

  const record = await catalog.getConversation(dataPlaneId, conversationId);
  if (!record) {
    return null;
  }
  const bindings = await catalog.listBindings(dataPlaneId, conversationId);
  const role = params.bindingRole;
  let binding: ConversationSessionBinding | undefined;
  if (role) {
    binding = bindings.find((b) => b.role === role);
  } else if (params.sessionKey?.trim()) {
    binding = bindings.find((b) => b.sessionKey === params.sessionKey!.trim());
  } else if (params.sessionId?.trim()) {
    binding = bindings.find((b) => b.sessionId === params.sessionId!.trim());
  }
  if (!binding) {
    binding =
      bindings.find((b) => b.role === "PRIMARY" || b.role === "GROUP_PUBLIC") ?? bindings[0];
  }
  if (!binding) {
    return null;
  }
  if (params.sessionKey && binding.sessionKey !== params.sessionKey) {
    // Must agree when both provided and conversationId path
    if (params.conversationId) {
      return null;
    }
  }
  // Default authorize with read; callers that need write use assertConversationWriteAllowed.
  const auth = authorizeConversationAction({
    ctx: params.deps.ctx,
    record,
    action: "read",
    binding,
  });
  if (!auth.allowed) {
    return null;
  }
  if (binding.role === "AGENT_EXECUTION") {
    const execAuth = authorizeConversationAction({
      ctx: params.deps.ctx,
      record,
      action: "read_execution_stream",
      binding,
    });
    if (!execAuth.allowed) {
      return null;
    }
  }
  return { record, binding };
}

/**
 * Fail-closed write gate for chat.send / transcript append.
 * Conversation-mapped sessions must pass write ACL (includes PURGE_PENDING / ARCHIVED).
 * Returns reasonCode when denied; null when allowed.
 */
export function assertConversationWriteAllowed(params: {
  ctx: ConversationTenantContext;
  record: ConversationRecord;
  binding: ConversationSessionBinding;
}): { allowed: true } | { allowed: false; reasonCode: string } {
  const auth = authorizeConversationAction({
    ctx: params.ctx,
    record: params.record,
    action: "write",
    binding: params.binding,
  });
  if (!auth.allowed) {
    return { allowed: false, reasonCode: auth.reasonCode };
  }
  // Binding-level freeze (purge FREEZE step) must block writes even if catalog
  // retention race leaves a brief window before PURGE_PENDING is re-checked.
  if (
    params.binding.transcriptState === "READ_ONLY" ||
    params.binding.transcriptState === "ARCHIVED" ||
    params.binding.transcriptState === "PURGED"
  ) {
    return { allowed: false, reasonCode: "BINDING_READ_ONLY" };
  }
  if (params.record.retentionState === "PURGE_PENDING") {
    return { allowed: false, reasonCode: "PURGE_PENDING" };
  }
  if (params.record.lifecycleStatus === "ARCHIVED" || params.record.lifecycleStatus === "DELETED") {
    return { allowed: false, reasonCode: "ARCHIVED_READ_ONLY" };
  }
  return { allowed: true };
}

/** True when session key is product Conversation-scoped (not pure legacy agent:main:main). */
export function isConversationScopedSessionKey(sessionKey: string): boolean {
  const key = sessionKey.trim();
  return /:conversation:conv_[a-z0-9_]+/i.test(key) || /:space:[^:]+:conversation:conv_/i.test(key);
}

// ─── P3 / P4 service extensions ─────────────────────────────────────────────

export async function attachExecutionBinding(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
  agentId: string;
  etag?: string;
}) {
  const catalog = requireCatalog(params.deps);
  const { attachAgentExecutionBinding } = await import("./collaboration-bindings.js");
  return attachAgentExecutionBinding({
    catalog,
    cfg: params.deps.cfg,
    ctx: params.deps.ctx,
    conversationId: params.conversationId,
    agentId: params.agentId,
    etag: params.etag,
  });
}

export async function endExecutionBinding(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
  agentId: string;
  etag?: string;
}) {
  const catalog = requireCatalog(params.deps);
  const { endAgentExecutionBinding } = await import("./collaboration-bindings.js");
  return endAgentExecutionBinding({
    catalog,
    ctx: params.deps.ctx,
    conversationId: params.conversationId,
    agentId: params.agentId,
    etag: params.etag,
  });
}

export async function getConversationLineage(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
}) {
  const catalog = requireCatalog(params.deps);
  const record = await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId);
  if (!record) {
    throw new CatalogNotFoundError();
  }
  const auth = authorizeConversationAction({
    ctx: params.deps.ctx,
    record,
    action: "read",
  });
  if (!auth.allowed) {
    throw new Error(auth.reasonCode);
  }
  const bindings = await catalog.listBindings(params.deps.ctx.dataPlaneId, params.conversationId);
  const { buildConversationLineage } = await import("./collaboration-bindings.js");
  return {
    record,
    bindings,
    lineage: buildConversationLineage({ record, bindings }),
  };
}

export async function getSharedTaskContextForConversation(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
}) {
  const { resolveDataRoot } = await import("../config/data-space.js");
  const { getSharedTaskContextStore, emptySharedTaskContext } =
    await import("./shared-task-context.js");
  const catalog = requireCatalog(params.deps);
  const record = await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId);
  if (!record) {
    throw new CatalogNotFoundError();
  }
  if (record.surfaceType !== "COLLABORATION_GROUP" || !record.groupId) {
    throw new Error("shared task context only for collaboration conversations");
  }
  const auth = authorizeConversationAction({
    ctx: params.deps.ctx,
    record,
    action: "read",
  });
  if (!auth.allowed) {
    throw new Error(auth.reasonCode);
  }
  const store = getSharedTaskContextStore(resolveDataRoot(params.deps.cfg));
  const existing = await store.get(record.groupId, record.conversationId);
  return (
    existing ??
    emptySharedTaskContext({
      conversationId: record.conversationId,
      groupId: record.groupId,
      updatedBy: params.deps.ctx.principalId,
    })
  );
}

export async function updateSharedTaskContextForConversation(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
  patch: {
    mission?: string | null;
    currentPhase?: string | null;
    goals?: import("./shared-task-context.js").SharedTaskContext["goals"];
    approvedDecisions?: import("./shared-task-context.js").SharedTaskContext["approvedDecisions"];
    hardConstraints?: import("./shared-task-context.js").SharedTaskContext["hardConstraints"];
    unresolvedQuestions?: import("./shared-task-context.js").SharedTaskContext["unresolvedQuestions"];
    taskRefs?: string[];
    deliverableRefs?: string[];
  };
  expectedRevision: number;
}) {
  const { resolveDataRoot } = await import("../config/data-space.js");
  const { getSharedTaskContextStore, emptySharedTaskContext } =
    await import("./shared-task-context.js");
  const catalog = requireCatalog(params.deps);
  const record = await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId);
  if (!record) {
    throw new CatalogNotFoundError();
  }
  if (record.surfaceType !== "COLLABORATION_GROUP" || !record.groupId) {
    throw new Error("shared task context only for collaboration conversations");
  }
  const auth = authorizeConversationAction({
    ctx: params.deps.ctx,
    record,
    action: "write",
  });
  if (!auth.allowed) {
    throw new Error(auth.reasonCode);
  }
  const store = getSharedTaskContextStore(resolveDataRoot(params.deps.cfg));
  const current =
    (await store.get(record.groupId, record.conversationId)) ??
    emptySharedTaskContext({
      conversationId: record.conversationId,
      groupId: record.groupId,
      updatedBy: params.deps.ctx.principalId,
    });
  const next = {
    ...current,
    ...params.patch,
    conversationId: record.conversationId,
    groupId: record.groupId,
    revision: current.revision + 1,
    updatedBy: params.deps.ctx.principalId,
    updatedAt: new Date().toISOString(),
  };
  return store.save(next, params.expectedRevision);
}

export async function searchConversationsService(params: {
  deps: ConversationServiceDeps;
  query: import("./search.js").ConversationSearchQuery;
  /** Optional query embedding for semantic search when enabled. */
  queryEmbedding?: number[];
}) {
  const catalog = requireCatalog(params.deps);
  const { searchConversations } = await import("./search.js");
  const { resolveConversationFlags } = await import("./flags.js");
  const flags = resolveConversationFlags(params.deps.cfg, {
    tenantId: params.deps.ctx.tenantId,
    principalId: params.deps.ctx.principalId,
    seatId: params.deps.ctx.seatId,
  });

  let transcriptHits = params.query.transcriptHits;
  try {
    const { getConversationSearchIndex, isSemanticSearchEnabled } =
      await import("./search-index.js");
    const index = getConversationSearchIndex({ cfg: params.deps.cfg });
    if (params.query.query?.trim()) {
      const kw = index.searchKeyword({
        dataPlaneId: params.deps.ctx.dataPlaneId,
        query: params.query.query,
        limit: 30,
      });
      transcriptHits = [
        ...(transcriptHits ?? []),
        ...kw.map((h) => ({
          conversationId: h.conversationId,
          sessionId: h.sessionId,
          snippet: h.snippet,
          score: h.score,
        })),
      ];
      if (isSemanticSearchEnabled(params.deps.cfg) || flags.searchSemanticEnabled) {
        const { embedConversationQuery } = await import("./conversation-embeddings.js");
        const embResult =
          params.queryEmbedding && params.queryEmbedding.length > 0
            ? {
                embedding: params.queryEmbedding,
                providerId: "caller",
                isRealModel: true,
              }
            : await embedConversationQuery({
                cfg: params.deps.cfg,
                text: params.query.query,
              });
        const sem = index.searchSemantic({
          dataPlaneId: params.deps.ctx.dataPlaneId,
          queryEmbedding: embResult.embedding,
          limit: 20,
          // Real model dims may differ from hash-64 docs; minScore stays soft.
          minScore: embResult.isRealModel ? 0.15 : 0.05,
        });
        transcriptHits = [
          ...transcriptHits,
          ...sem.map((h) => ({
            conversationId: h.conversationId,
            sessionId: h.sessionId,
            snippet: h.snippet,
            score: h.score * 2,
          })),
        ];
      }
    }
  } catch {
    // index optional
  }

  const { buildDefaultRetentionPolicy } = await import("./retention.js");
  const policy = buildDefaultRetentionPolicy(params.deps.ctx);
  return searchConversations({
    catalog,
    ctx: params.deps.ctx,
    query: {
      ...params.query,
      transcriptHits,
      // Policy gate wins over includeArchived for archived visibility.
      archiveSearchEnabled: params.query.archiveSearchEnabled ?? policy.archiveSearchEnabled,
    },
  });
}

/** Index a conversation transcript into FTS (+ hash embedding when semantic on). */
export async function indexConversationTranscript(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
  sessionId: string;
  bindingId: string;
  title: string;
  body: string;
}) {
  const { getConversationSearchIndex, isSemanticSearchEnabled } = await import("./search-index.js");
  const { resolveConversationFlags } = await import("./flags.js");
  const flags = resolveConversationFlags(params.deps.cfg, {
    tenantId: params.deps.ctx.tenantId,
    principalId: params.deps.ctx.principalId,
    seatId: params.deps.ctx.seatId,
  });
  const index = getConversationSearchIndex({ cfg: params.deps.cfg });
  let embedding: number[] | null = null;
  if (flags.searchSemanticEnabled || isSemanticSearchEnabled(params.deps.cfg)) {
    try {
      const { resolveConversationEmbeddingProvider } = await import("./conversation-embeddings.js");
      const provider = await resolveConversationEmbeddingProvider({ cfg: params.deps.cfg });
      embedding = await provider.embedQuery(`${params.title}\n${params.body}`.slice(0, 8000));
    } catch {
      const { hashEmbedding } = await import("./search-index.js");
      embedding = hashEmbedding(`${params.title}\n${params.body}`, 64);
    }
  }
  index.upsertDocument({
    conversationId: params.conversationId,
    dataPlaneId: params.deps.ctx.dataPlaneId,
    sessionId: params.sessionId,
    bindingId: params.bindingId,
    title: params.title,
    body: params.body,
    updatedAt: new Date().toISOString(),
    embedding,
  });
}

export async function runRetentionScan(params: {
  deps: ConversationServiceDeps;
  enforce?: boolean;
  limit?: number;
  /** When true, also run WARM/EXPIRING → COLD physical migration. */
  migrateCold?: boolean;
  removeLiveAfterCold?: boolean;
}) {
  const catalog = requireCatalog(params.deps);
  const { resolveConversationFlags } = await import("./flags.js");
  const flags = resolveConversationFlags(params.deps.cfg, {
    tenantId: params.deps.ctx.tenantId,
    principalId: params.deps.ctx.principalId,
    seatId: params.deps.ctx.seatId,
  });
  const { scanRetentionBatch } = await import("./retention-worker.js");
  const scan = await scanRetentionBatch({
    catalog,
    ctx: params.deps.ctx,
    enforce: params.enforce ?? flags.retentionEnforceEnabled,
    limit: params.limit,
  });
  let cold: Awaited<ReturnType<typeof import("./cold-migrate.js").runColdMigrationBatch>> | null =
    null;
  if (params.migrateCold || flags.retentionEnforceEnabled) {
    const { runColdMigrationBatch } = await import("./cold-migrate.js");
    cold = await runColdMigrationBatch({
      catalog,
      cfg: params.deps.cfg,
      dataPlaneId: params.deps.ctx.dataPlaneId,
      tenantId: params.deps.ctx.tenantId,
      limit: params.limit,
      removeLive: params.removeLiveAfterCold === true,
      dataRoot: params.deps.dataRoot,
    });
  }
  return { ...scan, cold };
}

export async function exportConversationService(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
}) {
  const catalog = requireCatalog(params.deps);
  const { exportConversation } = await import("./export-ops.js");
  const { resolveSessionFilePath, resolveSessionFilePathOptions, resolveStorePath } =
    await import("../config/sessions/paths.js");
  const record = await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId);
  if (!record) {
    throw new CatalogNotFoundError();
  }
  const bindings = await catalog.listBindings(params.deps.ctx.dataPlaneId, params.conversationId);
  const transcriptPaths: Array<{ bindingId: string; sessionId: string; absPath: string }> = [];
  for (const b of bindings) {
    if (b.role === "AGENT_EXECUTION") {
      // Default export only includes user-visible streams.
      continue;
    }
    const agentId = b.agentId ?? "main";
    const storePath = resolveStorePath(params.deps.cfg.session?.store, { agentId });
    const absPath = resolveSessionFilePath(
      b.sessionId,
      undefined,
      resolveSessionFilePathOptions({ agentId, storePath }),
    );
    transcriptPaths.push({ bindingId: b.bindingId, sessionId: b.sessionId, absPath });
  }
  return exportConversation({
    catalog,
    cfg: params.deps.cfg,
    ctx: params.deps.ctx,
    conversationId: params.conversationId,
    transcriptPaths,
    dataRoot: planeRoot(params.deps),
  });
}

export async function requestPurgeService(params: {
  deps: ConversationServiceDeps;
  conversationId: string;
  requestId: string;
  /** Use real filesystem + memory adapters (default true). */
  realAdapters?: boolean;
}) {
  const catalog = requireCatalog(params.deps);
  const { requestConversationPurge, runPurgeJob, createNoopPurgeAdapters } =
    await import("./purge/fsm.js");
  const { createRealPurgeAdapters, collectPurgeManifestObjects } =
    await import("./purge/real-adapters.js");
  const bindings = await catalog.listBindings(params.deps.ctx.dataPlaneId, params.conversationId);
  const record = await catalog.getConversation(params.deps.ctx.dataPlaneId, params.conversationId);
  if (!record) {
    throw new CatalogNotFoundError();
  }
  const useReal = params.realAdapters !== false;
  const dataRoot = planeRoot(params.deps);
  const collect = async () =>
    useReal
      ? collectPurgeManifestObjects({
          cfg: params.deps.cfg,
          catalog,
          record,
          bindings,
          dataRoot,
        })
      : bindings.map((b) => ({
          kind: "binding" as const,
          id: b.bindingId,
          locator: b.sessionKey,
        }));

  const { job, manifest } = await requestConversationPurge({
    catalog,
    ctx: params.deps.ctx,
    conversationId: params.conversationId,
    requestId: params.requestId,
    collectManifestObjects: collect,
  });

  const adapters = useReal
    ? createRealPurgeAdapters({
        cfg: params.deps.cfg,
        catalog,
        bindings,
        transcriptAbsPaths: [],
        dataRoot,
      })
    : createNoopPurgeAdapters();

  const finished = await runPurgeJob({
    deps: {
      catalog,
      adapters,
      collectManifestObjects: collect,
    },
    jobId: job.purgeJobId,
    dataPlaneId: params.deps.ctx.dataPlaneId,
    // manifest intentionally omitted — executor uses only durable job.manifest
  });
  return { job: finished, manifest: finished.manifest ?? manifest };
}

export async function runSourceIdentityMigrationService(params: {
  deps: ConversationServiceDeps;
  agentId?: string;
}) {
  const catalog = requireCatalog(params.deps);
  const { runOpenbotPathSourceIdentityMigration } = await import("./source-identity-migration.js");
  return runOpenbotPathSourceIdentityMigration({
    catalog,
    cfg: params.deps.cfg,
    dataPlaneId: params.deps.ctx.dataPlaneId,
    agentId: params.agentId,
  });
}

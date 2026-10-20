import type { ConversationCatalogRepository } from "./catalog/repository.js";
/**
 * Lazy session → Conversation mapping (plan §14.2, CL-P0-01).
 * Idempotent: same session maps to same conversationId.
 */
import {
  buildConversationMigrationKey,
  createEtag,
  deriveBindingIdFromMigration,
  deriveConversationIdFromMigration,
  inferSurfaceFromSessionKey,
} from "./ids.js";
import type {
  ConversationOwnershipScopeType,
  ConversationRecord,
  ConversationSessionBinding,
  ConversationTenantContext,
} from "./types.js";

export type LazyMapSessionInput = {
  catalog: ConversationCatalogRepository;
  ctx: ConversationTenantContext;
  sessionKey: string;
  sessionId: string;
  /** Existing derived title/label if any. */
  title?: string | null;
  /** Optional participant list. */
  participantIds?: string[];
  now?: string;
};

export type LazyMapSessionResult = {
  record: ConversationRecord;
  binding: ConversationSessionBinding;
  created: boolean;
};

function resolveOwnership(
  ctx: ConversationTenantContext,
  surface: ReturnType<typeof inferSurfaceFromSessionKey>,
): { ownershipScopeType: ConversationOwnershipScopeType; ownershipScopeId: string } {
  if (surface.surfaceType === "COLLABORATION_GROUP" && surface.groupId) {
    return { ownershipScopeType: "GROUP", ownershipScopeId: surface.groupId };
  }
  if (ctx.mode === "managed" && ctx.seatId) {
    return { ownershipScopeType: "SEAT", ownershipScopeId: ctx.seatId };
  }
  return { ownershipScopeType: "USER", ownershipScopeId: ctx.principalId };
}

/**
 * Ensure a Conversation + binding exist for a runtime session (lazy backfill).
 * Does not open transcript. Safe to call repeatedly.
 */
export async function ensureConversationForSession(
  input: LazyMapSessionInput,
): Promise<LazyMapSessionResult> {
  const now = input.now ?? new Date().toISOString();
  const surface = inferSurfaceFromSessionKey(input.sessionKey);
  const migrationKey = buildConversationMigrationKey({
    dataPlaneId: input.ctx.dataPlaneId,
    sessionId: input.sessionId,
    bindingRole: surface.bindingRole,
  });

  const existingByMigration = await input.catalog.findBindingByMigrationKey(
    input.ctx.dataPlaneId,
    migrationKey,
  );
  if (existingByMigration) {
    const record = await input.catalog.getConversation(
      input.ctx.dataPlaneId,
      existingByMigration.conversationId,
    );
    if (record) {
      return { record, binding: existingByMigration, created: false };
    }
  }

  const existingBySession = await input.catalog.findBindingBySessionId(
    input.ctx.dataPlaneId,
    input.sessionId,
  );
  if (existingBySession) {
    const record = await input.catalog.getConversation(
      input.ctx.dataPlaneId,
      existingBySession.conversationId,
    );
    if (record) {
      await input.catalog.putMigrationKey(
        input.ctx.dataPlaneId,
        migrationKey,
        existingBySession.bindingId,
      );
      return { record, binding: existingBySession, created: false };
    }
  }

  const conversationId = deriveConversationIdFromMigration({
    dataPlaneId: input.ctx.dataPlaneId,
    sessionId: input.sessionId,
    bindingRole: surface.bindingRole,
  });
  const bindingId = deriveBindingIdFromMigration({
    dataPlaneId: input.ctx.dataPlaneId,
    conversationId,
    sessionId: input.sessionId,
    bindingRole: surface.bindingRole,
  });
  const ownership = resolveOwnership(input.ctx, surface);
  const title =
    input.title?.trim() ||
    (surface.surfaceType === "COLLABORATION_GROUP"
      ? `Group ${surface.groupId ?? "discussion"}`
      : "Conversation");

  const record: ConversationRecord = {
    schemaVersion: 1,
    conversationId,
    dataPlaneId: input.ctx.dataPlaneId,
    tenantId: input.ctx.tenantId,
    ownershipScopeType: ownership.ownershipScopeType,
    ownershipScopeId: ownership.ownershipScopeId,
    createdByUserId: input.ctx.principalId,
    surfaceType: surface.surfaceType,
    agentId: surface.agentId,
    groupId: surface.groupId,
    title,
    titleSource: "AUTO",
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
    participantIds: input.participantIds ?? [input.ctx.principalId],
    primaryBindingId: bindingId,
    etag: createEtag(),
  };

  const binding: ConversationSessionBinding = {
    schemaVersion: 1,
    bindingId,
    dataPlaneId: input.ctx.dataPlaneId,
    conversationId,
    sessionKey: input.sessionKey,
    sessionId: input.sessionId,
    agentId: surface.agentId,
    role: surface.bindingRole,
    aliasTargetBindingId: null,
    transcriptState: "LIVE",
    createdAt: now,
    endedAt: null,
  };

  // Race-safe: if concurrent create won, re-read.
  try {
    await input.catalog.createConversation(record, binding);
    await input.catalog.putMigrationKey(input.ctx.dataPlaneId, migrationKey, bindingId);
    return { record, binding, created: true };
  } catch {
    const again = await input.catalog.findBindingBySessionId(
      input.ctx.dataPlaneId,
      input.sessionId,
    );
    if (again) {
      const rec = await input.catalog.getConversation(input.ctx.dataPlaneId, again.conversationId);
      if (rec) {
        await input.catalog.putMigrationKey(input.ctx.dataPlaneId, migrationKey, again.bindingId);
        return { record: rec, binding: again, created: false };
      }
    }
    throw new Error("failed to create or re-read conversation for session");
  }
}

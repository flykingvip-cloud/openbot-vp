import {
  ensurePersonalDeliverablesKnowledgeBase,
  ensureTeamDeliverablesKnowledgeBase,
  resolveReservedDeliverableFolderKind,
  type ReservedDeliverableFolderKind,
} from "../deliverable-folders.js";
import { getKnowledgeBase, type KnowledgeBase } from "../knowledge-base-store.js";

/** Client sentinel: gateway picks 个人成果 or 团队成果. */
export const SAVE_ARCHIVE_KB_AUTO = "auto";

export class SaveArchiveKnowledgeBaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveArchiveKnowledgeBaseError";
  }
}

export function isAutoSaveArchiveKnowledgeBaseId(value: string | null | undefined): boolean {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return !trimmed || trimmed === SAVE_ARCHIVE_KB_AUTO || trimmed === "default";
}

function expectedSaveArchiveKind(groupId?: string | null): ReservedDeliverableFolderKind {
  return groupId?.trim() ? "team_deliverables" : "personal_deliverables";
}

/**
 * Resolve contextual default archive target:
 * - collaboration group → 团队成果 when writable
 * - otherwise → 个人成果
 * Missing team write access fails closed. Never silently fall back to 个人成果.
 */
export function resolveDefaultSaveArchiveKnowledgeBase(params: {
  userId: string;
  tenantId?: string | null;
  groupId?: string | null;
  storePath?: string;
  /** When set, team/personal folder is used only if this returns true (write ACL). */
  canWrite?: (knowledgeBase: KnowledgeBase) => boolean;
}): { knowledgeBase: KnowledgeBase; source: ReservedDeliverableFolderKind } {
  const userId = params.userId.trim();
  if (!userId) {
    throw new SaveArchiveKnowledgeBaseError(
      "userId required to resolve save archive knowledge base",
    );
  }

  const groupId = params.groupId?.trim() || "";
  if (groupId) {
    const team = ensureTeamDeliverablesKnowledgeBase({
      ownerId: userId,
      tenantId: params.tenantId,
      storePath: params.storePath,
    });
    if (params.canWrite && !params.canWrite(team)) {
      throw new SaveArchiveKnowledgeBaseError("not authorized to write team deliverables folder");
    }
    return { knowledgeBase: team, source: "team_deliverables" };
  }

  const personal = ensurePersonalDeliverablesKnowledgeBase({
    ownerId: userId,
    tenantId: params.tenantId,
    storePath: params.storePath,
  });
  if (params.canWrite && !params.canWrite(personal)) {
    throw new SaveArchiveKnowledgeBaseError("not authorized to write personal deliverables folder");
  }
  return { knowledgeBase: personal, source: "personal_deliverables" };
}

/**
 * Resolve the only legal archive target for an explicit save.
 * Empty / auto / default follow session ownership. An explicit knowledgeBaseId
 * must already be the matching reserved folder and must be writable.
 */
export function resolveSaveArchiveKnowledgeBase(params: {
  userId: string;
  tenantId?: string | null;
  groupId?: string | null;
  knowledgeBaseId?: string | null;
  storePath?: string;
  lookup?: (knowledgeBaseId: string) => KnowledgeBase | null;
  canWrite?: (knowledgeBase: KnowledgeBase) => boolean;
}): { knowledgeBase: KnowledgeBase; source: ReservedDeliverableFolderKind } {
  const expectedKind = expectedSaveArchiveKind(params.groupId);
  if (isAutoSaveArchiveKnowledgeBaseId(params.knowledgeBaseId)) {
    const resolved = resolveDefaultSaveArchiveKnowledgeBase(params);
    if (resolved.source !== expectedKind) {
      throw new SaveArchiveKnowledgeBaseError(
        `deliverable must be saved to the ${expectedKind} folder`,
      );
    }
    return resolved;
  }

  const knowledgeBaseId = params.knowledgeBaseId?.trim() ?? "";
  const existing =
    params.lookup?.(knowledgeBaseId) ?? getKnowledgeBase(knowledgeBaseId, params.storePath);
  if (!existing || existing.visibility === "enterprise") {
    throw new SaveArchiveKnowledgeBaseError("not authorized to modify knowledge base");
  }
  const kind = resolveReservedDeliverableFolderKind(existing);
  if (kind !== expectedKind) {
    throw new SaveArchiveKnowledgeBaseError(
      `deliverable must be saved to the ${expectedKind} folder`,
    );
  }
  if (params.canWrite && !params.canWrite(existing)) {
    throw new SaveArchiveKnowledgeBaseError("not authorized to modify knowledge base");
  }
  return { knowledgeBase: existing, source: kind };
}

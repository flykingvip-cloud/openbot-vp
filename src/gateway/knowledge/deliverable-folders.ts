import type { WorkspaceArtifactSourceType } from "./deliverables/types.js";
import {
  createKnowledgeBase,
  listKnowledgeBases,
  updateKnowledgeBase,
  type KnowledgeBase,
} from "./knowledge-base-store.js";

export const PERSONAL_DELIVERABLES_KB_TAG = "openbot:personal-deliverables";
export const PERSONAL_DELIVERABLES_KB_TITLE = "个人成果";
export const TEAM_DELIVERABLES_KB_TAG = "openbot:team-deliverables";
export const TEAM_DELIVERABLES_KB_TITLE = "团队成果";

export type ReservedDeliverableFolderKind = "personal_deliverables" | "team_deliverables";

export function isReservedDeliverableFolder(
  base: Pick<KnowledgeBase, "tags" | "title"> | null | undefined,
): boolean {
  return resolveReservedDeliverableFolderKind(base) !== null;
}

export function resolveReservedDeliverableFolderKind(
  base: Pick<KnowledgeBase, "tags" | "title"> | null | undefined,
): ReservedDeliverableFolderKind | null {
  if (!base) {
    return null;
  }
  const tags = base.tags ?? [];
  if (
    tags.includes(PERSONAL_DELIVERABLES_KB_TAG) ||
    base.title === PERSONAL_DELIVERABLES_KB_TITLE
  ) {
    return "personal_deliverables";
  }
  if (tags.includes(TEAM_DELIVERABLES_KB_TAG) || base.title === TEAM_DELIVERABLES_KB_TITLE) {
    return "team_deliverables";
  }
  return null;
}

export function shouldSkipReservedDeliverableArchive(
  sourceType?: WorkspaceArtifactSourceType | null,
): boolean {
  return sourceType === "enterprise" || sourceType === "external";
}

function restoreReservedTitle(
  existing: KnowledgeBase,
  title: string,
  storePath?: string,
): KnowledgeBase {
  if (existing.title === title) {
    return existing;
  }
  return updateKnowledgeBase(existing.id, { title }, storePath);
}

export function findPersonalDeliverablesKnowledgeBase(
  ownerId: string,
  storePath?: string,
): KnowledgeBase | null {
  const normalizedOwner = ownerId.trim();
  if (!normalizedOwner) {
    return null;
  }
  return (
    listKnowledgeBases({ ownerId: normalizedOwner }, storePath).find(
      (base) => resolveReservedDeliverableFolderKind(base) === "personal_deliverables",
    ) ?? null
  );
}

export function ensurePersonalDeliverablesKnowledgeBase(params: {
  ownerId: string;
  tenantId?: string | null;
  storePath?: string;
}): KnowledgeBase {
  const ownerId = params.ownerId.trim();
  if (!ownerId) {
    throw new Error("ownerId required for personal deliverables knowledge base");
  }
  const existing = findPersonalDeliverablesKnowledgeBase(ownerId, params.storePath);
  if (existing) {
    return restoreReservedTitle(existing, PERSONAL_DELIVERABLES_KB_TITLE, params.storePath);
  }
  return createKnowledgeBase(
    {
      title: PERSONAL_DELIVERABLES_KB_TITLE,
      description: "数字人与个人对话产出的固定成果库",
      ownerId,
      tenantId: params.tenantId ?? null,
      visibility: "private",
      backendKind: "personal",
      tags: [PERSONAL_DELIVERABLES_KB_TAG],
    },
    params.storePath,
  );
}

export function findTeamDeliverablesKnowledgeBase(params: {
  ownerId: string;
  tenantId?: string | null;
  storePath?: string;
}): KnowledgeBase | null {
  const ownerId = params.ownerId.trim();
  if (!ownerId) {
    return null;
  }
  const tenantId = params.tenantId?.trim() || null;
  const candidates = listKnowledgeBases({}, params.storePath).filter(
    (base) => resolveReservedDeliverableFolderKind(base) === "team_deliverables",
  );
  if (tenantId) {
    return candidates.find((base) => (base.tenantId ?? null) === tenantId) ?? null;
  }
  return candidates.find((base) => base.ownerId === ownerId) ?? null;
}

export function ensureTeamDeliverablesKnowledgeBase(params: {
  ownerId: string;
  tenantId?: string | null;
  storePath?: string;
}): KnowledgeBase {
  const ownerId = params.ownerId.trim();
  if (!ownerId) {
    throw new Error("ownerId required for team deliverables knowledge base");
  }
  const existing = findTeamDeliverablesKnowledgeBase(params);
  if (existing) {
    return restoreReservedTitle(existing, TEAM_DELIVERABLES_KB_TITLE, params.storePath);
  }
  return createKnowledgeBase(
    {
      title: TEAM_DELIVERABLES_KB_TITLE,
      description: "协作小组产出的固定成果库",
      ownerId,
      tenantId: params.tenantId ?? null,
      visibility: "team",
      backendKind: "personal",
      tags: [TEAM_DELIVERABLES_KB_TAG],
    },
    params.storePath,
  );
}

export function ensureReservedDeliverableFolders(params: {
  ownerId: string;
  tenantId?: string | null;
  storePath?: string;
}): { personal: KnowledgeBase; team: KnowledgeBase } {
  return {
    personal: ensurePersonalDeliverablesKnowledgeBase(params),
    team: ensureTeamDeliverablesKnowledgeBase(params),
  };
}

export function resolveReservedDeliverableArchiveFolder(params: {
  ownerId: string;
  tenantId?: string | null;
  groupId?: string | null;
  sourceType?: WorkspaceArtifactSourceType | null;
  storePath?: string;
}): { knowledgeBase: KnowledgeBase; kind: ReservedDeliverableFolderKind } | null {
  if (shouldSkipReservedDeliverableArchive(params.sourceType)) {
    return null;
  }
  const useTeam = params.sourceType === "collaboration" || Boolean(params.groupId?.trim());
  if (useTeam) {
    return {
      knowledgeBase: ensureTeamDeliverablesKnowledgeBase(params),
      kind: "team_deliverables",
    };
  }
  return {
    knowledgeBase: ensurePersonalDeliverablesKnowledgeBase(params),
    kind: "personal_deliverables",
  };
}

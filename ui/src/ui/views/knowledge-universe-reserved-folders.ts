import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";

export const PERSONAL_DELIVERABLES_KB_TAG = "openbot:personal-deliverables";
export const TEAM_DELIVERABLES_KB_TAG = "openbot:team-deliverables";
export const PERSONAL_DELIVERABLES_KB_TITLE = "个人成果";
export const TEAM_DELIVERABLES_KB_TITLE = "团队成果";

export type ReservedDeliverableFolderKind = "personal_deliverables" | "team_deliverables";

export function resolveReservedDeliverableFolderKind(
  kb: Pick<KnowledgeBaseSummary, "title" | "tags" | "reservedKind">,
): ReservedDeliverableFolderKind | null {
  if (kb.reservedKind === "personal_deliverables" || kb.reservedKind === "team_deliverables") {
    return kb.reservedKind;
  }
  const tags = kb.tags ?? [];
  if (tags.includes(PERSONAL_DELIVERABLES_KB_TAG) || kb.title === PERSONAL_DELIVERABLES_KB_TITLE) {
    return "personal_deliverables";
  }
  if (tags.includes(TEAM_DELIVERABLES_KB_TAG) || kb.title === TEAM_DELIVERABLES_KB_TITLE) {
    return "team_deliverables";
  }
  return null;
}

export function isReservedDeliverableKnowledgeBase(
  kb: Pick<KnowledgeBaseSummary, "title" | "tags" | "reservedKind">,
): boolean {
  return resolveReservedDeliverableFolderKind(kb) !== null;
}

export function findReservedDeliverableKnowledgeBase(
  knowledgeBases: KnowledgeBaseSummary[],
  kind: ReservedDeliverableFolderKind,
): KnowledgeBaseSummary | undefined {
  return knowledgeBases.find((kb) => resolveReservedDeliverableFolderKind(kb) === kind);
}

export function withReservedDeliverableFoldersFirst(
  knowledgeBases: KnowledgeBaseSummary[],
): KnowledgeBaseSummary[] {
  const reserved = knowledgeBases.filter(isReservedDeliverableKnowledgeBase);
  const rest = knowledgeBases.filter((kb) => !isReservedDeliverableKnowledgeBase(kb));
  return [...reserved, ...rest];
}

/** Enterprise spaces are read-only unless gateway marked the actor as writer. */
export function knowledgeBaseAllowsWrite(kb: KnowledgeBaseSummary): boolean {
  if (kb.canWrite === true) {
    return true;
  }
  if (kb.canWrite === false) {
    return false;
  }
  return kb.visibility !== "enterprise";
}

export function knowledgeBaseAllowsAdmin(kb: KnowledgeBaseSummary): boolean {
  if (kb.canAdmin === true) {
    return true;
  }
  if (kb.canAdmin === false) {
    return false;
  }
  return kb.visibility === "private";
}

/** Folder ⋯ rename/delete: reserved folders never; enterprise needs explicit admin. */
export function canManageKnowledgeTreeFolder(kb: KnowledgeBaseSummary): boolean {
  if (isReservedDeliverableKnowledgeBase(kb)) {
    return false;
  }
  if (kb.visibility === "enterprise") {
    return knowledgeBaseAllowsAdmin(kb);
  }
  return kb.canAdmin !== false;
}

export function canCreateKnowledgeFolderInSection(
  knowledgeBases: KnowledgeBaseSummary[],
  visibility: KnowledgeBaseSummary["visibility"],
): boolean {
  if (visibility === "private" || visibility === "team") {
    return true;
  }
  return knowledgeBases.some(
    (kb) => kb.visibility === "enterprise" && knowledgeBaseAllowsWrite(kb),
  );
}

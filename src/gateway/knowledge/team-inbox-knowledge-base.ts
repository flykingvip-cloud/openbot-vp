import {
  createKnowledgeBase,
  listKnowledgeBases,
  type KnowledgeBase,
} from "./knowledge-base-store.js";

export const TEAM_INBOX_KB_TAG = "openbot:team-inbox";
export const TEAM_INBOX_KB_TITLE = "小组收录";

export function teamInboxGroupTag(groupId: string): string {
  return `group:${groupId.trim()}`;
}

export function findTeamInboxKnowledgeBase(
  groupId: string,
  storePath?: string,
): KnowledgeBase | null {
  const trimmed = groupId.trim();
  if (!trimmed) {
    return null;
  }
  const groupTag = teamInboxGroupTag(trimmed);
  return (
    listKnowledgeBases({}, storePath).find(
      (base) =>
        base.visibility === "team" &&
        base.tags.includes(TEAM_INBOX_KB_TAG) &&
        base.tags.includes(groupTag),
    ) ?? null
  );
}

export function ensureTeamInboxKnowledgeBase(params: {
  ownerId: string;
  groupId: string;
  tenantId?: string | null;
  storePath?: string;
}): KnowledgeBase {
  const ownerId = params.ownerId.trim();
  const groupId = params.groupId.trim();
  if (!ownerId) {
    throw new Error("ownerId required for team inbox knowledge base");
  }
  if (!groupId) {
    throw new Error("groupId required for team inbox knowledge base");
  }
  const existing = findTeamInboxKnowledgeBase(groupId, params.storePath);
  if (existing) {
    return existing;
  }
  return createKnowledgeBase(
    {
      title: TEAM_INBOX_KB_TITLE,
      description: `协作小组 ${groupId} 默认知识库`,
      ownerId,
      tenantId: params.tenantId ?? null,
      visibility: "team",
      backendKind: "personal",
      tags: [TEAM_INBOX_KB_TAG, teamInboxGroupTag(groupId)],
    },
    params.storePath,
  );
}

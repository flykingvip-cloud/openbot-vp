import {
  createKnowledgeBase,
  listKnowledgeBases,
  type KnowledgeBase,
} from "./knowledge-base-store.js";

export const PERSONAL_INBOX_KB_TAG = "openbot:personal-inbox";
export const PERSONAL_INBOX_KB_TITLE = "我的收录";

export function findPersonalInboxKnowledgeBase(
  ownerId: string,
  storePath?: string,
): KnowledgeBase | null {
  const normalizedOwner = ownerId.trim();
  if (!normalizedOwner) {
    return null;
  }
  return (
    listKnowledgeBases({ ownerId: normalizedOwner }, storePath).find(
      (base) => base.tags.includes(PERSONAL_INBOX_KB_TAG) || base.title === PERSONAL_INBOX_KB_TITLE,
    ) ?? null
  );
}

export function ensurePersonalInboxKnowledgeBase(params: {
  ownerId: string;
  tenantId?: string | null;
  storePath?: string;
}): KnowledgeBase {
  const ownerId = params.ownerId.trim();
  if (!ownerId) {
    throw new Error("ownerId required for personal inbox knowledge base");
  }
  const existing = findPersonalInboxKnowledgeBase(ownerId, params.storePath);
  if (existing) {
    return existing;
  }
  return createKnowledgeBase(
    {
      title: PERSONAL_INBOX_KB_TITLE,
      description: "个人收录默认知识库",
      ownerId,
      tenantId: params.tenantId ?? null,
      visibility: "private",
      backendKind: "personal",
      tags: [PERSONAL_INBOX_KB_TAG],
    },
    params.storePath,
  );
}

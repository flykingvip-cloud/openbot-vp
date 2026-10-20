/**
 * Authorization for personal knowledge object RPCs (versions / tags / compare).
 * Callers must not operate solely on a raw objectId without a trusted user context.
 */

import {
  getPersonalSkillAssetDetail,
  SkillAssetStoreError as SkillError,
} from "../skill-lifecycle-store.js";
import { listKnowledgeBases } from "./knowledge-base-store.js";
import { parsePersonalObjectId } from "./personal-mutations.js";

export class PersonalKnowledgeAuthError extends Error {
  readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID";

  constructor(code: PersonalKnowledgeAuthError["code"], message: string) {
    super(message);
    this.name = "PersonalKnowledgeAuthError";
    this.code = code;
  }
}

function documentIdCandidates(objectId: string, skillId: string): string[] {
  return [...new Set([objectId, skillId, `obj:personal:${skillId}`])];
}

/**
 * True when the caller's owned knowledge bases list this personal skill as a document.
 */
export function personalKnowledgeAttachedToOwner(params: {
  objectId: string;
  skillId: string;
  userId: string;
}): boolean {
  const candidates = documentIdCandidates(params.objectId, params.skillId);
  return listKnowledgeBases({ ownerId: params.userId }).some((base) =>
    base.documentIds.some((docId) => candidates.includes(docId)),
  );
}

/**
 * Authorize access to a personal knowledge object.
 * Requires authenticated userId. Ownership = ownerUserId on skill (when set)
 * or attachment to a KB owned by the caller.
 */
export function authorizePersonalKnowledgeObjectAccess(params: {
  objectId: string;
  userId: string | null | undefined;
  /** When true, only the owner may mutate. */
  requireWrite?: boolean;
}): { skillId: string } {
  const userId = params.userId?.trim() || "";
  if (!userId) {
    throw new PersonalKnowledgeAuthError(
      "UNAUTHORIZED",
      "authenticated user required for personal knowledge access",
    );
  }
  const skillId = parsePersonalObjectId(params.objectId);
  if (!skillId) {
    throw new PersonalKnowledgeAuthError("INVALID", "invalid personal knowledge objectId");
  }

  let ownerUserId: string | null = null;
  try {
    const detail = getPersonalSkillAssetDetail(skillId) as {
      ownerUserId?: string | null;
    };
    ownerUserId =
      typeof detail.ownerUserId === "string" && detail.ownerUserId.trim()
        ? detail.ownerUserId.trim()
        : null;
  } catch (error) {
    if (error instanceof SkillError) {
      throw new PersonalKnowledgeAuthError("NOT_FOUND", "personal knowledge object not found");
    }
    throw error;
  }

  if (ownerUserId) {
    if (ownerUserId !== userId) {
      throw new PersonalKnowledgeAuthError(
        "FORBIDDEN",
        "personal knowledge object is not accessible to this user",
      );
    }
    return { skillId };
  }

  // Legacy assets without ownerUserId: require KB attachment to caller's owned bases.
  if (
    personalKnowledgeAttachedToOwner({
      objectId: params.objectId,
      skillId,
      userId,
    })
  ) {
    return { skillId };
  }

  throw new PersonalKnowledgeAuthError(
    "FORBIDDEN",
    "personal knowledge object is not accessible to this user",
  );
}

export function isPersonalKnowledgeAuthError(error: unknown): error is PersonalKnowledgeAuthError {
  return error instanceof PersonalKnowledgeAuthError;
}

export type KnowledgeConsumeRef =
  | { type: "knowledge-base"; id: string }
  | { type: "knowledge-file"; id: string; parentId: string }
  | { type: "deliverable"; id: string; parentId: string }
  | { type: "folder"; id: string; parentId?: string }
  | { type: "api"; id: string; parentId?: string };

export type KnowledgeConsumePolicy = {
  allowLiveApi?: boolean;
  /** Audited callers may allow specific connectors without an explicit selection. */
  allowedApiSourceIds?: string[];
};

export type KnowledgeConsumeReceiptStatus = "consumed" | "partial" | "unavailable" | "denied";

export type KnowledgeConsumeEvidenceKind =
  | "object"
  | "original"
  | "local-index"
  | "index-chunk"
  | "live-api"
  | "derived-snapshot";

export type KnowledgeConsumeReceiptReason =
  | "not_found"
  | "not_indexed"
  | "no_match"
  | "permission_denied"
  | "ambiguous_identity"
  | "live_api_not_allowed"
  | "connector_error";

export type KnowledgeConsumeReceiptItem = {
  ref: KnowledgeConsumeRef;
  status: KnowledgeConsumeReceiptStatus;
  evidenceKind?: KnowledgeConsumeEvidenceKind;
  sourceVersion?: string;
  fetchedAt?: string;
  chunkIds?: string[];
  chars?: number;
  truncationReason?: "item-budget" | "turn-budget" | "provider-limit";
  reasonCode?: KnowledgeConsumeReceiptReason;
};

function normalizedPart(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

export function normalizeKnowledgeConsumeRef(ref: KnowledgeConsumeRef): KnowledgeConsumeRef | null {
  const id = normalizedPart(ref.id);
  if (!id) {
    return null;
  }
  if (ref.type === "knowledge-file" || ref.type === "deliverable") {
    const parentId = normalizedPart(ref.parentId);
    return parentId ? { type: ref.type, id, parentId } : null;
  }
  if (ref.type === "folder" || ref.type === "api") {
    const parentId = normalizedPart(ref.parentId);
    return { type: ref.type, id, ...(parentId ? { parentId } : {}) };
  }
  return { type: "knowledge-base", id };
}

export function knowledgeConsumeRefKey(ref: KnowledgeConsumeRef): string {
  const normalized = normalizeKnowledgeConsumeRef(ref);
  if (!normalized) {
    return "";
  }
  const encode = (value: string) => encodeURIComponent(value);
  if (normalized.type === "knowledge-base") {
    return `${normalized.type}:${encode(normalized.id)}`;
  }
  return `${normalized.type}:${encode(normalized.parentId ?? "")}:${encode(normalized.id)}`;
}

export function normalizeKnowledgeConsumeRefs(
  refs: readonly KnowledgeConsumeRef[] | undefined,
): KnowledgeConsumeRef[] {
  const byKey = new Map<string, KnowledgeConsumeRef>();
  for (const ref of refs ?? []) {
    const normalized = normalizeKnowledgeConsumeRef(ref);
    if (!normalized) {
      continue;
    }
    byKey.set(knowledgeConsumeRefKey(normalized), normalized);
  }
  return [...byKey.values()];
}

export type LegacyKnowledgeConsumeResolution =
  | { status: "resolved"; ref: KnowledgeConsumeRef }
  | { status: "not_found" }
  | { status: "ambiguous_identity" };

/**
 * Legacy bare ids may only be resolved against an authoritative catalog
 * snapshot. A collision across domains or parents fails closed.
 */
export function resolveLegacyKnowledgeConsumeRef(params: {
  id: string;
  catalogRefs: readonly KnowledgeConsumeRef[];
}): LegacyKnowledgeConsumeResolution {
  const id = normalizedPart(params.id);
  if (!id) {
    return { status: "not_found" };
  }
  const matches = normalizeKnowledgeConsumeRefs(params.catalogRefs).filter((ref) => ref.id === id);
  if (matches.length === 0) {
    return { status: "not_found" };
  }
  return matches.length === 1
    ? { status: "resolved", ref: matches[0] }
    : { status: "ambiguous_identity" };
}

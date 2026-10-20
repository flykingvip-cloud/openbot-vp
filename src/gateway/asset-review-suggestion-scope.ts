export const MAX_VISIBLE_ASSET_REVIEW_SUGGESTIONS = 3;

export type AssetReviewSuggestionScopeInput = {
  label?: string;
  fingerprint?: string;
  suggestedAssetType?: string;
};

export function isKnowledgeAssetReviewSuggestion(entry: AssetReviewSuggestionScopeInput): boolean {
  if (entry.suggestedAssetType === "knowledge") {
    return true;
  }
  const fingerprint = (entry.fingerprint ?? "").trim().toLowerCase();
  if (fingerprint === "knowledge-article" || fingerprint.startsWith("knowledge-article:")) {
    return true;
  }
  const label = (entry.label ?? "").trim();
  return label === "知识/报告产出" || /知识\s*\/\s*报告|知识收录|知识文档|上传文档/.test(label);
}

export function selectVisibleAssetReviewSuggestions<T extends AssetReviewSuggestionScopeInput>(
  entries: readonly T[],
  limit = MAX_VISIBLE_ASSET_REVIEW_SUGGESTIONS,
): T[] {
  return entries
    .filter((entry) => !isKnowledgeAssetReviewSuggestion(entry))
    .slice(0, Math.max(0, limit));
}

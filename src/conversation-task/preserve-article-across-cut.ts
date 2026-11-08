/** Compatibility exports; shared runtime context owns the projection. */
export {
  findLastPreservableArticleExtract,
  shouldPreserveArticleForIncoming,
  buildPreservedArticleSystemMessage,
  applyContextCutWithOptionalArticlePreserve,
} from "../agent-runtime/context/sources/preserved-article.js";
export type {
  PreservedArticleExtract,
  PreserveArticleOptions,
} from "../agent-runtime/context/sources/preserved-article.js";

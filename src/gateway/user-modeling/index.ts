export { userModelingEnabled, userModelingInferEnabled } from "./config.js";
export {
  detectReplyLanguage,
  detectUserPreferenceDirectives,
  deriveUserProfileDelta,
  evaluateUserProfileEffect,
  countRecurringDirectiveFriction,
  type UserInteractionSignals,
} from "./derive.js";
export { renderUserProfileInstructions, type UserProfileRenderOptions } from "./render.js";
export {
  recordUserInteractionSignalSafely,
  setUserProfileInferCallerForTests,
} from "./record-signal.js";
export {
  buildSanitizedInferSummary,
  inferUserProfileSignals,
  parseInferredUserSignals,
  type UserProfileInferCaller,
} from "./infer.js";
export {
  applyUserProfileDelta,
  DEFAULT_USER_PROFILE,
  sameUserProfileDelta,
  type UserProfile,
  type UserProfileChangeRecord,
  type UserProfileSuppression,
} from "./types.js";
export {
  extractPeerIdFromSessionKey,
  hashUserKey,
  resolveUserModelingKey,
  resolveUserModelingKeyForClient,
  resolveUserModelingKeyForReply,
  resolveUserModelingKeyFromContext,
  type UserModelingKey,
} from "./user-key.js";
export {
  applyUserInteractionSignals,
  assessAndMarkUserProfileEffect,
  readUserProfile,
  readUserProfileOrDefault,
  resetUserProfile,
  resolveUserProfileInstructions,
  resolveUserModelingDir,
  writeUserProfile,
} from "./user-profile-store.js";

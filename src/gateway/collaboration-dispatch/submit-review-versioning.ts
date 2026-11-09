/**
 * Submit / accept version rules. Implementation is the policy public entry.
 * This module does not change flag defaults.
 */
export {
  acceptanceCriteriaFullyChecked,
  assertAcceptanceProxyFields,
  boardSubmissionStateContract,
  isDuplicateSubmissionBody,
  isEmptySubmissionBody,
  isValidArtifactVersion,
  normalizeAcceptanceCriterion,
  normalizeArtifactVersion,
  normalizeSubmissionBody,
  pendingSubmissionMatches,
  s3DoesNotOpenProductionGrayWrites,
  s3DoesNotTouchLiveOrDefaultFlagsOn,
} from "../../agent-runtime/policy/index.js";

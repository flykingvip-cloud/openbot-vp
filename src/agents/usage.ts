/** Compatibility import only; one shared usage implementation. */
export {
  makeZeroUsageSnapshot,
  hasNonzeroUsage,
  normalizeUsage,
  derivePromptTokens,
  deriveSessionTotalTokens,
} from "../shared/usage.js";
export type { UsageLike, NormalizedUsage, AssistantUsageSnapshot } from "../shared/usage.js";

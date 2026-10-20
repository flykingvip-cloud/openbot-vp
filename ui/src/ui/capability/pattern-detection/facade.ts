import {
  dismissHint,
  evaluatePatternHint,
  getActiveHints,
  processIncomingHint,
  subscribeToPatternDetection,
  type PatternDetectionState,
} from "../../controllers/pattern-detection.ts";

export type PatternDetectionCapabilityState = PatternDetectionState;

export const patternDetectionCapability = {
  evaluate: evaluatePatternHint,
  process: processIncomingHint,
  dismiss: dismissHint,
  getActive: getActiveHints,
  subscribe: subscribeToPatternDetection,
} as const;

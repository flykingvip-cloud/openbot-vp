/**
 * ConversationTask Runtime — high-precision strong-signal detector (P1).
 *
 * Answers "is the user proposing a work item?". Deterministic, no Intent LLM.
 * Tuned for precision: a lone weak signal does not trip detection, so genuinely
 * fuzzy work is skipped (recall miss) rather than mis-detected. Detection never
 * activates anything; it only produces an explainable result.
 */

import { REASON, type ReasonCode } from "./reason-codes.js";
import { analyzeTurn, type TurnFeatures } from "./signals.js";
import {
  countSignals,
  type ConversationTurnInput,
  type DetectionConfidence,
  type DetectionResult,
} from "./types.js";

function hasStrongIntent(features: TurnFeatures): boolean {
  return (
    features.leadImmediateAction ||
    features.produceSendVerb ||
    features.reminderIntent ||
    features.monitorIntent ||
    features.revisionIntent ||
    features.continuationIntent ||
    features.explicitWorkflow
  );
}

function scoreConfidence(features: TurnFeatures): DetectionConfidence {
  const count = countSignals(features.signals);
  const { signals } = features;
  if (features.monitorIntent || count >= 3) {
    return "high";
  }
  if ((features.reminderIntent || features.produceSendVerb) && signals.hasFutureIntent) {
    return "high";
  }
  if (hasStrongIntent(features) || count === 2) {
    return "medium";
  }
  return "low";
}

export function detectTurn(
  input: ConversationTurnInput,
  features = analyzeTurn(input),
): DetectionResult {
  // A pure completion self-claim is not a work proposal.
  if (features.completionClaim && !features.imperativeRequest) {
    return {
      detected: false,
      signals: features.signals,
      confidence: "low",
      reasons: [REASON.MODEL_SELF_CLAIM_IGNORED, REASON.NO_STRONG_SIGNAL],
    };
  }

  const count = countSignals(features.signals);
  const detected = hasStrongIntent(features) || count >= 2;

  if (!detected) {
    return {
      detected: false,
      signals: features.signals,
      confidence: "low",
      reasons: [REASON.NO_STRONG_SIGNAL],
    };
  }

  const confidence = scoreConfidence(features);
  const reasons: ReasonCode[] = [REASON.STRONG_SIGNAL_PRESENT];
  reasons.push(
    confidence === "high"
      ? REASON.MULTI_SIGNAL_HIGH_CONFIDENCE
      : REASON.SINGLE_SIGNAL_LOW_CONFIDENCE,
  );
  return { detected: true, signals: features.signals, confidence, reasons };
}

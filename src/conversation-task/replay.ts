/**
 * ConversationTask Runtime — offline replay + shadow-only decision logging (P1).
 *
 * Runs Detection + Qualification over turns and produces a `ShadowDecisionLog`
 * per turn. It is pure and side-effect free: no task, no ledger, no agent, no
 * network. The log records reason codes, a privacy-safe fingerprint (never raw
 * text), the decision version and the result. `shadowOnly: true` makes a log
 * type-incapable of being reused as a real activation.
 *
 * Flag gating mirrors production shape without production behavior: when the
 * `detection` flag is OFF, replay yields no decision (flag-off == unchanged).
 */

import { detectTurn } from "./detector.js";
import { readConversationTaskFlags, type ConversationTaskFlags } from "./feature.js";
import { resolveAuthorization } from "./invariants.js";
import { qualifyTurn } from "./qualification.js";
import type { ReasonCode } from "./reason-codes.js";
import { analyzeTurn } from "./signals.js";
import { CONVERSATION_TASK_DECISION_VERSION } from "./types.js";
import type {
  AuthorizationState,
  ConversationTurnInput,
  DetectionResult,
  QualificationResult,
  ShadowDecisionLog,
  SideEffectClass,
} from "./types.js";

export type ShadowDecision = {
  messageId: string;
  detection: DetectionResult;
  qualification: QualificationResult;
  sideEffect: SideEffectClass;
  authorization: AuthorizationState;
  log: ShadowDecisionLog;
};

/**
 * Stable, non-reversible FNV-1a fingerprint of the input text. This is a coarse
 * privacy guard for shadow logs (not a cryptographic commitment); a keyed hash
 * is deferred to P2 when logs may leave the process.
 */
export function fingerprintText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fp_${hash.toString(16).padStart(8, "0")}`;
}

function uniqueReasons(reasons: readonly ReasonCode[]): ReasonCode[] {
  return [...new Set(reasons)];
}

/**
 * Evaluate a single turn in shadow mode. Deterministic: `atMs` defaults to 0 so
 * replays are byte-stable. Authorization is computed fail-closed with no grant
 * (shadow never authorizes a side effect).
 */
export function evaluateTurn(input: ConversationTurnInput, atMs = 0): ShadowDecision {
  const features = analyzeTurn(input);
  const detection = detectTurn(input, features);
  const qualification = qualifyTurn(input, features);
  const sideEffect = features.sideEffect;
  const authorization = resolveAuthorization(sideEffect, false);
  const reasonCodes = uniqueReasons([
    ...(detection.reasons as readonly ReasonCode[]),
    ...(qualification.reasons as readonly ReasonCode[]),
  ]);
  const log: ShadowDecisionLog = {
    shadowOnly: true,
    decisionVersion: CONVERSATION_TASK_DECISION_VERSION,
    inputFingerprint: fingerprintText(input.text),
    detected: detection.detected,
    confidence: detection.confidence,
    qualification: qualification.kind,
    signals: detection.signals,
    sideEffect,
    authorization,
    reasonCodes,
    atMs,
  };
  return { messageId: input.messageId, detection, qualification, sideEffect, authorization, log };
}

/**
 * Flag-gated evaluation. Returns null when detection is disabled — the flag-off
 * path that keeps existing Chat/Cron behavior unchanged.
 */
export function evaluateTurnGated(
  input: ConversationTurnInput,
  flags: ConversationTaskFlags = readConversationTaskFlags(),
  atMs = 0,
): ShadowDecision | null {
  if (!flags.detection) {
    return null;
  }
  return evaluateTurn(input, atMs);
}

/** Replay a batch of turns (pure map). */
export function replayTurns(inputs: readonly ConversationTurnInput[]): ShadowDecision[] {
  return inputs.map((input) => evaluateTurn(input));
}

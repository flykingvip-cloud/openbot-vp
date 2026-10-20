import { scanForbiddenSubstrings } from "./digest.js";
import { isEmptyEnvelope } from "./envelope.js";
import {
  confidenceOf,
  isLowConfidence,
  scoreSkillCandidates,
  scoreToolCandidates,
} from "./score.js";
import {
  PHASE1_FLAGS,
  type CatalogEntry,
  type ShadowDecision,
  type ShadowTaskEnvelope,
} from "./types.js";

export function decideShadowRoute(params: {
  envelope: ShadowTaskEnvelope;
  eligibleSkills: readonly CatalogEntry[];
  constructedTools: readonly CatalogEntry[];
}): ShadowDecision {
  const privacyHits = scanForbiddenSubstrings(JSON.stringify(params));
  if (privacyHits.length > 0) {
    throw new Error(`privacy hits: ${privacyHits.join(",")}`);
  }
  const skillCandidates = scoreSkillCandidates(params.envelope, params.eligibleSkills);
  const toolCandidates = scoreToolCandidates(params.envelope, params.constructedTools);
  if (isEmptyEnvelope(params.envelope)) {
    return {
      apply: false,
      reasonCode: "EMPTY_ENVELOPE_FALLBACK",
      confidence: 0,
      skillCandidates,
      toolCandidates,
    };
  }
  if (params.eligibleSkills.length === 0 && params.constructedTools.length === 0) {
    return {
      apply: false,
      reasonCode: "LOW_CONFIDENCE_FALLBACK_FULL_PATH",
      confidence: 0,
      skillCandidates,
      toolCandidates,
    };
  }
  const confidence = Math.min(confidenceOf(skillCandidates), confidenceOf(toolCandidates));
  if (isLowConfidence(skillCandidates) || isLowConfidence(toolCandidates) || confidence < 0.55) {
    return {
      apply: false,
      reasonCode: "LOW_CONFIDENCE_FALLBACK_FULL_PATH",
      confidence,
      skillCandidates,
      toolCandidates,
    };
  }
  return {
    apply: false,
    reasonCode: PHASE1_FLAGS.SHADOW_ROUTER_RECORD
      ? "SHADOW_CANDIDATES_RECORDED"
      : "SHADOW_DISABLED",
    confidence,
    skillCandidates,
    toolCandidates,
  };
}

export function assertImplementationClosed(decision: ShadowDecision): void {
  if (decision.apply) {
    throw new Error("shadow apply is forbidden in the I1 compute core");
  }
  if (PHASE1_FLAGS.SKILL_TOP_K_ENABLED || PHASE1_FLAGS.TOOL_TOP_K_ENABLED) {
    throw new Error("Top-K live flags must stay false");
  }
  if (PHASE1_FLAGS.ORCHESTRATION_LIVE_INVOKE || PHASE1_FLAGS.DAG_ENABLED) {
    throw new Error("live orchestration flags must stay false");
  }
  if (PHASE1_FLAGS.CONVERSATION_TASK_ENABLED || PHASE1_FLAGS.SHADOW_ROUTER_APPLY) {
    throw new Error("apply/ConversationTask flags must stay false");
  }
  if (PHASE1_FLAGS.SHADOW_ROUTER_RECORD) {
    throw new Error("shadow record must stay false in I1");
  }
}

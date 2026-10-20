import { scanForbiddenSubstrings } from "./digest.ts";
import { confidenceOf, rankCandidates } from "./score.ts";
import {
  PHASE1_FLAGS,
  type CatalogEntry,
  type ShadowDecision,
  type TaskEnvelope,
} from "./types.ts";

export function isEmptyEnvelope(envelope: TaskEnvelope): boolean {
  return envelope.taskClass === "unknown" && envelope.riskClass === "unknown";
}

export function decideShadowRoute(params: {
  envelope: TaskEnvelope;
  eligibleSkills: CatalogEntry[];
  constructedTools: CatalogEntry[];
}): ShadowDecision {
  const privacyHits = scanForbiddenSubstrings(JSON.stringify(params));
  if (privacyHits.length > 0) {
    throw new Error(`privacy hits: ${privacyHits.join(",")}`);
  }
  const skillCandidates = rankCandidates(params.envelope, params.eligibleSkills, "skill");
  const toolCandidates = rankCandidates(params.envelope, params.constructedTools, "tool");
  const confidence = Math.min(confidenceOf(skillCandidates), confidenceOf(toolCandidates));
  if (isEmptyEnvelope(params.envelope)) {
    return {
      apply: false,
      reasonCode: "EMPTY_ENVELOPE_FALLBACK",
      confidence: 0,
      skillCandidates,
      toolCandidates,
    };
  }
  if (confidence < 0.55) {
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
    throw new Error("shadow apply is forbidden in this design package");
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
}

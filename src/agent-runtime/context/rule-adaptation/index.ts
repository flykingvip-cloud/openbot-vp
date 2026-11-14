/**
 * Context assembly for the P2 read-only rule-adaptation shadow agent:
 * versioned system prompt and filtering of the host-provided limited view.
 */
export {
  buildShadowSystemPrompt,
  SHADOW_AGENT_PROMPT_IDENTITY,
  SHADOW_SYSTEM_PROMPT,
} from "./prompt.js";
export {
  canReadHostView,
  detectProtocolOverride,
  filterEffectivePolicyView,
  findLimitedRuleById,
  isReadToolEnabled,
  matchesLimitedRuleFilter,
  searchLimitedRules,
  wrapUntrustedMaterial,
} from "./materials.js";

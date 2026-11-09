/**
 * Policy identity host. Freeze and provenance hash live in agent-runtime policy.
 */
export {
  POLICY_COMPILER_REVISION,
  deepFreeze,
  hashProvenanceAndClamps,
} from "../../agent-runtime/policy/index.js";
export type { DeepReadonly, FrozenEffectivePolicy } from "../../agent-runtime/policy/index.js";

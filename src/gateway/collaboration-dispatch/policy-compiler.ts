/**
 * Collaboration policy compiler host.
 * The algorithm lives in agent-runtime policy. This module re-exports it.
 */
export {
  compileEffectiveCollaborationPolicy,
  groupPolicyInputFromOperatingState,
  L1_DEFAULT,
} from "../../agent-runtime/policy/index.js";

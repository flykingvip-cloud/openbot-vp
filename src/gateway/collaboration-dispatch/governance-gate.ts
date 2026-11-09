/**
 * Governance gate. The decision is policy; this file does not load config or write state.
 */
export {
  classifyGovernanceActor,
  evaluateGovernanceGate,
} from "../../agent-runtime/policy/index.js";
export type {
  GovernanceActor,
  GovernanceActorType,
  GovernanceGateAction,
  GovernanceGateResult,
  GovernanceMemberRoleLike,
} from "../../agent-runtime/policy/index.js";

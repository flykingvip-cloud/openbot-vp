/**
 * Compatibility re-exports. Wake selection and slot caps live in the policy public entry.
 * Transcript copy stays in context. This file does not claim, write a board, or wake a host.
 */
export { formatDroppedParkedTaskSentence } from "../agent-runtime/context/task-focus.js";
export {
  decideWake,
  evaluateWakeEligibility,
  HEARTBEAT_FORBIDDEN_ACTIONS,
  isHeartbeatActionAllowed,
  MAX_FOCUS_SLOTS,
  MAX_PARKED_SLOTS,
  WAKE_REASONS,
} from "../agent-runtime/policy/index.js";
export type {
  FocusDecision,
  FocusSnapshot,
  HeartbeatForbiddenAction,
  WakeEligibility,
  WakeReason,
} from "../agent-runtime/policy/index.js";

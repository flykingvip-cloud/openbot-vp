/** Policy returns classifications; callers own probes and runtime effects. */
export {
  BLOCKER_GRADES,
  gradeBlocker,
  isSidePathLabel,
  assistantRestopsCleared,
  isMainlineBlockNarrative,
} from "./blocker.js";
export type { BlockerGrade, EnvProbe } from "./blocker.js";

export { isLiveTaskBinding, isTaskTombstoned } from "./task-binding.js";

export {
  MAX_PARKED_TASKS,
  TASK_BOARD_CONTINUE_MAX_PER_TASK,
  TASK_BOARD_CONTINUE_COOLDOWN_MS,
} from "./task-board-limits.js";

export {
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
  resolveContextWindowInfo,
  evaluateContextWindowGuard,
} from "./context-window.js";
export type {
  ContextWindowSource,
  ContextWindowInfo,
  ContextWindowGuardResult,
} from "./context-window.js";

export {
  OVERLOAD_FAILOVER_BACKOFF_POLICY,
  MAX_OVERFLOW_COMPACTION_ATTEMPTS,
  resolveMaxRunRetryIterations,
} from "./run-limits.js";

export { resolvePromptModeForSession } from "./prompt-mode.js";

export {
  RULE_CATALOG_INVENTORY_BASELINE,
  getRuntimeRuleDeclaration,
  listRuntimeRuleDeclarations,
} from "./catalog.js";
export {
  parseExplicitTaskControl,
  shouldTaskParkAbortInFlight,
  WAKE_REASONS,
  HEARTBEAT_FORBIDDEN_ACTIONS,
  isHeartbeatActionAllowed,
  evaluateWakeEligibility,
} from "./explicit-task-control.js";
export type {
  WakeReason,
  HeartbeatForbiddenAction,
  WakeEligibility,
} from "./explicit-task-control.js";

export { normalizeConstraintEntries, activeConstraintTexts } from "./constraints.js";

export { stripInboundStamp } from "./input-stamp.js";
export { parseTaskAcceptanceChecks } from "./acceptance-checks.js";

export { resolveExecutionQueueAction } from "./execution-queue.js";
export { isRecoverableInteractionSourceError } from "./interaction-availability.js";

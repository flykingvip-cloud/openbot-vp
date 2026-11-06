/** Policy returns classifications; callers own probes and runtime effects. */
export {
  BLOCKER_GRADES,
  gradeBlocker,
  isSidePathLabel,
  assistantRestopsCleared,
  isMainlineBlockNarrative,
} from "./blocker.js";
export type { BlockerGrade, EnvProbe } from "./blocker.js";

export { isLiveTaskBinding } from "./task-binding.js";

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

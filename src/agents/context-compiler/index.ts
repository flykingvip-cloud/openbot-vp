export { isContextCompilerEnabled } from "./flag.js";
export { compileModelContext, COMPILED_CONTEXT_CAPSULE_MARKER } from "./compile.js";
export { loadContextCandidates } from "./candidates.js";
export {
  createContextCompileState,
  installContextCompilerTransform,
  simulatePiModelBoundary,
  wrapContextCompilerModelBoundary,
} from "../../agent-runtime/capabilities/index.js";
export { resolveContextLane, resolveLaneBudget } from "./lane-budget.js";
export {
  applyPreferenceMutation,
  extractHighConfidencePreferenceMutation,
} from "./preference-mutation.js";
export { groupContextUnits } from "./atomic-units.js";
export { contextCompileTelemetryExtra } from "./telemetry.js";
export type {
  CompileContextResult,
  ContextCandidates,
  ContextCompileTelemetry,
  ContextLane,
  MemoryProfileEntry,
} from "./types.js";

export {
  buildStableGroupTaskSummaryText,
  isGroupTaskStableSummaryEnabled,
  selectStableGroupTask,
} from "./group-task-stable-summary.js";
export {
  isCollaborationCollabCompileStrategyEnabled,
  shouldApplyCollabCompileStrategy,
  resolveCollabGroupMaxRecentTurns,
  COLLAB_GROUP_MAX_RECENT_TURNS,
} from "./collab-compile-strategy.js";
export type { CollabCompileStrategyParams } from "./types.js";

/** Shared model-context projection and compilation. Source I/O remains host owned. */
export {
  selectSystemContextParts,
  appendSystemContextPart,
  finalizeSystemContext,
} from "./assembly.js";
export { compileModelContext, COMPILED_CONTEXT_CAPSULE_MARKER } from "./compilation/compile.js";
export { normalizeCompiledMessages } from "./compilation/normalize-outbound.js";
export { resolveContextLane, resolveLaneBudget } from "./compilation/lane-budget.js";
export { groupContextUnits } from "./compilation/atomic-units.js";
export {
  isCollaborationCollabCompileStrategyEnabled,
  shouldApplyCollabCompileStrategy,
  resolveCollabGroupMaxRecentTurns,
  COLLAB_GROUP_MAX_RECENT_TURNS,
} from "./compilation/collab-compile-strategy.js";
export type {
  CompileContextResult,
  ContextCandidates,
  ContextCompileTelemetry,
  ContextLane,
  MemoryProfileEntry,
  CollabCompileStrategyParams,
} from "../contracts/context.js";

export { renderRunSkillContext } from "./sources/run-skills.js";

export {
  composeSystemPromptWithHookContext,
  prependSystemPromptAddition,
} from "./prompt-composition.js";

export { summarizeSessionContext } from "./session-summary.js";

export { buildResumePrompt, sanitizeTaskBoardPathForPrompt } from "./sources/task-resume.js";

/** Shared model-context projection and compilation. Source I/O remains host owned. */
export {
  assembleIndividual,
  assembleCollaborationMember,
  appendSharedTurnContext,
  selectSystemContextParts,
  appendSystemContextPart,
  finalizeSystemContext,
} from "./assembly.js";
export {
  selectContextCatalog,
  INDIVIDUAL_FORBIDDEN_GROUP_MATERIALS,
} from "./catalog/select-catalog.js";
export type { ContextCatalogName } from "./catalog/select-catalog.js";
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
export { buildTaskBoardContext } from "./sources/task-board-context.js";

export { renderIdentityBootstrapGuard } from "./sources/identity-bootstrap.js";

export { omitTaskStatusSeparators, omitParkedPriorTurns } from "./sources/task-history.js";

export { appendUntrustedContext } from "./untrusted.js";
export { projectInteractionHistory } from "./interaction-history.js";
export { renderConversationPeerContext } from "./sources/conversation-peers.js";
export {
  ASIDE_NORMAL_REPLY_CONTEXT_MAX_CHARS,
  ASIDE_DIALOGUE_HISTORY_TURN_CAP,
  selectAsideTurnsWithinCharBudget,
  type AsideDialogueTurn,
} from "./aside-budget.js";
export { renderCollaborationMission } from "./sources/collaboration-mission.js";
export { mergeRecall, renderLearningRecallPrompt } from "./sources/learning-recall.js";

export { renderAgentSystemPrompt, buildRuntimeLine, type PromptMode } from "./system-prompt.js";

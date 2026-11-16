/**
 * Orchestration Plane — public surface (P4.5 dormant).
 *
 * Dispatcher contract between ConversationTask (identity) and Progress Ledger
 * (facts). `considerDispatch` does not activate a CTR task, write a ledger,
 * invoke web_search / web_fetch / browser / nodes / system.run / sessions_spawn,
 * or change chat.send while the four orchestration flags stay OFF.
 * complex-task-loop.ts may append a visible four-step report only when
 * dispatch is on, the tenant is allowlisted, and the utterance kind is
 * stepped. That path defaults closed and does not invoke tools.
 * `considerReadonlyInvoke` is a separate path (`OPENBOT_ORCH_READONLY_INVOKE`)
 * for memory, skill snapshot read, and web_read only. That env flag is on
 * by default when unset or empty; set it to 0/false/no/off to disable.
 * This default is independent of the four orchestration flags above, which
 * stay default-off. It does not flip `ORCHESTRATION_LIVE_INVOKE` and
 * chat.send does not call it.
 *
 * Existing tool symbols: web_read, browser, node_fs_read, and node_exec
 * are bound by name only (P4.5d/e/f grayscale, no execute). sessions_spawn
 * stays unbound. A later invoke PR may call these factories — not this one:
 *   createWebSearchTool, createWebFetchTool, createBrowserTool,
 *   createNodesTool, listNodes, system.run, createSessionsSpawnTool,
 *   src/agents/skills.ts (SkillEntry — recipe, not agent).
 *
 * Production enable of orchestration/node/browser = NOT APPROVED.
 * CTR activation remains NOT APPROVED.
 */

export {
  CAPABILITY_LADDER,
  EXECUTION_SURFACES,
  ORCHESTRATION_LIVE_INVOKE,
  PERSONAL_SUBAGENT_MAX_DEPTH,
  emptyOrchestrationFlags,
  isCapabilitySurface,
  ladderIndex,
  shadowOrchestrationFlags,
} from "./types.js";
export type {
  ExecutionSurface,
  NodeInventory,
  OrchestrationFlags,
  OrchestratorJob,
  PathKind,
  PersonalSubagentBinding,
  RouteStepInput,
  StepIntent,
  SurfaceDecision,
  SurfaceDecisionKind,
} from "./types.js";

export { ORCH_REASON, ALL_ORCH_REASON_CODES, isOrchReasonCode } from "./reason-codes.js";
export type { OrchReasonCode } from "./reason-codes.js";

export {
  ORCHESTRATION_ENV,
  ORCHESTRATION_FLAG_NAMES,
  isConversationTaskActivationEnabled,
  isDispatchPermitted,
  ORCH_READONLY_INVOKE_ENV,
  isOrchestrationDormant,
  isOrchestrationEnabledByFlags,
  isOrchestrationFlagEnabled,
  isReadonlyInvokeEnabled,
  readOrchestrationFlags,
} from "./feature.js";
export type { OrchestrationFlag } from "./feature.js";

export { OrchestrationInvariantError } from "./errors.js";
export {
  assertActivationIsNotOrchestrationEnable,
  assertDispatchCannotForceGatedSurface,
  assertDormantIsIdle,
  assertGrayscaleBindingDoesNotInvoke,
  assertLedgerBridgeHonorsI1,
  assertMasterSwitchesHonored,
  assertNeverInvoke,
  assertNoMissionKind,
  assertNoSkipAhead,
  assertNodeBindingNotOnTask,
  assertPersonalSubagentIsNotMission,
  assertSandboxIsNotNode,
  assertSkillExpandIsNotEvidence,
} from "./invariants.js";
export type { OrchestrationInvariantId } from "./invariants.js";

export { routeStep } from "./surface-router.js";
export {
  considerDispatch,
  considerDispatchFromEnv,
  considerReadonlyInvoke,
  getLastOrchShadowObservation,
  resetOrchShadowObservation,
} from "./dispatch.js";
export { observeOrchestrationConsider } from "./gateway-hook.js";
export type { OrchestrationObserveInput } from "./gateway-hook.js";
export type {
  DispatchInput,
  DispatchResult,
  OrchShadowObservation,
  ReadonlyInvokeInput,
  ReadonlyInvokeResult,
} from "./dispatch.js";

export {
  ackLedgerIntent,
  assertLedgerBridgeOutput,
  isForbiddenLedgerEvidence,
  toolResultLedgerIntent,
} from "./ledger-bridge.js";
export type { OrchestratorLedgerIntent } from "./ledger-bridge.js";

export {
  LRC_GOLD_QUALIFICATION,
  buildRouterSimProbes,
  buildSampleRouterSimProbes,
  evaluateRouterSim,
  isAuthSideEffect,
  listLongRunningCandidateSamples,
  offlineRouterFlags,
  scoreRouterDecision,
  sideEffectRouteIntent,
} from "./router-sim-metrics.js";
export type {
  RouterSimExpectation,
  RouterSimProbe,
  RouterSimProbeId,
  RouterSimProbeResult,
  RouterSimReport,
  RouterSimScoreKind,
} from "./router-sim-metrics.js";

export {
  LEDGER_I7_DEFINED_IN_INVARIANTS,
  fakeLedgerIntentCases,
  proveLedgerBridgeFakeEvents,
} from "./ledger-bridge-fake-events.js";
export type {
  FakeIntentCase,
  FakeIntentVerdict,
  LedgerBridgeFakeEventProof,
} from "./ledger-bridge-fake-events.js";

export { bindSkillToStepDraft } from "./skill-binder.js";
export type { SkillBoundStepDraft } from "./skill-binder.js";

export {
  BROWSER_FACTORY_SYMBOLS,
  BROWSER_TOOL_BINDINGS,
  BROWSER_TOOL_NAMES,
  DORMANT_GRAYSCALE_SURFACES,
  NODE_COMMAND_SYMBOLS,
  NODE_EXEC_TOOL_BINDINGS,
  NODE_FACTORY_SYMBOLS,
  NODE_FS_READ_TOOL_BINDINGS,
  NODE_TOOL_NAMES,
  WEB_READ_FACTORY_SYMBOLS,
  WEB_READ_TOOL_BINDINGS,
  WEB_READ_TOOL_NAMES,
  bindSurfaceTools,
  isDormantGrayscaleSurface,
} from "./surface-binding.js";
export type {
  BrowserFactorySymbol,
  BrowserToolName,
  DormantGrayscaleSurface,
  NodeCommandSymbol,
  NodeFactorySymbol,
  NodeToolName,
  SurfaceToolBinding,
  WebReadFactorySymbol,
  WebReadToolName,
} from "./surface-binding.js";

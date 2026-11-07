/** One capability invocation boundary. Existing adapters retain tool implementations. */
export {
  runBeforeToolCallHook,
  wrapToolWithBeforeToolCallHook,
  isToolWrappedWithBeforeToolCallHook,
  consumeAdjustedParamsForToolCall,
  __testing,
} from "./invocation/before-call.js";
export type { HookContext } from "./invocation/before-call.js";
export { declareCapability } from "./catalog.js";
export type { CapabilityDeclaration } from "../contracts/capability.js";

export { resolvePromptBuildHookResult } from "./adapters/prompt-build-hooks.js";

export { resolveModelHookResult } from "./adapters/model-resolve-hooks.js";

export {
  enforceProtocolTextNonExecutionInMessage,
  wrapStreamFnEnforceProtocolTextNonExecution,
} from "./adapters/protocol-body-boundary.js";
export type {
  ProtocolBodyBoundaryResult,
  EnforceProtocolTextContext,
} from "./adapters/protocol-body-boundary.js";

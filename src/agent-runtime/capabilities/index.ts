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

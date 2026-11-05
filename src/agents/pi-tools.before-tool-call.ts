/** Compatibility export only; invocation has one implementation in runtime capabilities. */
export {
  runBeforeToolCallHook,
  wrapToolWithBeforeToolCallHook,
  isToolWrappedWithBeforeToolCallHook,
  consumeAdjustedParamsForToolCall,
  __testing,
} from "../agent-runtime/capabilities/index.js";
export type { HookContext } from "../agent-runtime/capabilities/index.js";

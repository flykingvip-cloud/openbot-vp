import {
  createUnifiedExecutionLifecycle,
  type UnifiedCommandLifecycleOptions,
} from "./unified-lifecycle.js";

/** @deprecated Use `createUnifiedExecutionLifecycle({ mode: "command", ...params })`. */
export function createCommandExecutionLifecycle(
  params: Omit<UnifiedCommandLifecycleOptions, "mode">,
) {
  return createUnifiedExecutionLifecycle({ mode: "command", ...params });
}

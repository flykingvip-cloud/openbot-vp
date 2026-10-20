import { syncExecutableAssetBinding } from "../executable-asset-binding/sync.js";
import { registerSkillRelationMutationHook } from "../skill-lifecycle-store.js";
import { syncSkillExecutionBinding } from "./sync.js";

let unregister: (() => void) | null = null;

/**
 * Register the store mutation → materialisation bridge once.
 * Safe to call multiple times (idempotent).
 */
export function ensureSkillExecutionBindingHooksRegistered(): void {
  if (unregister) {
    return;
  }
  unregister = registerSkillRelationMutationHook((event) => {
    const projection = syncSkillExecutionBinding({
      agentId: event.agentId,
      skillId: event.skillId,
    });
    try {
      // MCP side effect is not a D5 layer. A failure here must not drop the projection result.
      syncExecutableAssetBinding({
        skillId: event.skillId,
        op: event.op,
        agentId: event.agentId,
      });
    } catch {
      // ignored: projection result is the value the install RPC keeps
    }
    return { projection };
  });
}

/** Test-only: drop hooks so suites start clean. */
export function resetSkillExecutionBindingHooksForTests(): void {
  unregister?.();
  unregister = null;
}

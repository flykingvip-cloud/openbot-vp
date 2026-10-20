import { defaultShadowStoreRoot } from "../conversation-task/runtime-bootstrap.js";
import { openTaskStore } from "../conversation-task/store.js";
import { normalizeConversationTaskIdRef } from "./wake-identity.js";

/**
 * Read-only lookup of a bound ConversationTask goal (EA-I1 / EA-B4).
 * Never creates a ConversationTask and does not require activation to be ON.
 */
export function readBoundConversationTaskGoal(params: {
  tenantId?: string | null;
  conversationTaskId?: string | null;
}): string | undefined {
  const taskId = normalizeConversationTaskIdRef(params.conversationTaskId ?? undefined);
  const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : "";
  if (!taskId || !tenantId) {
    return undefined;
  }
  try {
    const store = openTaskStore({
      tenantId,
      storeRoot: defaultShadowStoreRoot(),
    });
    try {
      const matches = store
        .findTasksByTaskKey(taskId)
        .filter((task) => task.lifecycle === "active" || task.lifecycle === "draft");
      const task = matches.at(-1);
      const goal = task?.goal.trim();
      return goal || undefined;
    } finally {
      store.close();
    }
  } catch {
    return undefined;
  }
}

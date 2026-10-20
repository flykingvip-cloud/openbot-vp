/**
 * Inject authoritative ConversationTask focus into chat agent runs.
 */

import { buildTaskFocusPromptSection, resolveCronTaskFocus } from "../cron/task-focus.js";
import { readConversationTaskFlags } from "./feature.js";
import { resolveActivationTenantId } from "./gateway-activation-hook.js";
import { defaultShadowStoreRoot } from "./runtime-bootstrap.js";
import { openTaskStore } from "./store.js";

export function buildActiveConversationTaskFocusPrompt(params: {
  tenantId?: string | null;
  requesterId?: string | null;
  conversationId?: string | null;
}): string | undefined {
  try {
    const flags = readConversationTaskFlags();
    if (!flags.activation) {
      return undefined;
    }
    const requesterId = typeof params.requesterId === "string" ? params.requesterId.trim() : "";
    const conversationId =
      typeof params.conversationId === "string" ? params.conversationId.trim() : "";
    if (!requesterId || !conversationId) {
      return undefined;
    }
    const tenantId = resolveActivationTenantId(params.tenantId, requesterId);
    if (!tenantId) {
      return undefined;
    }
    const store = openTaskStore({
      tenantId,
      storeRoot: defaultShadowStoreRoot(),
    });
    try {
      const active = store
        .findActiveTasksByConversation(conversationId)
        .filter((task) => task.requesterId === requesterId || task.ownerId === requesterId)
        .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs);
      const task = active[0];
      if (!task) {
        return undefined;
      }
      const focus = resolveCronTaskFocus({
        message: task.goal,
        meta: { goal: task.goal, acceptanceRules: [] },
        conversationTaskId: task.taskKey,
        conversationTaskGoal: task.goal,
      });
      return buildTaskFocusPromptSection(focus);
    } finally {
      store.close();
    }
  } catch {
    return undefined;
  }
}

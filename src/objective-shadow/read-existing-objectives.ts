/**
 * Read-only lookups of already-persisted structured Objective keys.
 * Never writes ConversationTask / SharedTask / Ledger. Fail-closed to [].
 */

import { resolveDataRoot } from "../config/data-space.js";
import { openTaskStore } from "../conversation-task/store.js";
import { getSharedTaskContextStore } from "../conversations/shared-task-context.js";
import { extractConversationIdFromSessionKey } from "../conversations/shared-task-runtime.js";
import { conversationTaskCandidate, sharedTaskCandidate } from "./candidates.js";
import type { ShadowCandidate } from "./types.js";

export const OBJECTIVE_SHADOW_CT_STORE_ENV = "OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_CT_STORE";

export function readConversationTaskCandidates(params: {
  tenantId?: string | null;
  conversationId?: string | null;
  storeRoot?: string;
}): ShadowCandidate[] {
  const tenantId = params.tenantId?.trim() ?? "";
  const conversationId = params.conversationId?.trim() ?? "";
  if (!tenantId || !conversationId) {
    return [];
  }
  try {
    const storeRoot =
      params.storeRoot?.trim() || process.env[OBJECTIVE_SHADOW_CT_STORE_ENV]?.trim() || undefined;
    const store = openTaskStore({
      tenantId,
      ...(storeRoot ? { storeRoot } : {}),
    });
    try {
      return store
        .findActiveTasksByConversation(conversationId)
        .map((task) =>
          conversationTaskCandidate({
            taskKey: task.taskKey,
            activationEpoch: task.activationEpoch,
          }),
        )
        .filter((candidate): candidate is ShadowCandidate => candidate !== null);
    } finally {
      store.close();
    }
  } catch {
    return [];
  }
}

export async function readSharedTaskCandidates(params: {
  sessionKey?: string | null;
  groupId?: string | null;
  conversationId?: string | null;
  dataRoot?: string;
}): Promise<ShadowCandidate[]> {
  const groupId = params.groupId?.trim() ?? "";
  if (!groupId) {
    return [];
  }
  try {
    const conversationId =
      params.conversationId?.trim() || extractConversationIdFromSessionKey(params.sessionKey) || "";
    if (!conversationId) {
      return [];
    }
    const store = getSharedTaskContextStore(params.dataRoot ?? resolveDataRoot(undefined));
    const context = await store.get(groupId, conversationId);
    if (!context) {
      return [];
    }
    const candidate = sharedTaskCandidate({
      conversationId: context.conversationId,
      revision: context.revision,
    });
    return candidate ? [candidate] : [];
  } catch {
    return [];
  }
}

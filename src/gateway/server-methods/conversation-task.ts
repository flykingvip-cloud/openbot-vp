import {
  LOCAL_ACTIVATION_TENANT_ID,
  resolveActivationTenantId,
} from "../../conversation-task/gateway-activation-hook.js";
import { readConversationTaskProgressView } from "../../conversation-task/ledger-binding.js";
import { defaultShadowStoreRoot } from "../../conversation-task/runtime-bootstrap.js";
import { openTaskStore } from "../../conversation-task/store.js";
import type { ProgressView } from "../../progress-ledger/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveTrustedAttribution } from "../scope-attribution.js";
import type { GatewayRequestHandlers } from "./types.js";

export type ConversationTaskProgressEntry = {
  taskId: string;
  sourceMessageId: string;
  goal: string;
  lifecycle: string;
  progress: ProgressView | null;
};

async function loadActiveConversationTaskEntries(params: {
  conversationId: string;
  requesterId: string;
  tenantId: string;
  cronStorePath?: string;
}): Promise<ConversationTaskProgressEntry[]> {
  const store = openTaskStore({
    tenantId: params.tenantId,
    storeRoot: defaultShadowStoreRoot(),
  });
  try {
    const tasks = store
      .findActiveTasksByConversation(params.conversationId)
      .filter(
        (task) => task.requesterId === params.requesterId || task.ownerId === params.requesterId,
      );
    const entries: ConversationTaskProgressEntry[] = [];
    for (const task of tasks) {
      const progress = await readConversationTaskProgressView({
        task,
        cronStorePath: params.cronStorePath,
      });
      if (!progress || !progress.emitToChat) {
        continue;
      }
      entries.push({
        taskId: String(task.id),
        sourceMessageId: task.sourceMessageId,
        goal: task.goal,
        lifecycle: task.lifecycle,
        progress,
      });
    }
    return entries;
  } finally {
    store.close();
  }
}

export const conversationTaskHandlers: GatewayRequestHandlers = {
  /**
   * Owner-scoped read of active ConversationTasks + Progress Ledger projections
   * for one conversation. Never writes. Missing tasks / ledger-off return empty
   * arrays so inline chat progress stays hidden.
   */
  "conversation-task.active.get": async ({ params, respond, context, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const conversationId =
      typeof (record as { conversationId?: unknown }).conversationId === "string"
        ? (record as { conversationId: string }).conversationId.trim()
        : "";
    if (!conversationId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "conversationId is required"),
      );
      return;
    }
    try {
      const attribution = await resolveTrustedAttribution(client);
      const requesterId = attribution.ownerId?.trim() ?? "";
      if (!requesterId) {
        respond(true, { task: null, progress: null, tasks: [] });
        return;
      }
      const tenantId =
        resolveActivationTenantId(attribution.tenantId, requesterId) ?? LOCAL_ACTIVATION_TENANT_ID;
      const tasks = await loadActiveConversationTaskEntries({
        conversationId,
        requesterId,
        tenantId,
        cronStorePath: context.cronStorePath,
      });
      const primary = tasks[0] ?? null;
      respond(true, {
        task: primary
          ? {
              id: primary.taskId,
              conversationId,
              goal: primary.goal,
              lifecycle: primary.lifecycle,
              sourceMessageId: primary.sourceMessageId,
            }
          : null,
        progress: primary?.progress ?? null,
        tasks,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to read conversation task progress";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
};

/**
 * Group Notification Service
 *
 * Delivers system notifications to collaboration group sessions via the gateway's
 * real-time event infrastructure. When a bot has an active group session, notifications
 * are pushed to all UI subscribers of that session.
 *
 * Architecture:
 * - Real-time: nodeSendToSession → pushed to connected UIs (if any subscriber online)
 * - Persistent: shareAttribution records in SkillAssetStore (queried via shareHistory API)
 * - Graceful: if no subscriber is online, the notification is silently dropped; users see
 *   the share record next time they open the asset detail or group workspace.
 */

import { randomUUID } from "node:crypto";
import { prefixSystemMessage } from "../infra/system-message.js";

/** Delivery target resolved from group + bot context. */
export type NotificationDeliveryTarget = {
  sessionKey: string;
  botId: string;
};

/** Options for resolving notification delivery. */
export type NotificationDeliveryOptions = {
  /** The collaboration group to notify. */
  groupId: string;
  /** Bot ID to resolve the group session key (typically the asset's source robot). */
  botId?: string | null;
  /** Gateway context's session-send function. Pass context.nodeSendToSession from the handler. */
  nodeSendToSession?: ((sessionKey: string, event: string, payload: unknown) => void) | null;
  /** Build session key override (for testing). */
  buildSessionKey?: (botId: string, groupId: string) => string;
};

export type GroupNotificationParams = {
  groupId: string;
  message: string;
  metadata?: {
    type: "asset_shared" | "asset_updated" | "member_joined" | "system_announcement";
    relatedResourceId?: string;
    actionBy?: string;
  };
  /** Delivery options for real-time push. Without these, falls back to log-only. */
  delivery?: NotificationDeliveryOptions;
};

/**
 * Send a system notification to a collaboration group.
 *
 * Delivery strategy:
 * 1. If delivery.nodeSendToSession + delivery.botId are provided:
 *    → resolve group session key → push "group.notification" event to subscribers.
 * 2. Otherwise (no gateway context): log-only fallback (safe for non-handler callers).
 *
 * In both cases the notification is fire-and-forget: delivery failures are logged,
 * never thrown. Persistent traceability is provided by shareAttribution records.
 */
export async function sendGroupNotification(params: GroupNotificationParams): Promise<void> {
  const systemMessage = prefixSystemMessage(params.message);
  const { delivery } = params;

  // Real-time push via gateway session infrastructure
  if (delivery?.nodeSendToSession && delivery.botId) {
    const buildKey = delivery.buildSessionKey ?? (await loadBuildBotGroupSessionKey());
    if (buildKey) {
      const sessionKey = buildKey(delivery.botId, params.groupId);
      const payload = {
        id: `notif_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        groupId: params.groupId,
        message: systemMessage,
        type: params.metadata?.type ?? "system_announcement",
        relatedResourceId: params.metadata?.relatedResourceId ?? null,
        actionBy: params.metadata?.actionBy ?? null,
        timestamp: Date.now(),
      };
      try {
        delivery.nodeSendToSession(sessionKey, "group.notification", payload);
      } catch (err) {
        // Non-fatal: notification push is best-effort
        console.error(`[GroupNotification] push failed for session=${sessionKey}:`, err);
      }
      return;
    }
  }

  // Fallback: log-only (no gateway context available)
  console.log(
    `[GroupNotification] groupId=${params.groupId} type=${params.metadata?.type ?? "unknown"}`,
    `message="${systemMessage}"`,
  );
}

/**
 * Lazily load the group destination key builder (canonical `space:<groupId>`).
 * Returns null if the module cannot be loaded (defensive).
 */
async function loadBuildBotGroupSessionKey(): Promise<
  ((botId: string, groupId: string) => string) | null
> {
  try {
    const mod = await import("./collaboration-learning/shared.js");
    return mod.buildBotGroupSessionKey;
  } catch {
    return null;
  }
}

/**
 * Format a notification message for asset sharing events.
 */
export function formatAssetShareNotification(params: {
  assetName: string;
  assetType: string;
  sharedBy: string;
  groupName?: string;
}): string {
  const typeLabel = mapAssetTypeToLabel(params.assetType);
  if (params.groupName) {
    return `📢 来自 ${params.sharedBy} 分享了${typeLabel}「${params.assetName}」到本小组`;
  }
  return `📢 来自 ${params.sharedBy} 分享了${typeLabel}「${params.assetName}」`;
}

function mapAssetTypeToLabel(assetType: string): string {
  const labels: Record<string, string> = {
    prompt: "提示词",
    template: "模板",
    workflow: "工作流",
    knowledge: "知识库",
    agent: "智能体",
    capability: "能力",
  };
  return labels[assetType] ?? "资产";
}

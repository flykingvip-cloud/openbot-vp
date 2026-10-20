/**
 * Agent Growth OS — 诞生回合 UI 接线（spec: agent-growth-lifecycle, P2 任务 13.2）。
 *
 * 在 birth/growing Prelude 展示时先放入一条可见问候，再以 `growthBirthTurn:true`
 * 触发首条 chat.send。Prelude 区显示「正在苏醒…」，收到模型回复后回落。
 */

import { t } from "../../../i18n/index.ts";
import { sendChatMessage, type ChatSendState } from "../../controllers/chat.ts";
import { shouldShowGrowthPrelude, type GrowthPreludeWireHost } from "./growth-prelude-wire.ts";
import { resolveGrowthEntityFromSessionKey } from "./growth-session-sync.ts";

/** 网关要求非空 message；零宽空格占位，不在 UI 展示用户气泡。 */
export const GROWTH_BIRTH_TURN_PLACEHOLDER = "\u200b";

/** Local assistant row shown before the model birth turn lands. History merge keeps this id. */
export const LOCAL_GROWTH_OPENING_ID_PREFIX = "local-growth-opening-";

export type GrowthBirthTurnWireHost = GrowthPreludeWireHost &
  Pick<
    ChatSendState,
    | "client"
    | "connected"
    | "sessionKey"
    | "workbenchPrimaryModule"
    | "workbenchTeamSelectedKey"
    | "chatMessages"
    | "chatSending"
    | "chatRunId"
    | "chatStream"
    | "chatStreamSessionKey"
    | "chatStreamStartedAt"
    | "chatThinkingProgress"
    | "lastError"
  > & {
    chatLoading: boolean;
    workbenchGrowthBirthAwakening: boolean;
    workbenchGrowthBirthTurnSentKey: string | null;
  };

export function isLocalGrowthOpeningMessage(message: { role?: string; id?: string }): boolean {
  return (
    message.role === "assistant" &&
    typeof message.id === "string" &&
    message.id.startsWith(LOCAL_GROWTH_OPENING_ID_PREFIX)
  );
}

/** Model replies count; the local opening greeting does not, so the birth turn can still run. */
export function hasAssistantChatMessage(messages: Array<{ role: string; id?: string }>): boolean {
  return messages.some(
    (entry) => entry.role === "assistant" && !isLocalGrowthOpeningMessage(entry),
  );
}

function resolveOpeningRoleName(host: GrowthBirthTurnWireHost): string {
  const ref = resolveGrowthEntityFromSessionKey(host.sessionKey);
  const agentId = ref?.kind === "robot" ? ref.entityId : "";
  const match = (host.agentsList?.agents ?? []).find((entry) => entry.id === agentId);
  const identityName = typeof match?.identity?.name === "string" ? match.identity.name.trim() : "";
  const displayName = typeof match?.name === "string" ? match.name.trim() : "";
  return identityName || displayName || t("frontstage.workbench.growth.defaultRoleName");
}

export function buildNewRobotOpeningGreeting(roleName: string): string {
  const role = roleName.trim() || t("frontstage.workbench.growth.defaultRoleName");
  return t("frontstage.workbench.growth.openingGreeting", { role });
}

export function shouldShowNewRobotOpeningGreeting(host: GrowthBirthTurnWireHost): boolean {
  const ref = resolveGrowthEntityFromSessionKey(host.sessionKey);
  if (!ref || ref.kind !== "robot") {
    return false;
  }
  if (!shouldShowGrowthPrelude(host.workbenchActiveGrowthStatus)) {
    return false;
  }
  return !hasAssistantChatMessage(host.chatMessages as Array<{ role: string; id?: string }>);
}

/** Put a visible greeting in the thread immediately. Does not replace a later model reply. */
export function ensureNewRobotOpeningGreeting(host: GrowthBirthTurnWireHost): boolean {
  if (!shouldShowNewRobotOpeningGreeting(host)) {
    return false;
  }
  const messages = host.chatMessages as Array<{ role?: string; id?: string }>;
  if (messages.some((entry) => isLocalGrowthOpeningMessage(entry))) {
    return false;
  }
  const text = buildNewRobotOpeningGreeting(resolveOpeningRoleName(host));
  host.chatMessages = [
    ...messages,
    {
      id: `${LOCAL_GROWTH_OPENING_ID_PREFIX}${host.sessionKey}`,
      role: "assistant",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  ];
  return true;
}

export function shouldTriggerGrowthBirthTurn(host: GrowthBirthTurnWireHost): boolean {
  if (!host.client || !host.connected) {
    return false;
  }
  if (host.chatLoading || host.chatSending) {
    return false;
  }
  if (host.workbenchGrowthBirthTurnSentKey === host.sessionKey) {
    return false;
  }
  const ref = resolveGrowthEntityFromSessionKey(host.sessionKey);
  if (!ref || ref.kind !== "robot") {
    return false;
  }
  if (!shouldShowGrowthPrelude(host.workbenchActiveGrowthStatus)) {
    return false;
  }
  if (hasAssistantChatMessage(host.chatMessages as Array<{ role: string }>)) {
    return false;
  }
  return true;
}

export function syncGrowthBirthAwakeningState(host: GrowthBirthTurnWireHost): void {
  const chatMessages = host.chatMessages as Array<{ role: string }>;
  if (hasAssistantChatMessage(chatMessages)) {
    host.workbenchGrowthBirthAwakening = false;
    return;
  }
  if (!shouldShowGrowthPrelude(host.workbenchActiveGrowthStatus)) {
    host.workbenchGrowthBirthAwakening = false;
  }
}

export function resetGrowthBirthTurnForSessionSwitch(host: GrowthBirthTurnWireHost): void {
  host.workbenchGrowthBirthAwakening = false;
  host.workbenchGrowthBirthTurnSentKey = null;
  host.workbenchGrowthPreferCultivate = false;
}

export async function maybeTriggerGrowthBirthTurn(host: GrowthBirthTurnWireHost): Promise<void> {
  const greeted = ensureNewRobotOpeningGreeting(host);
  syncGrowthBirthAwakeningState(host);
  if (!shouldTriggerGrowthBirthTurn(host)) {
    if (greeted) {
      host.requestUpdate?.();
    }
    return;
  }
  host.workbenchGrowthBirthTurnSentKey = host.sessionKey;
  host.workbenchGrowthBirthAwakening = true;
  host.requestUpdate?.();

  const runId = await sendChatMessage(host, GROWTH_BIRTH_TURN_PLACEHOLDER, undefined, {
    growthBirthTurn: true,
    suppressOptimisticUserMessage: true,
  });

  if (!runId) {
    host.workbenchGrowthBirthTurnSentKey = null;
    host.workbenchGrowthBirthAwakening = false;
  }
  syncGrowthBirthAwakeningState(host);
  host.requestUpdate?.();
}

export function growthBirthAwakeningLabel(): string {
  return t("frontstage.workbench.growth.awakening");
}

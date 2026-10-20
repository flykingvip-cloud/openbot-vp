/**
 * Chat + agent tool-stream gateway events — isolated subscription module.
 */

import { reloadShellChatHistory } from "../app-chat-actions.ts";
import { CHAT_SESSIONS_ACTIVE_MINUTES, flushChatQueueForEvent } from "../app-chat.ts";
import {
  adaptChatHistoryHost,
  adaptChatSendHost,
  adaptSettingsHost,
  adaptToolStreamHost,
} from "../app-host-adapters.ts";
import { setLastActiveSessionKey } from "../app-settings.ts";
import { handleAgentEvent, resetToolStream, type AgentEventPayload } from "../app-tool-stream.ts";
import { chatCapability, type ChatCapabilityEventPayload } from "../capability/chat/index.ts";
import { sessionsCapability } from "../capability/sessions/index.ts";
import {
  adaptChatEventCapabilityState,
  adaptChatHistoryCapabilityState,
  adaptSessionsLoadCapabilityState,
} from "../capability/view-state.ts";
import {
  shouldReloadHistoryForAgentToolResult,
  shouldReloadShellChatHistoryForFinalEvent,
} from "../chat-event-reload.ts";
import { chatEventMatchesOpenSession } from "../chat-session-key-match.ts";
import {
  applyConsumeReceipts,
  parseConsumeReceiptsFromAgentEvent,
  type ChatContextScopeState,
  type ChatContextSourceCatalogItem,
} from "../chat/context-scope.ts";
import { setExternalizationSessionKey } from "../controllers/asset-incubation/externalization-tracker.ts";
import {
  decideIncubationFromChatFinal,
  shouldSurfaceSystemAssetSuggestion,
  shouldSurfaceWeakAssetHint,
} from "../controllers/asset-incubation/from-chat-final.ts";
import { isAssetSuggestionDismissed } from "../controllers/asset-incubation/suggestion-dismiss.ts";
import { ensureAssetSuggestionPatternRuntime } from "../controllers/asset-suggestion-trigger.ts";
import { refreshConversationTaskProgress } from "../controllers/chat.ts";
import {
  isDaibaiWorkbenchSession,
  maybeRefreshDaibaiSuggestionsOnChatFinal,
} from "../controllers/daibai.ts";
import {
  clearMeetingConfirmRelease,
  meetingConfirmReleaseShouldClear,
} from "../controllers/meeting-confirmation.ts";
import { dismissHint, subscribeToPatternDetection } from "../controllers/pattern-detection.ts";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";
import { syncPendingGroupConfigProposalFromChat } from "../ports/employee/group-config-proposal.ts";
import {
  syncGrowthBirthAwakeningState,
  type GrowthBirthTurnWireHost,
} from "../ports/employee/growth-birth-turn-wire.ts";
import { applyBackgroundWorkbenchChatEvent } from "../ports/employee/workbench-session-background-chat.ts";

function handleTerminalChatEvent(
  host: GatewayHost,
  payload: ChatCapabilityEventPayload | undefined,
  state: ReturnType<typeof chatCapability.handleEvent>,
): boolean {
  if (state !== "final" && state !== "error" && state !== "aborted") {
    return false;
  }
  const toolHost = adaptToolStreamHost(host);
  const hadToolEvents = toolHost.toolStreamOrder.length > 0;
  resetToolStream(toolHost);
  void flushChatQueueForEvent(adaptChatSendHost(host));
  const runId = payload?.runId;
  if (runId && host.refreshSessionsAfterChat.has(runId)) {
    host.refreshSessionsAfterChat.delete(runId);
    if (state === "final") {
      void sessionsCapability.load(adaptSessionsLoadCapabilityState(host), {
        activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
      });
    }
  }
  if (
    shouldReloadShellChatHistoryForFinalEvent({
      state,
      hadToolEvents,
      payload,
      chatMessages: adaptChatEventCapabilityState(host).chatMessages,
      chatRunId: host.chatRunId,
    })
  ) {
    void reloadShellChatHistory(adaptChatHistoryHost(host), { refreshAvatar: false });
    return true;
  }
  return false;
}

function maybeOpenAssetSuggestionFromChatFinal(
  host: GatewayHost,
  payload: ChatCapabilityEventPayload | undefined,
) {
  const sessionKey = payload?.sessionKey?.trim() ?? "";
  setExternalizationSessionKey(sessionKey || null);
  if (
    host.client &&
    host.connected &&
    sessionKey &&
    !host.workbenchPatternDetectionSubscribedScopes.includes(sessionKey)
  ) {
    host.workbenchPatternDetectionSubscribedScopes = [
      ...host.workbenchPatternDetectionSubscribedScopes,
      sessionKey,
    ];
    const runtime = ensureAssetSuggestionPatternRuntime(host, host.client, host.connected);
    void subscribeToPatternDetection(runtime.state, sessionKey).catch(() => undefined);
  }
  const runtime = ensureAssetSuggestionPatternRuntime(host, host.client, host.connected);
  const incubation = decideIncubationFromChatFinal(payload, runtime, host.client);
  host.workbenchAssetIncubationDecision = incubation;
  host.workbenchAssetIncubationLevel = incubation.level;
  const dismissed = isAssetSuggestionDismissed({
    contextId: incubation.contextId,
    sessionKey,
  });
  if (dismissed) {
    if (incubation.contextId) {
      dismissHint(runtime.state, incubation.contextId);
    }
    host.workbenchAssetSuggestionVisible = false;
    host.workbenchAssetWeakHintVisible = false;
    return;
  }
  host.workbenchAssetWeakHintVisible = shouldSurfaceWeakAssetHint(incubation);
  if (!shouldSurfaceSystemAssetSuggestion(incubation)) {
    return;
  }
  host.workbenchAssetSuggestionVisible = true;
  host.workbenchAssetSuggestionSource = payload?.sessionKey?.trim().startsWith("space:")
    ? "group-task-complete"
    : "assistant-task-complete";
  host.workbenchAssetSuggestionLabel = incubation.reason;
  host.workbenchSkillSourceContextId = incubation.contextId;
}

function handleChatGatewayEvent(
  host: GatewayHost,
  payload: ChatCapabilityEventPayload | undefined,
) {
  const ownStewardSessionKey =
    (host as { stewardMainSessionKey?: string | null }).stewardMainSessionKey?.trim() ||
    (host.sessionKey.startsWith("agent:main:employee:") ? host.sessionKey : null);
  if (
    payload?.sessionKey &&
    !chatEventMatchesOpenSession(payload.sessionKey, host.sessionKey, {
      ownStewardSessionKey,
    })
  ) {
    applyBackgroundWorkbenchChatEvent(payload);
    // Background finals still feed incubation (cross-session recurrence), without
    // mutating the open transcript beyond the cache write above.
    if (payload.state === "final") {
      maybeOpenAssetSuggestionFromChatFinal(host, payload);
    }
    return;
  }
  if (payload?.sessionKey) {
    setLastActiveSessionKey(adaptSettingsHost(host), payload.sessionKey);
  }
  const state = chatCapability.handleEvent(adaptChatEventCapabilityState(host), payload);
  if (
    (state === "final" || state === "aborted") &&
    meetingConfirmReleaseShouldClear(
      (host as { meetingConfirmRelease?: { phase?: string } | null }).meetingConfirmRelease,
    )
  ) {
    clearMeetingConfirmRelease(host as never);
  }
  maybeOpenAssetSuggestionFromChatFinal(host, payload);
  syncGrowthBirthAwakeningState(host as unknown as GrowthBirthTurnWireHost);
  const historyReloaded = handleTerminalChatEvent(host, payload, state);
  if (state === "final") {
    // History reload is skipped when the optimistic assistant row is already visible;
    // still refresh inline ConversationTask progress after every terminal reply.
    void refreshConversationTaskProgress(adaptChatHistoryCapabilityState(host));
    void maybeRefreshDaibaiSuggestionsOnChatFinal(host as never, payload);
    if (isDaibaiWorkbenchSession(host as never)) {
      syncPendingGroupConfigProposalFromChat(host as never);
    }
  }
  if (
    state === "final" &&
    !historyReloaded &&
    shouldReloadShellChatHistoryForFinalEvent({
      state,
      hadToolEvents: false,
      payload,
      chatMessages: adaptChatEventCapabilityState(host).chatMessages,
      chatRunId: host.chatRunId,
    })
  ) {
    void reloadShellChatHistory(adaptChatHistoryHost(host), { refreshAvatar: false });
  }
}

type ContextReceiptHost = {
  sessionKey: string;
  chatContextScope?: ChatContextScopeState;
  chatContextSourceCatalog?: ChatContextSourceCatalogItem[] | null;
};

function applyKnowledgeReceiptsFromAgentEvent(
  host: GatewayHost,
  payload: AgentEventPayload | undefined,
) {
  const receipts = parseConsumeReceiptsFromAgentEvent(payload);
  if (!receipts) {
    return;
  }
  const sessionKey = typeof payload?.sessionKey === "string" ? payload.sessionKey : "";
  if (sessionKey && sessionKey !== host.sessionKey) {
    return;
  }
  const scoped = host as GatewayHost & ContextReceiptHost;
  if (!scoped.chatContextScope) {
    return;
  }
  scoped.chatContextScope = applyConsumeReceipts(
    scoped.chatContextScope,
    receipts,
    scoped.chatContextSourceCatalog ?? [],
  );
}

export function handleChatGatewaySubscription(host: GatewayHost, evt: GatewayEventFrame): boolean {
  if (evt.event === "agent") {
    if (host.onboarding) {
      return true;
    }
    handleAgentEvent(adaptToolStreamHost(host), evt.payload as AgentEventPayload | undefined);
    const agentPayload = evt.payload as AgentEventPayload | undefined;
    applyKnowledgeReceiptsFromAgentEvent(host, agentPayload);
    if (shouldReloadHistoryForAgentToolResult(agentPayload)) {
      void reloadShellChatHistory(adaptChatHistoryHost(host), { refreshAvatar: false });
    }
    return true;
  }

  if (evt.event === "chat") {
    handleChatGatewayEvent(host, evt.payload as ChatCapabilityEventPayload | undefined);
    return true;
  }

  return false;
}

import { reloadShellChatHistory } from "./app-chat-actions.ts";
import { adaptSettingsHost } from "./app-host-adapters.ts";
import { syncUrlWithSessionKey } from "./app-settings.ts";
import type { AppViewState } from "./app-view-state.ts";
import {
  resolveBuiltinStewardSessionKey,
  resolveStewardSessionDefaultsFromHello,
} from "./builtin-steward-selection.ts";
import { DEFAULT_CHAT_CONTEXT_SCOPE } from "./chat/context-scope.ts";
import type { Tab } from "./navigation.ts";
import { bumpSessionSeenAt } from "./session-seen-at.ts";
import { syncComputerPreviewAfterSessionSwitch } from "./views/account-computer-preview.ts";

export type ShellSessionSwitchState = Pick<
  AppViewState,
  | "hello"
  | "workbenchTeamSelectedKey"
  | "sessionKey"
  | "chatMessage"
  | "chatMessages"
  | "chatLoading"
  | "chatAttachments"
  | "chatQuoteDraft"
  | "chatContextScope"
  | "chatContextExpansion"
  | "chatStream"
  | "chatStreamStartedAt"
  | "chatStreamSessionKey"
  | "chatThinkingProgress"
  | "chatRunId"
  | "chatQueue"
  | "settings"
  | "applySettings"
  | "loadAssistantIdentity"
  | "resetToolStream"
  | "resetChatScroll"
  | "setTab"
>;

export type ShellSessionSwitchOptions = {
  clearAttachments?: boolean;
  clearQueue?: boolean;
  syncUrl?: boolean;
  replaceUrl?: boolean;
  targetTab?: Tab;
  onAfterSwitch?: (sessionKey: string) => void;
};

export type ShellSessionDraftState = Pick<
  AppViewState,
  | "sessionKey"
  | "chatMessage"
  | "settings"
  | "applySettings"
  | "loadAssistantIdentity"
  | "resetToolStream"
>;

export type ShellChatSessionSwitchState = ShellSessionSwitchState &
  Pick<
    AppViewState,
    "connected" | "basePath" | "hello" | "chatAvatarUrl" | "refreshSessionsAfterChat"
  >;

/**
 * Shared shell-level session switch for chat surfaces outside the employee
 * workbench. This keeps tab renderers and chat controls aligned while the
 * app shell still owns the mutable state object directly.
 */
export function switchShellSession(
  state: ShellSessionSwitchState,
  sessionKey: string,
  options: ShellSessionSwitchOptions = {},
) {
  const seenAt = Date.now();
  state.workbenchTeamSelectedKey = sessionKey;
  state.sessionKey = sessionKey;
  state.chatMessage = "";
  // Drop previous transcript immediately so a different sessionKey cannot paint
  // foreign bubbles under the new header while history reloads.
  state.chatMessages = [];
  state.chatLoading = true;
  if (options.clearAttachments) {
    state.chatAttachments = [];
  }
  state.chatQuoteDraft = null;
  state.chatContextScope = { ...DEFAULT_CHAT_CONTEXT_SCOPE };
  state.chatContextExpansion = null;
  state.chatStream = null;
  state.chatStreamStartedAt = null;
  state.chatStreamSessionKey = null;
  state.chatThinkingProgress = null;
  state.chatRunId = null;
  if (options.clearQueue) {
    state.chatQueue = [];
  }
  state.resetToolStream();
  state.resetChatScroll();
  state.applySettings({
    ...state.settings,
    sessionKey,
    lastActiveSessionKey: sessionKey,
    sessionSeenAt: bumpSessionSeenAt(state.settings.sessionSeenAt, sessionKey, seenAt, {
      ownStewardSessionKey: resolveBuiltinStewardSessionKey(
        resolveStewardSessionDefaultsFromHello(state.hello),
      ),
    }),
  });
  if (options.syncUrl) {
    syncUrlWithSessionKey(adaptSettingsHost(state), sessionKey, options.replaceUrl ?? true);
  }
  void state.loadAssistantIdentity();
  options.onAfterSwitch?.(sessionKey);
  if (options.targetTab) {
    state.setTab(options.targetTab);
  }
}

/**
 * Lightweight session-key update used by freeform inputs such as overview
 * settings. This intentionally avoids broader session-switch side effects like
 * scroll resets, URL sync, or session-seen timestamps.
 */
export function setShellSessionDraftKey(state: ShellSessionDraftState, sessionKey: string) {
  state.sessionKey = sessionKey;
  state.chatMessage = "";
  state.resetToolStream();
  state.applySettings({
    ...state.settings,
    sessionKey,
    lastActiveSessionKey: sessionKey,
  });
  void state.loadAssistantIdentity();
}

export function switchShellChatSession(
  state: ShellChatSessionSwitchState,
  sessionKey: string,
  options: Omit<ShellSessionSwitchOptions, "onAfterSwitch"> & { refreshAvatar?: boolean } = {},
) {
  switchShellSession(state, sessionKey, {
    ...options,
    onAfterSwitch: () => {
      void reloadShellChatHistory(
        state as unknown as Parameters<typeof reloadShellChatHistory>[0],
        { refreshAvatar: options.refreshAvatar },
      );
      syncComputerPreviewAfterSessionSwitch(
        state as unknown as Parameters<typeof syncComputerPreviewAfterSessionSwitch>[0],
      );
    },
  });
}

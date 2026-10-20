/**
 * P2/P5 EA-B1: chat.send focus-switch gate UI (keep / park / cancel).
 * The question lives in the thread as choice cards, not above the composer.
 * Cancel requires an explicit click (user consent).
 */

export type FocusSwitchGateView = {
  currentTitle: string;
  incomingTitle: string;
  pendingDraft: string;
  pendingMessageId?: string;
};

export type FocusSwitchBlockedPayload = {
  status: "focus_switch_blocked";
  runId?: string;
  focusSwitch?: {
    blocked?: boolean;
    currentTitle?: string;
    incomingTitle?: string;
  };
};

export function isFocusSwitchBlockedResult(_value: unknown): _value is FocusSwitchBlockedPayload {
  return false;
}

export type FocusSwitchUiHost = {
  chatMessage: string;
  chatMessages: unknown[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatSending?: boolean;
  chatFocusSwitchGate?: FocusSwitchGateView | null;
  chatFocusSwitchProceedAuthorized?: boolean;
  chatFocusSwitchCancelAuthorized?: boolean;
  requestUpdate?: () => void;
};

function removeMessageById(host: FocusSwitchUiHost, messageId?: string): void {
  if (!messageId) {
    return;
  }
  host.chatMessages = host.chatMessages.filter((entry) => {
    if (!entry || typeof entry !== "object") {
      return true;
    }
    return (entry as { id?: unknown }).id !== messageId;
  });
}

/** Legacy blocked payloads are not a choice card and do not hold the send. */
export function applyFocusSwitchBlocked(
  host: FocusSwitchUiHost,
  _result: FocusSwitchBlockedPayload,
  _draftText: string,
): void {
  host.chatFocusSwitchGate = null;
  host.chatFocusSwitchProceedAuthorized = false;
  host.chatFocusSwitchCancelAuthorized = false;
  host.requestUpdate?.();
}

/** User chose to park the current focus and send the new task. */
export function authorizeFocusSwitchProceed(host: FocusSwitchUiHost): void {
  const draft = host.chatFocusSwitchGate?.pendingDraft?.trim();
  if (draft) {
    host.chatMessage = draft;
  }
  host.chatFocusSwitchProceedAuthorized = true;
  host.chatFocusSwitchCancelAuthorized = false;
  host.chatFocusSwitchGate = null;
  host.requestUpdate?.();
}

/** User consented to cancel the current focus and send the new task. */
export function authorizeFocusSwitchCancel(host: FocusSwitchUiHost): void {
  const draft = host.chatFocusSwitchGate?.pendingDraft?.trim();
  if (draft) {
    host.chatMessage = draft;
  }
  host.chatFocusSwitchProceedAuthorized = false;
  host.chatFocusSwitchCancelAuthorized = true;
  host.chatFocusSwitchGate = null;
  host.requestUpdate?.();
}

/** User chose to keep the current focus. Remove the unsent turn; draft stays. */
export function dismissFocusSwitchGate(host: FocusSwitchUiHost): void {
  const pendingDraft = host.chatFocusSwitchGate?.pendingDraft?.trim();
  removeMessageById(host, host.chatFocusSwitchGate?.pendingMessageId);
  host.chatFocusSwitchProceedAuthorized = false;
  host.chatFocusSwitchCancelAuthorized = false;
  host.chatFocusSwitchGate = null;
  if (pendingDraft) {
    host.chatMessage = pendingDraft;
  }
  host.requestUpdate?.();
}

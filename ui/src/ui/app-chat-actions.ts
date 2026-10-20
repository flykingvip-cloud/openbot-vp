import {
  refreshChat,
  refreshChatAvatar,
  type ChatHistoryHost,
  type ChatRefreshHost,
} from "./app-chat.ts";
import type { AppViewState } from "./app-view-state.ts";
import { chatCapability } from "./capability/chat/index.ts";
import { adaptChatHistoryCapabilityState } from "./capability/view-state.ts";
import { canonicalizeWorkbenchChatSessionKey } from "./chat-session-key-match.ts";
import { resolveWorkbenchChatSessionKey } from "./chat/workbench-visible-messages.ts";

const chatActionDeps = {
  reloadShellChatHistory: reloadShellChatHistoryInternal,
};

export type ShellChatRefreshState = ChatRefreshHost & Pick<AppViewState, "resetToolStream">;
export type ShellChatHistoryReloadState = ChatHistoryHost & {
  // chat-checkpoint-rollback: refresh the inline checkpoint dividers whenever
  // history reloads (session switch, turn completion, tool-result reloads).
  loadChatCheckpoints?: () => Promise<void>;
};

export type ManualShellChatRefreshState = ShellChatRefreshState &
  Pick<AppViewState, "chatManualRefreshInFlight" | "chatNewMessagesBelow" | "updateComplete"> & {
    scrollToBottom: (opts?: { smooth?: boolean }) => void;
  };

async function reloadShellChatHistoryInternal(
  state: ShellChatHistoryReloadState,
  opts?: { refreshAvatar?: boolean },
) {
  const tasks: Promise<unknown>[] = [
    // Session switch and in-turn reloads omit forceOpen. Only refreshChat
    // (cold Control UI / hard refresh) may restore 电脑 from history.
    chatCapability.loadHistory(adaptChatHistoryCapabilityState(state)),
  ];
  if (opts?.refreshAvatar !== false) {
    tasks.push(refreshChatAvatar(state));
  }
  if (typeof state.loadChatCheckpoints === "function") {
    tasks.push(state.loadChatCheckpoints());
  }
  await Promise.all(tasks);
}

export function setChatActionsTestHooks(hooks: Partial<typeof chatActionDeps> | null) {
  Object.assign(
    chatActionDeps,
    hooks ?? { reloadShellChatHistory: reloadShellChatHistoryInternal },
  );
}

export async function loadOlderShellChatHistory(state: ShellChatHistoryReloadState) {
  await chatCapability.loadOlderHistory(adaptChatHistoryCapabilityState(state));
}

export async function reloadShellChatHistory(
  state: ShellChatHistoryReloadState,
  opts?: { refreshAvatar?: boolean },
) {
  await chatActionDeps.reloadShellChatHistory(state, opts);
}

export class ChatRestoreNotConnectedError extends Error {
  constructor(message = "Not connected to gateway") {
    super(message);
    this.name = "ChatRestoreNotConnectedError";
  }
}

/** Client backstop. The gateway deadline is shorter so its error usually wins. */
const DEFAULT_CHAT_RESTORE_CLIENT_TIMEOUT_MS = 30_000;
let chatRestoreClientTimeoutMs = DEFAULT_CHAT_RESTORE_CLIENT_TIMEOUT_MS;

export class ChatRestoreTimeoutError extends Error {
  readonly code = "RESTORE_TIMEOUT";
  readonly reasonCode = "RESTORE_TIMEOUT";

  constructor(message = "checkpoint restore timed out before the conversation was rolled back") {
    super(message);
    this.name = "ChatRestoreTimeoutError";
  }
}

export function setChatRestoreClientTimeoutForTests(ms: number | null) {
  chatRestoreClientTimeoutMs = ms ?? DEFAULT_CHAT_RESTORE_CLIENT_TIMEOUT_MS;
}

export type ChatRestoreResult = {
  ok?: boolean;
  queued?: boolean;
  checkpointId?: string;
  reasonCode?: string;
  message?: string;
};

type ChatRestoreClient = {
  connected: boolean;
  sessionKey: string;
  /** Visible workbench team/session; preferred when it diverges from sessionKey. */
  workbenchTeamSelectedKey?: string;
  /** Same module hint chat.send uses for space: binding. */
  workbenchPrimaryModule?: string;
  client: {
    request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  } | null;
};

/** Align restore/list RPCs with the session key painted in the chat chrome (and send/history). */
export function resolveChatRestoreSessionKey(
  state: Pick<
    ChatRestoreClient,
    "sessionKey" | "workbenchTeamSelectedKey" | "workbenchPrimaryModule"
  >,
): string {
  const selected = canonicalizeWorkbenchChatSessionKey(
    state.workbenchTeamSelectedKey?.trim() ?? "",
  );
  const sessionKey = canonicalizeWorkbenchChatSessionKey(state.sessionKey.trim());
  // Match controllers/chat resolveChatSendSessionKey for collaboration spaces.
  if (state.workbenchPrimaryModule === "collaboration" && selected.startsWith("space:")) {
    return selected;
  }
  return resolveWorkbenchChatSessionKey({
    selectedKey: selected,
    sessionKey,
  });
}

export async function restoreShellChat(
  state: ChatRestoreClient,
  checkpointId?: string,
): Promise<ChatRestoreResult> {
  if (!state.client || !state.connected) {
    throw new ChatRestoreNotConnectedError();
  }
  const request = state.client.request("chat.restore", {
    sessionKey: resolveChatRestoreSessionKey(state),
    ...(checkpointId ? { checkpointId } : {}),
    queueWhenActive: true,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    return await new Promise<ChatRestoreResult>((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new ChatRestoreTimeoutError());
      }, chatRestoreClientTimeoutMs);
      request.then(
        (value) => {
          if (timedOut) {
            return;
          }
          resolve((value ?? {}) as ChatRestoreResult);
        },
        (err: unknown) => {
          if (timedOut) {
            return;
          }
          reject(err);
        },
      );
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Shared shell-level chat refresh.
 *
 * The shell uses a lighter refresh in chat surfaces and a full refresh in the
 * manual refresh button. Centralizing both paths here keeps tool-stream reset
 * and refresh semantics aligned across entry points.
 */
export async function refreshShellChat(
  state: ShellChatRefreshState,
  opts?: { includeSessions?: boolean },
) {
  state.resetToolStream();
  if (opts?.includeSessions) {
    await refreshChat(state, { scheduleScroll: false });
    return;
  }
  await reloadShellChatHistory(state);
}

export async function manuallyRefreshShellChat(
  state: ManualShellChatRefreshState,
  opts?: { includeSessions?: boolean },
) {
  state.chatManualRefreshInFlight = true;
  state.chatNewMessagesBelow = false;
  await state.updateComplete;
  try {
    await refreshShellChat(state, opts);
    state.scrollToBottom({ smooth: true });
  } finally {
    requestAnimationFrame(() => {
      state.chatManualRefreshInFlight = false;
      state.chatNewMessagesBelow = false;
    });
  }
}

/** Pull reasonCode from a gateway error (top-level or nested details). */
export function readRestoreErrorReasonCode(err: unknown): string | null {
  if (!err || typeof err !== "object") {
    return null;
  }
  const candidate = err as {
    reasonCode?: unknown;
    details?: { reasonCode?: unknown } | null;
  };
  if (typeof candidate.reasonCode === "string" && candidate.reasonCode) {
    return candidate.reasonCode;
  }
  const nested = candidate.details;
  if (nested && typeof nested === "object" && typeof nested.reasonCode === "string") {
    return nested.reasonCode;
  }
  return null;
}

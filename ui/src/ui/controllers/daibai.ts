import type {
  ControlUiPlatformAuthState,
  ControlUiTrustedProxySession,
} from "../../../../src/gateway/control-ui-contract.js";
import type {
  DaibaiAskResult,
  DaibaiConfirmationDetail,
  DaibaiConfirmationEnvelope,
  DaibaiExecuteResult,
} from "../../../../src/shared/daibai-types.ts";
import {
  isBuiltinStewardSelection,
  resolveBuiltinStewardSessionKey,
  resolveStewardSessionDefaultsFromHello,
  type StewardSessionDefaults,
} from "../builtin-steward-selection.ts";
import { areChatSessionKeysEquivalent } from "../chat-session-key-match.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "../gateway.ts";
import { bumpSessionSeenAt } from "../session-seen-at.ts";
import { isDaibaiGuideAcknowledgedForUser } from "../storage.ts";

const DEFAULT_DAIBAI_MESSAGE = "请帮我检查当前支持状态，并给出下一步建议。";

/**
 * Optional familiarization ask. Primary「开始引导」opens team building in the workbench
 * and does not send this prompt.
 */
export const DAIBAI_ONBOARDING_GUIDE_PROMPT =
  "请你以新用户引导员的身份，用对话方式给我一个简洁的首次登录操作指南，并说明接下来你还能继续代办什么。";

export type DaibaiIdentityState = {
  hello: GatewayHelloOk | null;
  platformAuthState: ControlUiPlatformAuthState | null;
  bootstrapAuthSession: ControlUiTrustedProxySession | null;
};

export type DaibaiPendingConfirmation = {
  actionId: string;
  payload?: Record<string, unknown>;
  confirmation: DaibaiConfirmationEnvelope;
  message: string;
  detail?: DaibaiConfirmationDetail;
};

export type DaibaiState = DaibaiIdentityState & {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  daibaiSourceSessionKey: string | null;
  chatMessage: string;
  daibaiLastMessage: string | null;
  daibaiLoading: boolean;
  daibaiError: string | null;
  daibaiAskResult: DaibaiAskResult | null;
  daibaiExecuteResult: DaibaiExecuteResult | null;
  daibaiActionLoading: boolean;
  daibaiActionPendingId: string | null;
  daibaiActionError: string | null;
  daibaiPendingConfirmation: DaibaiPendingConfirmation | null;
};

export type DaibaiAutoAskState = Pick<
  DaibaiState,
  "connected" | "sessionKey" | "daibaiLoading" | "daibaiAskResult" | "daibaiError" | "hello"
> & {
  platformAuthState?: DaibaiIdentityState["platformAuthState"];
  bootstrapAuthSession?: DaibaiIdentityState["bootstrapAuthSession"];
  tab?: string;
  workbenchPrimaryModule?: string;
  workbenchTeamSelectedKey?: string;
  settings?: {
    daibaiGuideAcknowledged?: boolean;
  } | null;
  chatMessages?: Array<{ role?: string; content?: unknown }>;
};

export function resolveDaibaiSessionDefaults(state: DaibaiIdentityState): StewardSessionDefaults {
  return resolveStewardSessionDefaultsFromHello(state.hello);
}

export function isDaibaiWorkbenchSession(
  state: Pick<
    DaibaiAutoAskState,
    "tab" | "workbenchPrimaryModule" | "workbenchTeamSelectedKey" | "sessionKey" | "hello"
  >,
): boolean {
  if (state.tab !== "me" || state.workbenchPrimaryModule !== "assistant") {
    return false;
  }
  return isBuiltinStewardSelection({
    sessionKey: state.sessionKey,
    workbenchTeamSelectedKey: state.workbenchTeamSelectedKey,
    sessionDefaults: resolveStewardSessionDefaultsFromHello(state.hello),
  });
}

// NOTE: Workbench sends always go through `chat.send` -> the real model runtime.
// A retired helper here used to divert short messages (<= 12 chars) to the
// template-only `user.daibai.ask` RPC; that shortcut answered with canned text
// instead of the agent's reasoning, so it was removed rather than re-wired.

export function shouldAutoAskDaibai(state: DaibaiAutoAskState) {
  const trustedSession = resolveTrustedSession(state);
  const guideAcknowledged = isDaibaiGuideAcknowledgedForUser(
    state.settings ?? {},
    trustedSession?.user,
  );
  const hasChatHistory = (state.chatMessages?.length ?? 0) > 0;
  return (
    state.connected &&
    isDaibaiWorkbenchSession(state) &&
    !guideAcknowledged &&
    !hasChatHistory &&
    !state.daibaiLoading &&
    !state.daibaiError
  );
}

function trimString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveTrustedSession(state: {
  hello?: DaibaiIdentityState["hello"];
  platformAuthState?: DaibaiIdentityState["platformAuthState"];
  bootstrapAuthSession?: DaibaiIdentityState["bootstrapAuthSession"];
}) {
  if (state.hello?.auth?.provider === "trusted-proxy" && trimString(state.hello.auth.user)) {
    return state.hello.auth;
  }
  return state.platformAuthState?.session ?? state.bootstrapAuthSession;
}

/** Align with render-model workbench actor resolution (employee UUID vs login email). */
export function resolveDaibaiIdentity(state: DaibaiIdentityState) {
  const trustedSession = resolveTrustedSession(state);
  const sessionUser =
    trimString(trustedSession?.user) ?? trimString(state.platformAuthState?.session?.user);
  const employeeUserId = trimString(state.platformAuthState?.employeeAccess?.employeeUserId);
  return {
    userId: employeeUserId ?? sessionUser,
    tenantId:
      trimString(trustedSession?.tenantId) ??
      trimString(state.platformAuthState?.session?.tenantId) ??
      undefined,
  };
}

function resolveAskMessage(
  state: Pick<DaibaiState, "chatMessage" | "daibaiLastMessage">,
  message?: string,
) {
  return (
    trimString(message) ??
    trimString(state.chatMessage) ??
    trimString(state.daibaiLastMessage) ??
    DEFAULT_DAIBAI_MESSAGE
  );
}

export async function refreshDaibaiSuggestions(state: DaibaiState, message: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const identity = resolveDaibaiIdentity(state);
  if (!identity.userId) {
    return;
  }
  const prompt = trimString(message);
  if (!prompt) {
    return;
  }
  state.daibaiLastMessage = prompt;
  try {
    const result = await state.client.request<DaibaiAskResult>("user.daibai.ask", {
      userId: identity.userId,
      tenantId: identity.tenantId,
      sessionKey: state.sessionKey,
      ...(state.daibaiSourceSessionKey ? { sourceSessionKey: state.daibaiSourceSessionKey } : {}),
      message: prompt,
    });
    state.daibaiAskResult = result;
    state.daibaiError = null;
  } catch {
    // Chip suggestions are best-effort; chat history remains authoritative.
  }
}

export async function askDaibai(
  state: DaibaiState,
  message?: string,
  opts?: { resetTurn?: boolean },
) {
  if (!state.client || !state.connected) {
    state.daibaiError = "当前连接不可用，无法请求大白管家。";
    return;
  }
  const identity = resolveDaibaiIdentity(state);
  if (!identity.userId) {
    state.daibaiError = "当前未识别到用户身份，无法请求大白管家。";
    return;
  }
  if (state.daibaiLoading) {
    state.daibaiError = "上一条大白请求仍在处理中，请稍候再发。";
    return;
  }
  const prompt = resolveAskMessage(state, message);
  const resetTurn = opts?.resetTurn !== false;
  state.daibaiLastMessage = prompt;
  if (resetTurn) {
    state.daibaiExecuteResult = null;
    state.daibaiPendingConfirmation = null;
  }
  if (trimString(state.chatMessage) === prompt) {
    state.chatMessage = "";
  }
  state.daibaiLoading = true;
  state.daibaiError = null;
  state.daibaiActionError = null;
  try {
    const result = await state.client.request<DaibaiAskResult>("user.daibai.ask", {
      userId: identity.userId,
      tenantId: identity.tenantId,
      sessionKey: state.sessionKey,
      ...(state.daibaiSourceSessionKey ? { sourceSessionKey: state.daibaiSourceSessionKey } : {}),
      message: prompt,
    });
    state.daibaiAskResult = result;
  } catch (err) {
    state.daibaiError = String(err);
    if (trimString(message) && !trimString(state.chatMessage)) {
      state.chatMessage = prompt;
    }
  } finally {
    state.daibaiLoading = false;
  }
}

export async function askDaibaiOnboardingGuide(state: DaibaiState) {
  await askDaibai(state, DAIBAI_ONBOARDING_GUIDE_PROMPT);
}

export async function executeDaibaiAction(
  state: DaibaiState,
  actionId: string,
  payload?: Record<string, unknown>,
  confirmation?: DaibaiConfirmationEnvelope,
) {
  if (!state.client || !state.connected) {
    state.daibaiActionError = "当前连接不可用，无法执行大白动作。";
    return;
  }
  const identity = resolveDaibaiIdentity(state);
  if (!identity.userId) {
    state.daibaiActionError = "当前未识别到用户身份，无法执行大白动作。";
    return;
  }
  if (state.daibaiActionLoading) {
    return;
  }
  state.daibaiActionLoading = true;
  state.daibaiActionPendingId = actionId;
  state.daibaiActionError = null;
  try {
    const enrichedPayload =
      actionId === "support.case.create"
        ? {
            sourceSessionKey: state.sessionKey,
            userProblem: resolveAskMessage(state, trimString(payload?.userProblem) ?? undefined),
            ...payload,
          }
        : payload;
    const result = await state.client.request<DaibaiExecuteResult>("user.daibai.execute", {
      userId: identity.userId,
      tenantId: identity.tenantId,
      sessionKey: state.sessionKey,
      actionId,
      payload: enrichedPayload,
      proposalId: confirmation?.proposalId,
      confirmationToken: confirmation?.confirmationToken,
    });
    state.daibaiExecuteResult = result;
    if (result.status === "pending_confirmation" && result.confirmation) {
      state.daibaiPendingConfirmation = {
        actionId,
        payload: enrichedPayload,
        confirmation: result.confirmation,
        message: result.message,
        detail: result.confirmationDetail,
      };
      return;
    }
    state.daibaiPendingConfirmation = null;
    const refreshMessage = state.daibaiLastMessage ?? "";
    if (refreshMessage) {
      await refreshDaibaiSuggestions(state, refreshMessage);
    }
  } catch (err) {
    state.daibaiActionError = String(err);
  } finally {
    state.daibaiActionLoading = false;
    state.daibaiActionPendingId = null;
  }
}

export async function confirmDaibaiPendingAction(state: DaibaiState) {
  const pending = state.daibaiPendingConfirmation;
  if (!pending) {
    return;
  }
  await executeDaibaiAction(state, pending.actionId, pending.payload, pending.confirmation);
}

export function cancelDaibaiPendingConfirmation(state: DaibaiState) {
  state.daibaiPendingConfirmation = null;
  state.daibaiExecuteResult = null;
}

export type DaibaiOpenHelpState = DaibaiState & {
  workbenchPrimaryModule?: string;
  workbenchTeamSelectedKey?: string;
};

export type DaibaiOpenHelpSessionState = DaibaiOpenHelpState & {
  chatMessages?: unknown[];
  chatStream?: string | null;
  chatStreamStartedAt?: number | null;
  chatRunId?: string | null;
  chatQueue?: unknown[];
  chatAttachments?: unknown[];
  resetToolStream?: () => void;
  resetChatScroll?: () => void;
  applySettings?: (next: unknown) => void;
  settings?: {
    sessionKey?: string;
    lastActiveSessionKey?: string;
    sessionSeenAt?: Record<string, number>;
  };
  loadAssistantIdentity?: () => void | Promise<void>;
};

/** 从其他模块跳转到大白并携带上下文（Phase 8.1）。 */
export async function openDaibaiHelpFromModule(
  state: DaibaiOpenHelpSessionState,
  params: { moduleLabel: string; contextMessage?: string; sourceSessionKey?: string },
) {
  const previousSessionKey = state.sessionKey;
  const source = params.sourceSessionKey?.trim() || previousSessionKey.trim();
  const defaults = resolveStewardSessionDefaultsFromHello(state.hello);
  const stewardKey = resolveBuiltinStewardSessionKey(defaults);
  const switching = previousSessionKey.trim() !== stewardKey.trim();
  state.workbenchPrimaryModule = "assistant";
  state.workbenchTeamSelectedKey = stewardKey;
  state.sessionKey = stewardKey;
  state.daibaiSourceSessionKey = source || null;
  if (switching) {
    // Align with switchEmployeeWorkbenchSession so group bubbles / in-flight runs
    // do not linger until steward history reloads.
    if (Array.isArray(state.chatMessages)) {
      state.chatMessages = [];
    }
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.chatRunId = null;
    if (Array.isArray(state.chatQueue)) {
      state.chatQueue = [];
    }
    if (Array.isArray(state.chatAttachments)) {
      state.chatAttachments = [];
    }
    state.resetToolStream?.();
    state.resetChatScroll?.();
  }
  if (typeof state.applySettings === "function" && state.settings) {
    state.applySettings({
      ...state.settings,
      sessionKey: stewardKey,
      lastActiveSessionKey: stewardKey,
      sessionSeenAt: bumpSessionSeenAt(state.settings.sessionSeenAt ?? {}, stewardKey, Date.now()),
    });
  }
  void state.loadAssistantIdentity?.();
  state.chatMessage =
    params.contextMessage?.trim() ||
    `我在「${params.moduleLabel}」模块需要帮助（来源会话：${source}），请结合当前上下文给我建议。`;
}

function extractTextFromChatContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const record = block as { type?: string; text?: string };
      return record.type === "text" && typeof record.text === "string" ? record.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function resolveLastUserChatMessage(messages: DaibaiAutoAskState["chatMessages"]): string | null {
  if (!messages?.length) {
    return null;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (entry?.role !== "user") {
      continue;
    }
    const text = extractTextFromChatContent(entry.content);
    if (text) {
      return text;
    }
  }
  return null;
}

/** Chat 回合结束后刷新按需 chip（不覆盖 chat.history）。 */
export async function maybeRefreshDaibaiSuggestionsOnChatFinal(
  state: DaibaiAutoAskState & DaibaiState,
  payload?: { sessionKey?: string },
) {
  if (!isDaibaiWorkbenchSession(state)) {
    return;
  }
  const sessionKey = payload?.sessionKey?.trim();
  // Gateway remaps main → agent:main:employee:<userId>; only the caller's own
  // steward key may equate to the main alias (never another employee's key).
  const ownSteward =
    resolveStewardSessionDefaultsFromHello(
      (state as { hello?: Parameters<typeof resolveStewardSessionDefaultsFromHello>[0] }).hello,
    ).mainSessionKey?.trim() ||
    (state.sessionKey.startsWith("agent:main:employee:") ? state.sessionKey : null);
  if (
    sessionKey &&
    !areChatSessionKeysEquivalent(sessionKey, state.sessionKey, {
      ownStewardSessionKey: ownSteward,
    })
  ) {
    return;
  }
  const lastUserMessage = resolveLastUserChatMessage(state.chatMessages);
  if (!lastUserMessage) {
    return;
  }
  await refreshDaibaiSuggestions(state, lastUserMessage);
}

/** Clear template prelude when a real chat turn starts so it cannot mask the model reply. */
export function clearDaibaiAskResultOnChatSend(state: Pick<DaibaiState, "daibaiAskResult">) {
  state.daibaiAskResult = null;
}

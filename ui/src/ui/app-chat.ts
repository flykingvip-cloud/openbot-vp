import type { MentionMetadata } from "../../../src/organization/mention-types.js";
import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.js";
import { adaptScrollHost, adaptToolStreamHost } from "./app-host-adapters.ts";
import { scheduleChatScroll, type ScrollHost } from "./app-scroll.ts";
import { resetToolStream } from "./app-tool-stream.ts";
import type { ToolStreamHost } from "./app-tool-stream.ts";
import { resolveStewardSessionDefaultsFromHello } from "./builtin-steward-selection.ts";
import {
  chatCapability,
  type ChatCapabilityAbortState,
  type ChatCapabilityHistoryState,
  type ChatCapabilitySendState,
} from "./capability/chat/index.ts";
import {
  sessionsCapability,
  type SessionsCapabilityLoadState,
} from "./capability/sessions/index.ts";
import {
  adaptChatAbortCapabilityState,
  adaptChatHistoryCapabilityState,
  adaptChatSendCapabilityState,
  adaptSessionsLoadCapabilityState,
} from "./capability/view-state.ts";
import { expandFoldedPastesIntoMessage } from "./chat/paste-as-attachment.ts";
import { composeQuotedUserMessage, type ChatQuoteDraft } from "./chat/quote-draft.ts";
import { resolveWorkbenchChatSessionKey } from "./chat/workbench-visible-messages.ts";
import {
  buildMentionCandidatesForComposer,
  collectComposerPluginMentionEntries,
} from "./components/mention/build-mention-candidates.ts";
import { buildMentionsFromMessage } from "./components/mention/mention-from-message.ts";
import type { ChatSendOptions } from "./controllers/chat.ts";
import type { GatewayHelloOk } from "./gateway.ts";
import { normalizeBasePath } from "./navigation.ts";
import type { UiSettings } from "./storage.ts";
import type { ChatAttachment, ChatQueueItem } from "./ui-types.ts";
import { generateUUID } from "./uuid.ts";

type ChatSettingsHost = {
  settings: UiSettings;
  applySettings: (next: UiSettings) => void;
  sessionKey: string;
};

export type ChatBusyState = Pick<ChatCapabilitySendState, "chatSending" | "chatRunId">;

export type ChatAvatarHost = Pick<ChatCapabilityHistoryState, "connected" | "sessionKey"> & {
  basePath: string;
  hello: GatewayHelloOk | null;
  chatAvatarUrl: string | null;
};

export type ChatAbortHost = ChatCapabilityAbortState &
  Pick<ChatCapabilitySendState, "connected"> & {
    chatMessage: string;
    chatHumanTakeoverObserved?: boolean;
  };

export type ChatHistoryHost = ChatCapabilityHistoryState & ChatAvatarHost;

export type ChatRefreshHost = ChatHistoryHost &
  SessionsCapabilityLoadState &
  ScrollHost &
  Partial<ToolStreamHost>;

export type ChatSendHost = ChatCapabilitySendState &
  ChatBusyState &
  ChatSettingsHost &
  ScrollHost &
  ToolStreamHost & {
    chatMessage: string;
    chatAttachments: ChatAttachment[];
    chatQuoteDraft?: ChatQuoteDraft | null;
    chatQueue: ChatQueueItem[];
    refreshSessionsAfterChat: Set<string>;
  };

export type ChatQueueHost = Pick<
  ChatSendHost,
  "connected" | "chatQueue" | "chatSending" | "chatRunId"
>;

export type ChatHost = ChatAbortHost & ChatRefreshHost & ChatSendHost;

export const CHAT_SESSIONS_ACTIVE_MINUTES = 120;

function setLastActiveChatSession(host: ChatSettingsHost) {
  const trimmed = host.sessionKey.trim();
  if (!trimmed || host.settings.lastActiveSessionKey === trimmed) {
    return;
  }
  host.applySettings({
    ...host.settings,
    lastActiveSessionKey: trimmed,
  });
}

export function isChatBusy(host: ChatBusyState) {
  return host.chatSending || Boolean(host.chatRunId);
}

export function isChatStopCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/stop") {
    return true;
  }
  return (
    normalized === "stop" ||
    normalized === "esc" ||
    normalized === "abort" ||
    normalized === "wait" ||
    normalized === "exit"
  );
}

export function isChatUndoCommand(text: string) {
  const trimmed = text.trim().toLowerCase();
  return trimmed === "/undo" || trimmed === "undo";
}

export function isChatResetCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/new" || normalized === "/reset") {
    return true;
  }
  return normalized.startsWith("/new ") || normalized.startsWith("/reset ");
}

export async function handleAbortChat(host: ChatAbortHost) {
  if (!host.connected) {
    return;
  }
  host.chatMessage = "";
  await chatCapability.abortRun(adaptChatAbortCapabilityState(host));
}

export async function handleUndoChat(host: ChatAbortHost) {
  if (!host.connected) {
    return;
  }
  host.chatMessage = "";
  const ok = await chatCapability.abortRun(adaptChatAbortCapabilityState(host), { mode: "undo" });
  if (ok) {
    host.chatHumanTakeoverObserved = true;
  }
}

function enqueueChatMessage(
  host: Pick<ChatSendHost, "chatQueue">,
  text: string,
  attachments?: ChatAttachment[],
  refreshSessions?: boolean,
) {
  const trimmed = text.trim();
  const hasAttachments = Boolean(attachments && attachments.length > 0);
  if (!trimmed && !hasAttachments) {
    return;
  }
  host.chatQueue = [
    ...host.chatQueue,
    {
      id: generateUUID(),
      text: trimmed,
      createdAt: Date.now(),
      attachments: hasAttachments ? attachments?.map((att) => ({ ...att })) : undefined,
      refreshSessions,
    },
  ];
}

async function sendChatMessageNow(
  host: ChatSendHost,
  body: string,
  opts?: {
    composerQuote?: ChatQuoteDraft;
    displayMessage?: string;
    previousDraft?: string;
    restoreDraft?: boolean;
    previousQuoteDraft?: ChatQuoteDraft | null;
    attachments?: ChatAttachment[];
    previousAttachments?: ChatAttachment[];
    restoreAttachments?: boolean;
    refreshSessions?: boolean;
    cronReplyContext?: ChatSendOptions["cronReplyContext"];
    contextScope?: ChatSendOptions["contextScope"];
    mentions?: MentionMetadata[];
    growthGateProceed?: boolean;
    focusSwitchProceed?: boolean;
    focusSwitchCancel?: boolean;
    suppressOptimisticUserMessage?: boolean;
    stewardCallAuthorizationId?: string;
    idempotencyKey?: string;
  },
) {
  resetToolStream(adaptToolStreamHost(host));
  const runId = await chatCapability.sendMessage(
    adaptChatSendCapabilityState(host),
    body,
    opts?.attachments,
    {
      ...(opts?.composerQuote ? { composerQuote: opts.composerQuote } : {}),
      ...(opts?.displayMessage ? { displayMessage: opts.displayMessage } : {}),
      ...(opts?.cronReplyContext ? { cronReplyContext: opts.cronReplyContext } : {}),
      ...(opts?.contextScope ? { contextScope: opts.contextScope } : {}),
      ...(opts?.mentions && opts.mentions.length > 0 ? { mentions: opts.mentions } : {}),
      ...(opts?.growthGateProceed ? { growthGateProceed: true } : {}),
      ...(opts?.focusSwitchProceed ? { focusSwitchProceed: true } : {}),
      ...(opts?.focusSwitchCancel ? { focusSwitchCancel: true } : {}),
      ...(opts?.suppressOptimisticUserMessage ? { suppressOptimisticUserMessage: true } : {}),
      ...(opts?.stewardCallAuthorizationId
        ? { stewardCallAuthorizationId: opts.stewardCallAuthorizationId }
        : {}),
      ...(opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
    },
  );
  const ok = Boolean(runId);
  if (!ok && opts?.previousDraft != null) {
    host.chatMessage = opts.previousDraft;
  }
  if (!ok && opts?.previousAttachments) {
    host.chatAttachments = opts.previousAttachments;
  }
  if (!ok && opts?.previousQuoteDraft !== undefined) {
    host.chatQuoteDraft = opts.previousQuoteDraft;
  }
  if (ok) {
    setLastActiveChatSession(host);
  }
  if (ok && opts?.restoreDraft && opts.previousDraft?.trim()) {
    host.chatMessage = opts.previousDraft;
  }
  if (ok && opts?.restoreAttachments && opts.previousAttachments?.length) {
    host.chatAttachments = opts.previousAttachments;
  }
  scheduleChatScroll(adaptScrollHost(host));
  if (ok && !host.chatRunId) {
    void flushChatQueue(host);
  }
  if (ok && opts?.refreshSessions && runId) {
    host.refreshSessionsAfterChat.add(runId);
  }
  return ok;
}

async function flushChatQueue(host: ChatSendHost) {
  if (!host.connected || isChatBusy(host)) {
    return;
  }
  const [next, ...rest] = host.chatQueue;
  if (!next) {
    return;
  }
  host.chatQueue = rest;
  const ok = await sendChatMessageNow(host, next.text, {
    attachments: next.attachments,
    refreshSessions: next.refreshSessions,
  });
  if (!ok) {
    host.chatQueue = [next, ...host.chatQueue];
  }
}

export function removeQueuedMessage(host: Pick<ChatSendHost, "chatQueue">, id: string) {
  host.chatQueue = host.chatQueue.filter((item) => item.id !== id);
}

function mentionsForComposerSend(
  host: ChatSendHost,
  message: string,
): MentionMetadata[] | undefined {
  if (!message.includes("@")) {
    return undefined;
  }
  const extra = host as ChatSendHost & {
    platformAuthState?: {
      members?: Array<{
        user: string;
        userId?: string;
        displayName?: string;
        status?: "active" | "suspended";
      }> | null;
      employeeAccess?: { employeeUserId?: string | null; ownedAgentIds?: string[] | null } | null;
      session?: { user?: string | null; email?: string | null } | null;
    } | null;
    agentsList?: {
      agents?: Array<{
        id: string;
        name?: string | null;
        ownerId?: string | null;
        identity?: { name?: string | null } | null;
      }>;
    } | null;
    workbenchCollaborationOrgBotDirectory?: Array<{
      agentId: string;
      label: string;
      ownerUserId: string | null;
    }> | null;
    hello?: {
      auth?: { user?: string | null; email?: string | null } | null;
      snapshot?: unknown;
    } | null;
    bootstrapAuthSession?: { user?: string | null; email?: string | null } | null;
    workbenchTeamSelectedKey?: string | null;
    collaborationSpacesResult?: {
      spaces?: Array<{
        id?: string | null;
        groupId?: string | null;
        coordinatorBotId?: string | null;
        members?: {
          humans?: Array<{ userId: string; name?: string | null; status?: string | null }>;
          bots?: Array<{
            agentId: string;
            name?: string | null;
            status?: string | null;
            runtimeStatus?: "online" | "busy" | "offline" | "unknown" | null;
            currentTask?: string | null;
          }>;
        } | null;
      }>;
    } | null;
    userOperationalIdentities?: {
      identities?: Array<{
        identityId?: string | null;
        provider?: string | null;
        providerLabel?: string | null;
        displayName?: string | null;
        status?: string | null;
      }> | null;
    } | null;
    toolsCatalogResult?: {
      groups?: Array<{
        id?: string | null;
        label?: string | null;
        source?: string | null;
        pluginId?: string | null;
      }> | null;
    } | null;
  };
  const access = extra.platformAuthState?.employeeAccess;
  const session = extra.platformAuthState?.session;
  const candidates = buildMentionCandidatesForComposer({
    sessionKey: resolveWorkbenchChatSessionKey({
      selectedKey: extra.workbenchTeamSelectedKey,
      sessionKey: host.sessionKey,
    }),
    sessionDefaults: resolveStewardSessionDefaultsFromHello(extra.hello),
    selfUserId: access?.employeeUserId,
    spaces: extra.collaborationSpacesResult?.spaces,
    directory: {
      humans: extra.platformAuthState?.members,
      ownedAgentIds: access?.ownedAgentIds,
      actorIdentities: [
        access?.employeeUserId,
        session?.user,
        session?.email,
        extra.hello?.auth?.user,
        extra.hello?.auth?.email,
        extra.bootstrapAuthSession?.user,
        extra.bootstrapAuthSession?.email,
      ],
      robots: [
        ...(extra.workbenchCollaborationOrgBotDirectory ?? []).map((bot) => ({
          agentId: bot.agentId,
          displayName: bot.label,
          ownerUserId: bot.ownerUserId,
        })),
        ...(extra.agentsList?.agents ?? []).map((agent) => ({
          agentId: agent.id,
          displayName: agent.identity?.name?.trim() || agent.name?.trim() || agent.id,
          ownerUserId: agent.ownerId,
        })),
      ],
      plugins: collectComposerPluginMentionEntries({
        operationalIdentities: extra.userOperationalIdentities?.identities,
        pluginToolGroups: extra.toolsCatalogResult?.groups,
      }),
    },
  });
  const mentions = buildMentionsFromMessage(message, candidates);
  return mentions.length > 0 ? mentions : undefined;
}

export async function handleSendChat(
  host: ChatSendHost,
  messageOverride?: string,
  opts?: {
    restoreDraft?: boolean;
    mentions?: MentionMetadata[];
  } & Pick<
    ChatSendOptions,
    | "contextScope"
    | "cronReplyContext"
    | "growthGateProceed"
    | "focusSwitchProceed"
    | "focusSwitchCancel"
    | "suppressOptimisticUserMessage"
    | "stewardCallAuthorizationId"
    | "idempotencyKey"
  >,
) {
  if (!host.connected) {
    return;
  }
  const previousDraft = host.chatMessage;
  const previousQuoteDraft = messageOverride == null ? (host.chatQuoteDraft ?? null) : null;
  const quote = previousQuoteDraft;
  const rawSource = messageOverride ?? host.chatMessage;
  const sourceAttachments = host.chatAttachments ?? [];
  const expanded =
    messageOverride == null
      ? expandFoldedPastesIntoMessage(rawSource, sourceAttachments)
      : { message: rawSource, attachments: [] as ChatAttachment[] };
  const raw = expanded.message;
  const body = raw.trim();
  const displayMessage = (quote ? composeQuotedUserMessage(quote, raw) : raw).trim();
  const attachmentsToSend = messageOverride == null ? expanded.attachments : [];
  const hasAttachments = attachmentsToSend.length > 0;

  // Allow sending with just attachments (no message text required)
  if (!displayMessage && !hasAttachments) {
    return;
  }

  if (isChatStopCommand(displayMessage)) {
    await handleAbortChat(host);
    return;
  }

  if (isChatUndoCommand(displayMessage)) {
    await handleUndoChat(host);
    return;
  }

  const refreshSessions = isChatResetCommand(displayMessage);
  if (messageOverride == null) {
    host.chatMessage = "";
    // Clear attachments when sending
    host.chatAttachments = [];
    host.chatQuoteDraft = null;
  }

  if (isChatBusy(host)) {
    enqueueChatMessage(host, displayMessage, attachmentsToSend, refreshSessions);
    return;
  }

  await sendChatMessageNow(host, body, {
    composerQuote: quote ?? undefined,
    displayMessage,
    previousDraft: messageOverride == null ? previousDraft : undefined,
    restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
    previousQuoteDraft: messageOverride == null ? previousQuoteDraft : undefined,
    attachments: hasAttachments ? attachmentsToSend : undefined,
    previousAttachments: messageOverride == null ? sourceAttachments : undefined,
    restoreAttachments: Boolean(messageOverride && opts?.restoreDraft),
    refreshSessions,
    cronReplyContext: opts?.cronReplyContext,
    contextScope: opts?.contextScope,
    mentions: opts?.mentions ?? mentionsForComposerSend(host, body),
    growthGateProceed: opts?.growthGateProceed,
    focusSwitchProceed: opts?.focusSwitchProceed,
    focusSwitchCancel: opts?.focusSwitchCancel,
    suppressOptimisticUserMessage: opts?.suppressOptimisticUserMessage,
    stewardCallAuthorizationId: opts?.stewardCallAuthorizationId,
    idempotencyKey: opts?.idempotencyKey,
  });
}

export type ChatRefreshHostWithCheckpoints = ChatRefreshHost & {
  /** Inline checkpoint dividers; must refresh on connect/tab refresh, not only turn reload. */
  loadChatCheckpoints?: () => Promise<void>;
};

export async function refreshChat(
  host: ChatRefreshHostWithCheckpoints,
  opts?: { scheduleScroll?: boolean },
) {
  const tasks: Promise<unknown>[] = [
    chatCapability.loadHistory(adaptChatHistoryCapabilityState(host), {
      // Connect / hard refresh may restore 电脑. Session switch must not.
      forceOpenComputerPreview: true,
    }),
    sessionsCapability.load(adaptSessionsLoadCapabilityState(host), {
      activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
    }),
    refreshChatAvatar(host),
  ];
  // Connect / tab refresh used to skip this; after gateway restart the SPA then
  // showed either stale dividers or none at all (no chat.checkpoints.list).
  if (typeof host.loadChatCheckpoints === "function") {
    tasks.push(host.loadChatCheckpoints());
  }
  await Promise.all(tasks);
  if (opts?.scheduleScroll !== false) {
    scheduleChatScroll(adaptScrollHost(host));
  }
}

export const flushChatQueueForEvent = flushChatQueue;

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
};

function resolveAgentIdForSession(host: ChatAvatarHost): string | null {
  const parsed = parseAgentSessionKey(host.sessionKey);
  if (parsed?.agentId) {
    return parsed.agentId;
  }
  const snapshot = host.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const fallback = snapshot?.sessionDefaults?.defaultAgentId?.trim();
  return fallback || "main";
}

function buildAvatarMetaUrl(basePath: string, agentId: string): string {
  const base = normalizeBasePath(basePath);
  const encoded = encodeURIComponent(agentId);
  return base ? `${base}/avatar/${encoded}?meta=1` : `/avatar/${encoded}?meta=1`;
}

export async function refreshChatAvatar(host: ChatAvatarHost) {
  if (!host.connected) {
    host.chatAvatarUrl = null;
    return;
  }
  const agentId = resolveAgentIdForSession(host);
  if (!agentId) {
    host.chatAvatarUrl = null;
    return;
  }
  host.chatAvatarUrl = null;
  const url = buildAvatarMetaUrl(host.basePath, agentId);
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      host.chatAvatarUrl = null;
      return;
    }
    const data = (await res.json()) as { avatarUrl?: unknown };
    const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() : "";
    host.chatAvatarUrl = avatarUrl || null;
  } catch {
    host.chatAvatarUrl = null;
  }
}

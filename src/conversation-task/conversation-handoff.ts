/**
 * Grok-style 1:1 robot conversation: @mention or conversation_send
 * wakes an existing agent:<id>:main session. Not a collaboration group,
 * not generic tools.agentToAgent, not user.daibai.ask/execute.
 */
import fs from "node:fs";
import path from "node:path";
import { isBuiltinStewardAgent } from "../agents/builtin-steward/identity.js";
import { readLatestAssistantReply } from "../agents/tools/agent-step.js";
import { loadSessionStore, resolveSessionFilePath } from "../config/sessions.js";
import {
  canDispatchDiagnoseAction,
  defaultSessionExists,
  dispatchDiagnoseConversationAction,
  type DiagnoseActionDispatchResult,
} from "../diagnosis/diagnose-action-dispatch.js";
import {
  extractEmployeeStewardUserId,
  listOwnedDiagnoseAgentIds,
} from "../diagnosis/diagnose-conversation.js";
import { extractDiagnoseSpaceGroupId } from "../diagnosis/diagnose-policy.js";
import { listAgentAssets } from "../gateway/agent-registry/registry.js";
import { loadAgentRegistryStore } from "../gateway/agent-registry/store.js";
import { callGateway } from "../gateway/call.js";
import { findActiveOwnershipRecord } from "../gateway/ownership-store.js";
import type { GatewayClient } from "../gateway/server-methods/types.js";
import { buildSessionStorePathResolver } from "../gateway/tenant-context.js";
import { normalizeInputProvenance } from "../sessions/input-provenance.js";

export const CONVERSATION_SEND_TOOL = "conversation_send" as const;

export type ConversationPeer = {
  agentId: string;
  displayName: string;
  sessionKey: string;
  sessionExists: boolean;
};

export function defaultConversationSessionKey(agentId: string): string {
  return `agent:${agentId.trim()}:main`;
}

/**
 * The latest user turn's sender session, when that turn was written by another robot.
 * An owner turn after that returns undefined so a later send still wakes normally.
 */
export function latestInboundInterSessionSource(transcript: string): string | undefined {
  const lines = transcript.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (!line) {
      continue;
    }
    let parsed: { message?: { role?: unknown; provenance?: unknown } };
    try {
      parsed = JSON.parse(line) as { message?: { role?: unknown; provenance?: unknown } };
    } catch {
      continue;
    }
    const message = parsed.message;
    if (!message || message.role !== "user") {
      continue;
    }
    const provenance = normalizeInputProvenance(message.provenance);
    if (provenance?.kind === "inter_session" && provenance.sourceSessionKey) {
      return provenance.sourceSessionKey;
    }
    return undefined;
  }
  return undefined;
}

/** A robot's answer already written into the requester transcript during this send. */
export function isFreshPeerReturn(
  message: unknown,
  fromSessionKey: string,
  sinceMs: number,
): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const record = message as { role?: unknown; timestamp?: unknown; provenance?: unknown };
  if (record.role !== "user") {
    return false;
  }
  const provenance = normalizeInputProvenance(record.provenance);
  if (
    !provenance ||
    provenance.kind !== "inter_session" ||
    provenance.sourceTool !== CONVERSATION_SEND_TOOL ||
    provenance.sourceSessionKey !== fromSessionKey
  ) {
    return false;
  }
  return typeof record.timestamp === "number" && record.timestamp >= sinceMs;
}

/** A peer is reachable only when its transcript file is on disk, not a stale store pointer. */
export function conversationTranscriptExists(
  storePath: string,
  entry: { sessionId?: string; sessionFile?: string } | undefined,
): boolean {
  const sessionId = entry?.sessionId?.trim();
  if (!sessionId) {
    return false;
  }
  try {
    // Match the chat reader/writer boundary. A stale/out-of-root pointer may
    // resolve only to this current sessionId in the authorized store directory.
    // Never treat another root's existing transcript or a directory as a peer.
    const file = resolveSessionFilePath(sessionId, entry, {
      sessionsDir: path.dirname(storePath),
    });
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Peer lookup for a logged-in owner uses that owner's tenant session store.
 * The process-global store can still name a session whose file was never written there.
 */
export async function resolveConversationSessionExists(
  client: GatewayClient | null,
): Promise<(agentId: string, sessionKey: string) => boolean> {
  if (!client?.user?.trim() && !client?.platformUserId?.trim()) {
    return defaultSessionExists;
  }
  try {
    const resolveStore = await buildSessionStorePathResolver(client);
    return (agentId, sessionKey) => {
      try {
        const storePath = resolveStore(agentId);
        const store = loadSessionStore(storePath, { skipCache: true });
        return conversationTranscriptExists(storePath, store[sessionKey]);
      } catch {
        return false;
      }
    };
  } catch {
    return defaultSessionExists;
  }
}

export function isGroupConversationKey(sessionKey: string): boolean {
  const raw = sessionKey.trim();
  return Boolean(extractDiagnoseSpaceGroupId(raw) || raw.includes(":space:"));
}

export function parseConversationAtMentions(text: string): string[] {
  const found: string[] = [];
  // An address in user content is data, never an instruction to route to its domain.
  const mentionText = text.replace(
    /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi,
    " ",
  );
  const re = /@([^\s@]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(mentionText))) {
    const token = match[1]?.trim();
    if (token) {
      found.push(token);
    }
  }
  return found;
}

function normalizePeerToken(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "");
}

function peerIdentityTokens(peer: ConversationPeer): string[] {
  return [peer.agentId, peer.displayName, peer.sessionKey].map(normalizePeerToken);
}

export function resolveConversationPeer(
  query: string,
  peers: ConversationPeer[],
): ConversationPeer | null {
  const needle = normalizePeerToken(query);
  if (!needle) {
    return null;
  }
  const exact = peers.filter((peer) => peerIdentityTokens(peer).includes(needle));
  if (exact.length === 1) {
    return exact[0] ?? null;
  }
  if (exact.length > 1) {
    return null;
  }
  const fuzzy = peers.filter((peer) =>
    peerIdentityTokens(peer).some((id) => id.includes(needle) || needle.includes(id)),
  );
  return fuzzy.length === 1 ? (fuzzy[0] ?? null) : null;
}

export function collectConversationMentionTokens(input: {
  messageText: string;
  mentions?: Array<{
    agentId?: string;
    displayName?: string;
    target?: { kind?: string; agentId?: string };
  }>;
}): string[] {
  const tokens = new Set<string>();
  for (const mention of input.mentions ?? []) {
    if (
      mention.target?.kind === "human" ||
      mention.target?.kind === "all" ||
      mention.target?.kind === "plugin"
    ) {
      continue;
    }
    if (mention.agentId?.trim()) {
      tokens.add(mention.agentId.trim());
    }
    if (mention.displayName?.trim()) {
      tokens.add(mention.displayName.trim());
    }
    if (mention.target?.kind === "agent" && mention.target.agentId?.trim()) {
      tokens.add(mention.target.agentId.trim());
    }
  }
  for (const token of parseConversationAtMentions(input.messageText)) {
    tokens.add(token);
  }
  return [...tokens];
}

export function stripResolvedAtMentions(text: string, tokens: string[]): string {
  let next = text;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`@${escaped}\\s*`, "g"), "");
  }
  return next.replace(/\s+/g, " ").trim();
}

/** User-visible guest text is the message itself. Routing rules stay in the system prompt. */
export function buildGuestTaskMessage(input: {
  hostSessionKey: string;
  guestDisplayName: string;
  task: string;
}): string {
  void input.hostSessionKey;
  void input.guestDisplayName;
  return input.task.trim();
}

export function buildHostSendReceipt(input: {
  guestDisplayName: string;
  guestSessionKey: string;
  task: string;
}): string {
  void input.guestSessionKey;
  void input.task;
  return `已发给${input.guestDisplayName}。`;
}

export function buildHostFailReceipt(input: { guestLabel: string; reason: string }): string {
  void input.reason;
  return `没发给${input.guestLabel}。`;
}

export function buildHostReturnReceipt(input: {
  guestAgentId: string;
  guestSessionKey: string;
  reply: string;
}): string {
  void input.guestAgentId;
  void input.guestSessionKey;
  return input.reply.trim();
}

/** A short question is a confirmation request. A long reply is the result. */
export function conversationReplyNeedsConfirmation(reply: string): boolean {
  const text = reply.trim();
  if (!text || text.length > 240) {
    return false;
  }
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length > 3) {
    return false;
  }
  return /[?？]/.test(text);
}

export async function listConversationPeers(input: {
  tenantId: string;
  requesterUserId: string;
  tenantAdmin: boolean;
  sessionExists?: (agentId: string, sessionKey: string) => boolean;
  includeMissingSessions?: boolean;
}): Promise<ConversationPeer[]> {
  const tenantId = input.tenantId.trim();
  const requesterUserId = input.requesterUserId.trim();
  if (!tenantId || !requesterUserId) {
    return [];
  }
  const store = await loadAgentRegistryStore();
  const owned = new Set(
    listOwnedDiagnoseAgentIds({ userId: requesterUserId, tenantId }).map((id) => id.trim()),
  );
  const exists = input.sessionExists ?? defaultSessionExists;
  const peers: ConversationPeer[] = [];
  for (const asset of listAgentAssets(store, tenantId)) {
    const agentId = asset.legacyAgentId?.trim() || "";
    if (!agentId || isBuiltinStewardAgent(agentId)) {
      continue;
    }
    // Ordinary assistants stay same-user. Tenant admin does not list other people's bots.
    void input.tenantAdmin;
    if (!owned.has(agentId)) {
      continue;
    }
    const sessionKey = defaultConversationSessionKey(agentId);
    if (isGroupConversationKey(sessionKey)) {
      continue;
    }
    const sessionExists = exists(agentId, sessionKey);
    if (!sessionExists && !input.includeMissingSessions) {
      continue;
    }
    peers.push({
      agentId,
      displayName: asset.displayName.trim() || agentId,
      sessionKey,
      sessionExists,
    });
  }
  return peers;
}

export function canSendConversationHandoff(input: {
  requesterUserId: string;
  tenantId: string | null;
  tenantAdmin: boolean;
  targetAgentId: string;
  callerAgentId?: string;
}): boolean {
  // Tenant-admin conversation handoff must not reach another user's assistant.
  void input.tenantAdmin;
  if (
    canDispatchDiagnoseAction({
      targetAgentId: input.targetAgentId,
      requesterUserId: input.requesterUserId,
      tenantId: input.tenantId,
      tenantAdmin: false,
    })
  ) {
    return true;
  }
  const tenantId = input.tenantId?.trim();
  const callerAgentId = input.callerAgentId?.trim();
  const targetAgentId = input.targetAgentId.trim();
  if (!tenantId || !callerAgentId || !targetAgentId || isBuiltinStewardAgent(callerAgentId)) {
    return false;
  }
  const callerOwner = findActiveOwnershipRecord({
    tenantId,
    subjectKind: "agent",
    subjectId: callerAgentId,
  })?.currentManagerUserId;
  const targetOwner = findActiveOwnershipRecord({
    tenantId,
    subjectKind: "agent",
    subjectId: targetAgentId,
  })?.currentManagerUserId;
  return Boolean(callerOwner && targetOwner && callerOwner === targetOwner);
}

export async function dispatchConversationHandoff(input: {
  title: string;
  message: string;
  targetAgentId: string;
  requesterUserId: string;
  tenantId: string | null;
  tenantAdmin: boolean;
  callerAgentId?: string;
  fromDisplayName?: string;
  waitForReply?: boolean;
  injectReply?: boolean;
  sessionExists?: (agentId: string, sessionKey: string) => boolean;
}): Promise<DiagnoseActionDispatchResult & { reply?: string; answerInChat?: boolean }> {
  if (
    !canSendConversationHandoff({
      requesterUserId: input.requesterUserId,
      tenantId: input.tenantId,
      tenantAdmin: input.tenantAdmin,
      targetAgentId: input.targetAgentId,
      callerAgentId: input.callerAgentId,
    })
  ) {
    return { ok: false, reason: "unauthorized" };
  }
  const callerAgentId = input.callerAgentId?.trim() ?? "";
  const requesterSessionKey =
    callerAgentId && !isBuiltinStewardAgent(callerAgentId)
      ? defaultConversationSessionKey(callerAgentId)
      : undefined;
  const targetSessionKey = defaultConversationSessionKey(input.targetAgentId);
  const startedAt = Date.now();
  const result = await dispatchDiagnoseConversationAction({
    title: input.title,
    agentPrompt: input.message.trim(),
    targetAgentId: input.targetAgentId,
    targetSessionKey,
    requesterUserId: input.requesterUserId,
    tenantId: input.tenantId,
    tenantAdmin: input.tenantAdmin,
    requesterSessionKey,
    sessionExists: input.sessionExists,
    omitReceipt: true,
    plainConversation: true,
    fromDisplayName: input.fromDisplayName,
  });
  if (!result.ok || !input.waitForReply || !result.runId || !result.targetSessionKey) {
    return result;
  }
  const reply = await waitConversationReply({
    runId: result.runId,
    afterMs: startedAt,
    targetSessionKey: result.targetSessionKey,
    sessionOwnerPlatformUserId: input.requesterUserId,
  });
  if (result.requesterSessionKey) {
    const answerInChat = await requesterHasFreshPeerReturn({
      sessionKey: result.requesterSessionKey,
      fromSessionKey: result.targetSessionKey,
      sinceMs: startedAt,
      sessionOwnerPlatformUserId: input.requesterUserId,
    }).catch(() => false);
    if (answerInChat) {
      return { ...result, answerInChat: true };
    }
  }
  if (reply && input.injectReply !== false && result.requesterSessionKey) {
    await injectConversationReply({
      sessionKey: result.requesterSessionKey,
      targetSessionKey: result.targetSessionKey,
      targetAgentId: input.targetAgentId,
      reply,
    }).catch(() => undefined);
  }
  return { ...result, reply };
}

export async function waitConversationReply(input: {
  runId: string;
  targetSessionKey: string;
  timeoutMs?: number;
  sessionOwnerPlatformUserId?: string;
  afterMs?: number;
}): Promise<string | undefined> {
  const waitMs = Math.min(input.timeoutMs ?? 45_000, 60_000);
  try {
    const wait = await callGateway<{ status?: string }>({
      method: "agent.wait",
      params: { runId: input.runId, timeoutMs: waitMs },
      timeoutMs: waitMs + 2000,
    });
    if (wait?.status !== "ok") {
      return undefined;
    }
  } catch {
    return undefined;
  }
  try {
    return await readLatestAssistantReply({
      sessionKey: input.targetSessionKey,
      sessionOwnerPlatformUserId: input.sessionOwnerPlatformUserId,
      afterMs: input.afterMs,
    });
  } catch {
    return undefined;
  }
}

export type StewardHostGuestRouteResult = {
  handledRobotTask: boolean;
  dispatched: number;
  failed: number;
};

type HostNoticeInject = (input: {
  sessionKey: string;
  text: string;
  label: string;
}) => Promise<void>;

async function defaultHostNoticeInject(input: {
  sessionKey: string;
  text: string;
  label: string;
}): Promise<void> {
  const label = input.label.trim();
  await callGateway({
    method: "chat.inject",
    params: {
      sessionKey: input.sessionKey,
      message: input.text,
      ...(label ? { label } : {}),
    },
    timeoutMs: 20_000,
  });
}

function scheduleHostGuestReturn(input: {
  runId: string;
  hostSessionKey: string;
  guestSessionKey: string;
  guestAgentId: string;
  sessionOwnerPlatformUserId?: string;
  injectReply?: boolean;
  afterMs: number;
}): void {
  void (async () => {
    const reply = await waitConversationReply({
      runId: input.runId,
      afterMs: input.afterMs,
      targetSessionKey: input.guestSessionKey,
      sessionOwnerPlatformUserId: input.sessionOwnerPlatformUserId,
    });
    if (!reply || input.injectReply === false) {
      return;
    }
    await injectConversationReply({
      sessionKey: input.hostSessionKey,
      targetSessionKey: input.guestSessionKey,
      targetAgentId: input.guestAgentId,
      reply,
    }).catch(() => undefined);
  })().catch(() => undefined);
}

type StewardMentionInput = {
  agentId?: string;
  displayName?: string;
  targetKind?: string;
  targetId?: string;
  target?: { kind?: string; agentId?: string; userId?: string };
};

type StewardHumanMention = {
  userId: string;
  displayName: string;
  tokens: string[];
};

function mentionTokenKey(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "");
}

function extractStewardHumanMentions(
  mentions: readonly StewardMentionInput[] | undefined,
): StewardHumanMention[] {
  const humans: StewardHumanMention[] = [];
  for (const mention of mentions ?? []) {
    const kind = mention.target?.kind ?? mention.targetKind;
    if (kind !== "human") {
      continue;
    }
    const userId = (mention.target?.userId ?? mention.targetId ?? "").trim();
    if (!userId) {
      continue;
    }
    const displayName = mention.displayName?.trim() || userId;
    humans.push({
      userId,
      displayName,
      tokens: [displayName, userId].filter(Boolean),
    });
  }
  return humans;
}

async function notifyTenantHumanMention(input: {
  tenantId: string;
  requesterUserId: string;
  userId: string;
  message: string;
  fromAgentId?: string;
  fromSessionKey?: string;
}): Promise<boolean> {
  const { listTenantHumans, recordTenantHumanNotice } =
    await import("../organization/tenant-human-notice.js");
  const { loadPlatformAuthStoreForDiagnosis } =
    await import("../diagnosis/diagnose-growth-locator.js");
  const store = await loadPlatformAuthStoreForDiagnosis();
  if (!store) {
    return false;
  }
  const humans = listTenantHumans(store, input.tenantId);
  const needle = input.userId.trim().toLowerCase();
  const recipient = humans.find(
    (human) =>
      human.userId.trim().toLowerCase() === needle || human.email.trim().toLowerCase() === needle,
  );
  if (!recipient) {
    return false;
  }
  recordTenantHumanNotice({
    tenantId: input.tenantId,
    recipient,
    message: input.message,
    senderUserId: input.requesterUserId,
    ...(input.fromAgentId?.trim() ? { fromAgentId: input.fromAgentId.trim() } : {}),
    ...(input.fromSessionKey?.trim() ? { fromSessionKey: input.fromSessionKey.trim() } : {}),
  });
  return true;
}

export async function routeStewardConversationMentions(input: {
  sessionKey: string;
  messageText: string;
  mentions?: StewardMentionInput[];
  requesterUserId: string | null;
  tenantId: string | null;
  tenantAdmin: boolean;
  listPeers?: typeof listConversationPeers;
  dispatch?: typeof dispatchConversationHandoff;
  injectHostNotice?: HostNoticeInject;
  notifyHuman?: (notice: {
    tenantId: string;
    requesterUserId: string;
    userId: string;
    displayName: string;
    message: string;
    fromAgentId?: string;
    fromSessionKey?: string;
  }) => Promise<boolean> | boolean;
}): Promise<StewardHostGuestRouteResult> {
  const empty = { handledRobotTask: false, dispatched: 0, failed: 0 };
  const sessionKey = input.sessionKey.trim();
  if (!sessionKey || isGroupConversationKey(sessionKey)) {
    return empty;
  }
  const stewardUserId = extractEmployeeStewardUserId(sessionKey);
  if (!stewardUserId) {
    return empty;
  }
  const humanMentions = extractStewardHumanMentions(input.mentions);
  const humanTokenKeys = new Set(
    humanMentions.flatMap((mention) => mention.tokens.map((token) => mentionTokenKey(token))),
  );
  const tokens = collectConversationMentionTokens({
    messageText: input.messageText,
    mentions: input.mentions,
  });
  const robotTokens = tokens.filter((token) => !humanTokenKeys.has(mentionTokenKey(token)));
  const message = input.messageText.trim();
  if (!message || tokens.length === 0) {
    return empty;
  }
  const requesterUserId = input.requesterUserId?.trim() || stewardUserId;
  const tenantId = input.tenantId?.trim() || null;
  const injectNotice = input.injectHostNotice ?? defaultHostNoticeInject;
  const dispatch = input.dispatch ?? dispatchConversationHandoff;
  if (!tenantId) {
    await injectNotice({
      sessionKey,
      label: "",
      text: buildHostFailReceipt({
        guestLabel: tokens.join("、"),
        reason: "租户未确认，任务未发出",
      }),
    }).catch(() => undefined);
    return { handledRobotTask: true, dispatched: 0, failed: tokens.length };
  }
  const listPeers = input.listPeers ?? listConversationPeers;
  const directory = await listPeers({
    tenantId,
    requesterUserId,
    tenantAdmin: input.tenantAdmin,
    includeMissingSessions: true,
  });
  const reachable = directory.filter((peer) => peer.sessionExists);
  let dispatched = 0;
  let failed = 0;
  const seen = new Set<string>();
  let humanHandled = 0;
  const notifyHuman = input.notifyHuman ?? notifyTenantHumanMention;
  if (tenantId && humanMentions.length > 0) {
    const noticeMessage =
      stripResolvedAtMentions(
        message,
        humanMentions.flatMap((mention) => mention.tokens),
      ) || message;
    for (const mention of humanMentions) {
      const fromAgentId = sessionKey.startsWith("agent:")
        ? sessionKey.slice("agent:".length).split(":")[0] || undefined
        : undefined;
      const delivered = await notifyHuman({
        tenantId,
        requesterUserId,
        userId: mention.userId,
        displayName: mention.displayName,
        message: noticeMessage,
        ...(fromAgentId ? { fromAgentId } : {}),
        fromSessionKey: sessionKey,
      });
      if (!delivered) {
        failed += 1;
        await injectNotice({
          sessionKey,
          label: "",
          text: buildHostFailReceipt({
            guestLabel: mention.displayName,
            reason: "不在当前企业租户",
          }),
        }).catch(() => undefined);
        continue;
      }
      humanHandled += 1;
      await injectNotice({
        sessionKey,
        label: "",
        text: `已发给${mention.displayName}。`,
      }).catch(() => undefined);
    }
  }
  for (const token of robotTokens) {
    const intended = resolveConversationPeer(token, directory);
    if (!intended) {
      continue;
    }
    if (seen.has(intended.agentId)) {
      continue;
    }
    seen.add(intended.agentId);
    if (!intended.sessionExists) {
      failed += 1;
      await injectNotice({
        sessionKey,
        label: "",
        text: buildHostFailReceipt({
          guestLabel: intended.displayName,
          reason: "客会话不存在，未唤醒",
        }),
      }).catch(() => undefined);
      continue;
    }
    const live = resolveConversationPeer(token, reachable) ?? intended;
    const task = stripResolvedAtMentions(message, robotTokens) || message;
    const startedAt = Date.now();
    const result = await dispatch({
      title: `对话：${live.displayName}`,
      message: task,
      targetAgentId: live.agentId,
      requesterUserId,
      tenantId,
      tenantAdmin: input.tenantAdmin,
      waitForReply: false,
      injectReply: false,
    });
    if (!result.ok || !result.runId || !result.targetSessionKey) {
      failed += 1;
      await injectNotice({
        sessionKey,
        label: "",
        text: buildHostFailReceipt({
          guestLabel: live.displayName,
          reason: result.reason || "不可达",
        }),
      }).catch(() => undefined);
      continue;
    }
    dispatched += 1;
    await postConversationOutboundLine({
      sessionKey,
      message: task,
      targets: [
        {
          agentId: live.agentId,
          label: live.displayName,
          sessionKey: live.sessionKey,
        },
      ],
      sessionOwnerPlatformUserId: requesterUserId,
    }).catch(() => undefined);
    scheduleHostGuestReturn({
      runId: result.runId,
      afterMs: startedAt,
      hostSessionKey: result.requesterSessionKey ?? sessionKey,
      guestSessionKey: result.targetSessionKey,
      guestAgentId: live.agentId,
      sessionOwnerPlatformUserId: requesterUserId,
    });
  }
  if (dispatched === 0 && failed === 0 && humanHandled === 0) {
    await injectNotice({
      sessionKey,
      label: "",
      text: buildHostFailReceipt({
        guestLabel: robotTokens.join("、") || tokens.join("、"),
        reason: "找不到可唤醒的数字人，任务未发出",
      }),
    }).catch(() => undefined);
    return { handledRobotTask: true, dispatched: 0, failed: robotTokens.length || tokens.length };
  }
  return {
    handledRobotTask: dispatched > 0 || failed > 0 || humanHandled > 0,
    dispatched,
    failed,
  };
}

export async function postConversationPeerLine(input: {
  sessionKey: string;
  message: string;
  senderLabel: string;
  sourceSessionKey: string;
  sessionOwnerPlatformUserId?: string;
}): Promise<void> {
  await callGateway({
    method: "chat.inject",
    params: {
      sessionKey: input.sessionKey,
      message: input.message.trim(),
      peerDelivery: true,
      senderLabel: input.senderLabel,
      sourceSessionKey: input.sourceSessionKey,
      ...(input.sessionOwnerPlatformUserId
        ? { sessionOwnerPlatformUserId: input.sessionOwnerPlatformUserId }
        : {}),
    },
    timeoutMs: 20_000,
  });
}

/** Record a successful 1:1 send on the sender transcript (`sentTo`), not as owner prose. */
export async function postConversationOutboundLine(input: {
  sessionKey: string;
  message: string;
  targets: Array<{ agentId?: string; label: string; sessionKey?: string }>;
  sessionOwnerPlatformUserId?: string;
}): Promise<void> {
  const sessionKey = input.sessionKey.trim();
  const message = input.message.trim();
  const sentTo = input.targets.flatMap((target) => {
    const label = target.label.trim();
    if (!label) {
      return [];
    }
    const agentId = target.agentId?.trim();
    const targetSessionKey = target.sessionKey?.trim();
    return [
      {
        label,
        ...(agentId ? { agentId } : {}),
        ...(targetSessionKey ? { sessionKey: targetSessionKey } : {}),
      },
    ];
  });
  if (!sessionKey || !message || sentTo.length === 0) {
    return;
  }
  await callGateway({
    method: "chat.inject",
    params: {
      sessionKey,
      message,
      peerOutbound: true,
      sentTo,
      ...(input.sessionOwnerPlatformUserId
        ? { sessionOwnerPlatformUserId: input.sessionOwnerPlatformUserId }
        : {}),
    },
    timeoutMs: 20_000,
  });
}

async function requesterHasFreshPeerReturn(input: {
  sessionKey: string;
  fromSessionKey: string;
  sinceMs: number;
  sessionOwnerPlatformUserId?: string;
}): Promise<boolean> {
  const history = await callGateway<{ messages?: unknown[] }>({
    method: "chat.history",
    params: {
      sessionKey: input.sessionKey,
      limit: 30,
      ...(input.sessionOwnerPlatformUserId
        ? { sessionOwnerPlatformUserId: input.sessionOwnerPlatformUserId }
        : {}),
    },
    timeoutMs: 20_000,
  });
  const messages = Array.isArray(history?.messages) ? history.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isFreshPeerReturn(messages[i], input.fromSessionKey, input.sinceMs)) {
      return true;
    }
  }
  return false;
}

export async function injectConversationReply(input: {
  sessionKey: string;
  targetSessionKey: string;
  targetAgentId: string;
  reply: string;
}): Promise<void> {
  void input.targetSessionKey;
  void input.targetAgentId;
  await callGateway({
    method: "chat.inject",
    params: {
      sessionKey: input.sessionKey,
      message: input.reply.trim(),
    },
    timeoutMs: 20_000,
  });
}

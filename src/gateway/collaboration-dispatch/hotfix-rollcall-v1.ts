/**
 * // v1-only — Floor Runtime v2.1 §5.4 P0.2 (Q1 = B): 15:13 v1-only roll-call hotfix.
 *
 * Ops allow-list: collaboration.hotfix.v1RollCallGroups (tenantId/groupId entries).
 * Empty / unset = baseline (zero behavior change). Remove a group to roll back.
 * Delete this file and every // v1-only call site in P3 once Floor roll_call is live;
 * lint must then assert // v1-only count is 0.
 */

import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { CollaborationExecutionRecord } from "../collaboration-ledger/types.js";
import { SYSTEM_INVARIANTS } from "./effective-policy.js";
import {
  isIntroductionFollowUpMessage,
  resolveBotsAlreadyIntroducedInThread,
} from "./group-inbound-history.js";
import { normalizeAgentIdentifier } from "./mention-utils.js";
import { buildCollaborationRoundPlan } from "./round-plan.js";
import type { RuntimeFacts } from "./runtime-authority.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
  ParticipationDecision,
  RoundPlanAlert,
} from "./types.js";
import {
  isPresenceCheckMessage,
  shouldBroadcastPresenceOrIntroduction,
} from "./visible-reply-limit.js";

/** Format required by §5.4: tenantId/groupId. */
export type V1RollCallGroupKey = `${string}/${string}`;

const ROLL_CALL_VOCAB = [
  "点名",
  "其他成员呢",
  "其它成员呢",
  "其他人员",
  "其它人员",
  "还有谁",
  "剩下的呢",
  "都说说",
  "轮流",
  "各自介绍",
  "各自说说",
  "大家各自",
  "分别介绍",
  "介绍一下自己",
  "介绍自己",
  "介绍下自己",
] as const;

const STOP_WORD_RE = /^(?:停|够了|别说了|\/stop)[!！.。…\s]*$/iu;

function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, "").trim().toLowerCase();
}

function extractMessageBody(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }
  if (!message || typeof message !== "object") {
    return "";
  }
  const record = message as {
    role?: string;
    content?: unknown;
    text?: unknown;
  };
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (Array.isArray(record.content)) {
    return record.content
      .map((block) => {
        if (!block || typeof block !== "object") {
          return "";
        }
        const typed = block as { type?: string; text?: string };
        return typed.type === "text" && typeof typed.text === "string" ? typed.text : "";
      })
      .join("");
  }
  return "";
}

/** Plan flag → config collaboration.hotfix.v1RollCallGroups (default empty = off). */
export function resolveV1RollCallGroups(cfg?: OpenBotConfig): string[] {
  const raw = (cfg ?? loadConfig()).collaboration?.hotfix?.v1RollCallGroups;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

export function parseV1RollCallGroupKey(
  entry: string,
): { tenantId: string; groupId: string } | null {
  const trimmed = entry.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    return null;
  }
  return {
    tenantId: trimmed.slice(0, slash),
    groupId: trimmed.slice(slash + 1),
  };
}

/**
 * True when (tenantId, groupId) is on the ops allow-list.
 * tenantId null/empty matches keys with tenant `*`, `001`, or `personal_local`
 * (Owner default-tenant-001 / personal_local layouts).
 */
export function isV1RollCallHotfixGroup(params: {
  tenantId?: string | null;
  groupId: string;
  cfg?: OpenBotConfig;
}): boolean {
  const groupId = params.groupId.trim();
  if (!groupId) {
    return false;
  }
  const tenantId = (params.tenantId ?? "").trim();
  const entries = resolveV1RollCallGroups(params.cfg);
  for (const entry of entries) {
    const parsed = parseV1RollCallGroupKey(entry);
    if (!parsed || parsed.groupId !== groupId) {
      continue;
    }
    if (parsed.tenantId === tenantId) {
      return true;
    }
    if (
      !tenantId &&
      (parsed.tenantId === "*" || parsed.tenantId === "001" || parsed.tenantId === "personal_local")
    ) {
      return true;
    }
    if (parsed.tenantId === "*") {
      return true;
    }
  }
  return false;
}

/** P0-3 vocabulary + presence/intro broadcast signals. */
export function isV1RollCallVocabMessage(message: string): boolean {
  const normalized = normalizeMessageText(message);
  if (!normalized || normalized.includes("@")) {
    return false;
  }
  if (isPresenceCheckMessage(message)) {
    return true;
  }
  return ROLL_CALL_VOCAB.some((signal) => normalized.includes(normalizeMessageText(signal)));
}

/** Prior human message was a roll-call trigger (continuation). */
export function isV1RollCallContinuation(
  message: string,
  recentGroupMessages?: unknown[],
): boolean {
  if (!recentGroupMessages?.length) {
    return false;
  }
  // Walk backwards for the latest human utterance.
  for (let i = recentGroupMessages.length - 1; i >= 0; i -= 1) {
    const entry = recentGroupMessages[i] as { role?: string } | undefined;
    if (!entry || entry.role !== "user") {
      continue;
    }
    const body = extractMessageBody(entry);
    if (!body.trim()) {
      continue;
    }
    return isV1RollCallVocabMessage(body) || shouldBroadcastPresenceOrIntroduction(body);
  }
  return false;
}

export function isV1RollCallTriggerMessage(
  message: string,
  recentGroupMessages?: unknown[],
  facts?: RuntimeFacts,
): boolean {
  if (shouldBroadcastPresenceOrIntroduction(message, facts)) {
    return true;
  }
  if (isV1RollCallVocabMessage(message)) {
    return true;
  }
  // Short follow-ups like 「其他成员呢」/「点名」 after a roll-call.
  if (
    (isIntroductionFollowUpMessage(message) || isV1RollCallVocabMessage(message)) &&
    isV1RollCallContinuation(message, recentGroupMessages)
  ) {
    return true;
  }
  // Bare 「点名」 / 「其他成员呢」 even without prior context (P0-3 beats ≤4 chitchat).
  const compact = normalizeMessageText(message);
  if (
    compact === "点名" ||
    compact === "其他成员呢" ||
    compact === "其它成员呢" ||
    compact === "还有谁" ||
    compact === "剩下的呢" ||
    compact === "都说说"
  ) {
    return true;
  }
  return false;
}

/** P0-9 stop words. */
export function isV1RollCallStopMessage(message: string): boolean {
  return STOP_WORD_RE.test(message.trim());
}

export function buildV1RollCallStopAck(): string {
  return "好的，本轮已停止，排队中的回复已取消。";
}

function isObserverBot(facts: RuntimeFacts, bot: CollaborationBotTarget): boolean {
  const agentId = normalizeAgentIdentifier(bot.agentId);
  if (!agentId) {
    return false;
  }
  return facts.memberRoleMap.some((entry) => {
    if (entry.memberKind !== "bot") {
      return false;
    }
    if (entry.governanceRole !== "observer") {
      return false;
    }
    const memberId = normalizeAgentIdentifier(entry.memberId) ?? entry.memberId;
    return (
      memberId === agentId ||
      memberId === `bot:${agentId}` ||
      memberId.endsWith(`:${agentId}`) ||
      entry.label === bot.agentId ||
      entry.label === bot.name
    );
  });
}

export function filterV1RollCallEligibleBots(params: {
  facts: RuntimeFacts;
  bots: CollaborationBotTarget[];
  message: string;
  recentGroupMessages?: unknown[];
  /** When true, keep already-introduced bots out (intro follow-up / continuation). */
  skipAlreadyIntroduced: boolean;
}): CollaborationBotTarget[] {
  let pool = params.bots.filter(
    (bot) => !isBuiltinStewardAgent(bot.agentId) && !isObserverBot(params.facts, bot),
  );
  // Blocked members stay out of un-@ fan-out (characterization); @ path keeps them via mentions.
  const blocked = new Set(
    (params.facts.busyAgentIds ?? [])
      .map((id) => normalizeAgentIdentifier(id))
      .filter((id): id is string => Boolean(id)),
  );
  if (blocked.size > 0) {
    pool = pool.filter((bot) => {
      const agentId = normalizeAgentIdentifier(bot.agentId);
      return !agentId || !blocked.has(agentId);
    });
  }
  if (params.skipAlreadyIntroduced && params.recentGroupMessages?.length) {
    const already = resolveBotsAlreadyIntroducedInThread({
      messages: params.recentGroupMessages,
      bots: params.bots,
      userMessage: params.message,
    });
    if (already.size > 0) {
      pool = pool.filter((bot) => {
        const agentId = normalizeAgentIdentifier(bot.agentId);
        return !agentId || !already.has(agentId);
      });
    }
  }
  return pool;
}

/**
 * P0-1 / P0-3: rewrite a participation decision into explicit_multi roll-call
 * when the group is on the allow-list and the message is a roll-call trigger.
 * Returns the original decision unchanged when the hotfix does not apply.
 */
export function applyV1RollCallDecisionHotfix(params: {
  scope: CollaborationDispatchScope;
  facts: RuntimeFacts;
  message: string;
  decision: ParticipationDecision;
  recentGroupMessages?: unknown[];
  mentionAll?: boolean;
  cfg?: OpenBotConfig;
}): ParticipationDecision {
  if (
    !isV1RollCallHotfixGroup({
      tenantId: params.scope.tenantId,
      groupId: params.scope.groupId,
      cfg: params.cfg,
    })
  ) {
    return params.decision;
  }
  // Leave confirm / unmatched / empty intact.
  if (params.decision.mentionConfirm || params.decision.mentionUnmatched) {
    return params.decision;
  }
  if (params.decision.primaryQueue.length === 0 && params.decision.executionBots.length === 0) {
    return params.decision;
  }

  const trigger =
    Boolean(params.mentionAll) ||
    params.decision.mentionMode === "broadcast" ||
    isV1RollCallTriggerMessage(params.message, params.recentGroupMessages, params.facts);
  if (!trigger) {
    return params.decision;
  }

  // Named @ already on explicit_multi (not @所有人 / broadcast) — keep as-is.
  if (
    params.decision.primaryMode === "explicit_multi" &&
    params.decision.mentionMode === "explicit_multi" &&
    !params.mentionAll
  ) {
    return params.decision;
  }

  const skipAlready =
    isIntroductionFollowUpMessage(params.message) ||
    isV1RollCallContinuation(params.message, params.recentGroupMessages);
  const pool = filterV1RollCallEligibleBots({
    facts: params.facts,
    bots: params.facts.bots as CollaborationBotTarget[],
    message: params.message,
    recentGroupMessages: params.recentGroupMessages,
    skipAlreadyIntroduced: skipAlready,
  });
  const ceiling = SYSTEM_INVARIANTS.maxVisibleRepliesCeiling;
  const capped = pool.slice(0, Math.max(0, Math.min(pool.length, ceiling)));
  if (capped.length === 0) {
    return params.decision;
  }

  const alerts: RoundPlanAlert[] = [
    ...(params.decision.roundPlan.alerts ?? []),
    {
      kind: "broadcast_mention",
      message:
        capped.length < pool.length
          ? `点名热修：本轮按上限请 ${capped.length}/${pool.length} 位未应答成员各回应一次`
          : `点名热修：本轮请 ${capped.length} 位成员各回应一次`,
    },
  ];

  return buildCollaborationRoundPlan({
    roundId: params.decision.roundId,
    sessionKey: params.decision.roundPlan.sessionKey,
    responseMode:
      params.decision.responseMode === "debate_or_brainstorm"
        ? "debate_or_brainstorm"
        : "lead_plus_supplement",
    tier0: capped,
    tier1: [],
    tier1Meta: [],
    tier2: [],
    alerts,
    lowSignalLimited: false,
    mentionUnmatched: false,
    mentionConfirm: null,
    primaryMode: "explicit_multi",
    mentionMode: params.mentionAll ? "broadcast" : "broadcast",
    mentionAll: Boolean(params.mentionAll) || params.decision.roundPlan.mentionAll === true,
  });
}

/**
 * P0-2: group_broadcast / roll-call selected members count as invited so cheap-gate
 * cannot drop them for low_relevance.
 */
export function expandV1RollCallInvitedAgentIds(params: {
  scope: CollaborationDispatchScope;
  decision: ParticipationDecision;
  invitedAgentIds: Set<string>;
  cfg?: OpenBotConfig;
}): Set<string> {
  if (
    !isV1RollCallHotfixGroup({
      tenantId: params.scope.tenantId,
      groupId: params.scope.groupId,
      cfg: params.cfg,
    })
  ) {
    return params.invitedAgentIds;
  }
  const next = new Set(params.invitedAgentIds);
  for (const participant of params.decision.roundPlan.participants) {
    if (participant.tier === "wrap") {
      continue;
    }
    // All non-wrap participants on a hotfix roll-call decision are invited.
    if (
      params.decision.primaryMode === "explicit_multi" ||
      params.decision.mentionMode === "broadcast" ||
      participant.tier === "mention" ||
      participant.tier === "duty" ||
      participant.tier === "relevance"
    ) {
      const agentId = normalizeAgentIdentifier(participant.agentId);
      if (agentId) {
        next.add(agentId);
      }
    }
  }
  return next;
}

export type V1RollCallRoster = {
  answeredAgentIds: string[];
  unansweredAgentIds: string[];
  answeredLabels: string[];
  unansweredLabels: string[];
  /** false when ledger read failed — callers must fail-closed (no「已到齐」claims). */
  ok: boolean;
  error?: string;
};

/** P0-4: roster from ledger execution records (status=completed), not transcript. */
export function buildV1RollCallRosterFromExecutions(params: {
  bots: CollaborationBotTarget[];
  executions: CollaborationExecutionRecord[];
  /** Optional: restrict to a topic window by round ids. */
  roundIds?: Set<string>;
}): V1RollCallRoster {
  const answered = new Set<string>();
  for (const record of params.executions) {
    if (record.status !== "completed") {
      continue;
    }
    if (params.roundIds && !params.roundIds.has(record.roundId)) {
      continue;
    }
    const agentId = normalizeAgentIdentifier(record.agentId);
    if (agentId) {
      answered.add(agentId);
    }
  }
  const answeredAgentIds: string[] = [];
  const unansweredAgentIds: string[] = [];
  const answeredLabels: string[] = [];
  const unansweredLabels: string[] = [];
  for (const bot of params.bots) {
    if (isBuiltinStewardAgent(bot.agentId)) {
      continue;
    }
    const agentId = normalizeAgentIdentifier(bot.agentId);
    if (!agentId) {
      continue;
    }
    if (answered.has(agentId)) {
      answeredAgentIds.push(agentId);
      answeredLabels.push(bot.name);
    } else {
      unansweredAgentIds.push(agentId);
      unansweredLabels.push(bot.name);
    }
  }
  return {
    answeredAgentIds,
    unansweredAgentIds,
    answeredLabels,
    unansweredLabels,
    ok: true,
  };
}

export function buildV1RollCallRosterUnavailable(reason: string): V1RollCallRoster {
  return {
    answeredAgentIds: [],
    unansweredAgentIds: [],
    answeredLabels: [],
    unansweredLabels: [],
    ok: false,
    error: reason,
  };
}

/** Prompt lines for coordinator / peers (P0-4 fail-closed). */
export function buildV1RollCallRosterPromptLines(roster: V1RollCallRoster): string[] {
  if (!roster.ok) {
    return [
      "【点名热修·账本】应答名单读取失败，禁止声称「已到齐 / 全员已介绍 / 都到了」。只陈述你确定发生过的事实。",
      `原因：${roster.error ?? "unknown"}`,
    ];
  }
  const lines = [
    "【点名热修·账本】以下名单仅来自 collaboration ledger 的 execution(status=completed)，不得用聊天文本臆测：",
    `已应答：${roster.answeredLabels.length > 0 ? roster.answeredLabels.join("、") : "（无）"}`,
    `未应答：${roster.unansweredLabels.length > 0 ? roster.unansweredLabels.join("、") : "（无）"}`,
  ];
  if (roster.unansweredLabels.length > 0) {
    lines.push("未应答名单非空时，禁止声称「已到齐」。");
  } else if (roster.answeredLabels.length > 0) {
    lines.push("仅当未应答为空时，才可用账本措辞说明「已到齐」。");
  }
  return lines;
}

/** ≤2 句 hint for roll-call primaries (P0-1). */
export function buildV1RollCallBriefReplyHint(): string {
  return "点名/自我介绍模式：每人只回应一次，控制在 2 句以内，直接介绍自己，不要代别人报到。";
}

/** Chat.ts single call-site helper (P0-4 / P0-5 / P0-9 + brief hint). */
export function prepareV1RollCallChatHooks(params: {
  tenantId?: string | null;
  groupId: string;
  message: string;
  cfg?: OpenBotConfig;
}): {
  active: boolean;
  stop: boolean;
  stopAck: string | null;
  /** When active, caller must resolve senderLabel before decideParticipants (P0-5). */
  preferEarlySenderLabel: boolean;
  briefHint: string | null;
} {
  const active = isV1RollCallHotfixGroup({
    tenantId: params.tenantId,
    groupId: params.groupId,
    cfg: params.cfg,
  });
  if (!active) {
    return {
      active: false,
      stop: false,
      stopAck: null,
      preferEarlySenderLabel: false,
      briefHint: null,
    };
  }
  const stop = isV1RollCallStopMessage(params.message);
  return {
    active: true,
    stop,
    stopAck: stop ? buildV1RollCallStopAck() : null,
    preferEarlySenderLabel: true,
    briefHint: buildV1RollCallBriefReplyHint(),
  };
}

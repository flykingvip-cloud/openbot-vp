/**
 * Parse / validate / map 「group-config-proposal」 fences from 大白 steward chat.
 * Apply path reuses existing settings + members.update writers (no new Dabai execute catalog).
 */

import type { WorkbenchSettingsGroupDraft } from "./views/workbench-types.ts";

export const GROUP_CONFIG_PROPOSAL_FENCE = "group-config-proposal";

export type GroupConfigProposalSettings = {
  title?: string;
  purpose?: string;
  currentMission?: string;
  coordinatorBotId?: string;
  collaborationMode?: string;
  confidentialityTier?: string;
  visibilityScope?: string;
  systemInstructions?: string[] | string;
  successCriteria?: string[] | string;
  finalDecisionMode?: string;
  finalDecisionRole?: string;
  allowAgentPublishProposal?: boolean;
  openDiscussionWithoutMention?: boolean;
  maxVisibleBotRepliesPerRound?: number;
};

export type GroupConfigProposalRosterMemberHuman = {
  userId: string;
  name?: string;
};

export type GroupConfigProposalRosterMemberBot = {
  agentId: string;
  name?: string;
};

export type GroupConfigProposalRoster = {
  humans?: GroupConfigProposalRosterMemberHuman[];
  bots?: GroupConfigProposalRosterMemberBot[];
  invites?: {
    humans?: Array<{ userId: string; name?: string; handle?: string }>;
    bots?: Array<{ agentId: string; name?: string }>;
  };
};

export type GroupConfigProposal = {
  groupId: string;
  summary?: string;
  settings?: GroupConfigProposalSettings;
  roster?: GroupConfigProposalRoster;
};

export type ParsedGroupConfigProposal = {
  proposal: GroupConfigProposal;
  fingerprint: string;
  summaryLines: string[];
  rawFence: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.length > 0 ? lines : undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const lines = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

function stringifyLines(value: string[] | string | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/** Extract the last ```group-config-proposal ... ``` JSON fence from assistant text. */
export function extractGroupConfigProposalFence(text: string): string | null {
  if (!text.trim()) {
    return null;
  }
  const pattern = /```group-config-proposal\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;
  let last: string | null = null;
  while ((match = pattern.exec(text)) !== null) {
    const body = match[1]?.trim() ?? "";
    if (body) {
      last = body;
    }
  }
  return last;
}

export function parseGroupConfigProposalJson(raw: string): GroupConfigProposal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  return validateGroupConfigProposal(parsed);
}

export function validateGroupConfigProposal(value: unknown): GroupConfigProposal | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const groupId = normalizeText(record.groupId);
  if (!groupId) {
    return null;
  }
  const settingsRaw = asRecord(record.settings);
  const rosterRaw = asRecord(record.roster);
  const settings = settingsRaw ? sanitizeSettings(settingsRaw) : undefined;
  const roster = rosterRaw ? sanitizeRoster(rosterRaw) : undefined;
  if (!settings && !roster) {
    // Require at least one writable section so empty cards are not shown.
    return null;
  }
  return {
    groupId,
    ...(normalizeText(record.summary) ? { summary: normalizeText(record.summary) as string } : {}),
    ...(settings ? { settings } : {}),
    ...(roster ? { roster } : {}),
  };
}

function sanitizeSettings(
  record: Record<string, unknown>,
): GroupConfigProposalSettings | undefined {
  const settings: GroupConfigProposalSettings = {};
  const assignText = (key: keyof GroupConfigProposalSettings, rawKey = key as string) => {
    const text = normalizeText(record[rawKey]);
    if (text) {
      (settings as Record<string, unknown>)[key] = text;
    }
  };
  assignText("title");
  assignText("purpose");
  assignText("currentMission");
  assignText("coordinatorBotId");
  assignText("collaborationMode");
  assignText("confidentialityTier");
  assignText("visibilityScope");
  assignText("finalDecisionMode");
  assignText("finalDecisionRole");
  const systemInstructions = normalizeStringList(record.systemInstructions);
  if (systemInstructions) {
    settings.systemInstructions = systemInstructions;
  }
  const successCriteria = normalizeStringList(record.successCriteria);
  if (successCriteria) {
    settings.successCriteria = successCriteria;
  }
  if (typeof record.allowAgentPublishProposal === "boolean") {
    settings.allowAgentPublishProposal = record.allowAgentPublishProposal;
  }
  if (typeof record.openDiscussionWithoutMention === "boolean") {
    settings.openDiscussionWithoutMention = record.openDiscussionWithoutMention;
  }
  if (
    typeof record.maxVisibleBotRepliesPerRound === "number" &&
    Number.isFinite(record.maxVisibleBotRepliesPerRound)
  ) {
    settings.maxVisibleBotRepliesPerRound = Math.max(
      1,
      Math.min(50, Math.round(record.maxVisibleBotRepliesPerRound)),
    );
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
}

function sanitizeRoster(record: Record<string, unknown>): GroupConfigProposalRoster | undefined {
  const humans = Array.isArray(record.humans)
    ? record.humans
        .map((entry) => {
          const row = asRecord(entry);
          const userId = normalizeText(row?.userId);
          if (!userId) {
            return null;
          }
          return {
            userId,
            ...(normalizeText(row?.name) ? { name: normalizeText(row?.name) as string } : {}),
          };
        })
        .filter(Boolean)
    : undefined;
  const bots = Array.isArray(record.bots)
    ? record.bots
        .map((entry) => {
          const row = asRecord(entry);
          const agentId = normalizeText(row?.agentId);
          if (!agentId) {
            return null;
          }
          return {
            agentId,
            ...(normalizeText(row?.name) ? { name: normalizeText(row?.name) as string } : {}),
          };
        })
        .filter(Boolean)
    : undefined;
  const invitesRaw = asRecord(record.invites);
  const inviteHumans = Array.isArray(invitesRaw?.humans)
    ? invitesRaw.humans
        .map((entry) => {
          const row = asRecord(entry);
          const userId = normalizeText(row?.userId);
          if (!userId) {
            return null;
          }
          return {
            userId,
            ...(normalizeText(row?.name) ? { name: normalizeText(row?.name) as string } : {}),
            ...(normalizeText(row?.handle) ? { handle: normalizeText(row?.handle) as string } : {}),
          };
        })
        .filter(
          (entry): entry is { userId: string; name?: string; handle?: string } => entry !== null,
        )
    : undefined;
  const inviteBots = Array.isArray(invitesRaw?.bots)
    ? invitesRaw.bots
        .map((entry) => {
          const row = asRecord(entry);
          const agentId = normalizeText(row?.agentId);
          if (!agentId) {
            return null;
          }
          return {
            agentId,
            ...(normalizeText(row?.name) ? { name: normalizeText(row?.name) as string } : {}),
          };
        })
        .filter((entry): entry is { agentId: string; name?: string } => entry !== null)
    : undefined;
  const invites =
    (inviteHumans && inviteHumans.length > 0) || (inviteBots && inviteBots.length > 0)
      ? {
          ...(inviteHumans && inviteHumans.length > 0 ? { humans: inviteHumans } : {}),
          ...(inviteBots && inviteBots.length > 0 ? { bots: inviteBots } : {}),
        }
      : undefined;
  const roster: GroupConfigProposalRoster = {
    ...(humans && humans.length > 0
      ? { humans: humans as GroupConfigProposalRosterMemberHuman[] }
      : {}),
    ...(bots && bots.length > 0 ? { bots: bots as GroupConfigProposalRosterMemberBot[] } : {}),
    ...(invites ? { invites } : {}),
  };
  return Object.keys(roster).length > 0 ? roster : undefined;
}

export function proposalMatchesSourceSession(
  proposal: GroupConfigProposal,
  sourceSessionKey: string | null | undefined,
): boolean {
  const source = sourceSessionKey?.trim() ?? "";
  if (!source) {
    return false;
  }
  const groupId = proposal.groupId.trim();
  if (!groupId) {
    return false;
  }
  if (source === groupId || source === `space:${groupId}`) {
    return true;
  }
  // agent:<id>:space:<groupId> / space aliases
  if (source.endsWith(`:${groupId}`) || source.endsWith(`/${groupId}`)) {
    return true;
  }
  return source.includes(groupId);
}

export function fingerprintGroupConfigProposal(proposal: GroupConfigProposal): string {
  return JSON.stringify(proposal);
}

export function summarizeGroupConfigProposal(
  proposal: GroupConfigProposal,
  baseline?: WorkbenchSettingsGroupDraft | null,
): string[] {
  const lines: string[] = [];
  if (proposal.summary?.trim()) {
    lines.push(proposal.summary.trim());
  }
  const settings = proposal.settings;
  if (settings) {
    const pushDiff = (label: string, next: string | undefined, prev: string | undefined) => {
      const value = next?.trim();
      if (!value) {
        return;
      }
      if (prev != null && prev.trim() === value) {
        return;
      }
      lines.push(`${label}：${value}`);
    };
    pushDiff("名称", settings.title, baseline?.title);
    pushDiff("目标", settings.purpose, baseline?.purpose);
    pushDiff("当前使命", settings.currentMission, baseline?.currentMission);
    pushDiff("主负责人", settings.coordinatorBotId, baseline?.coordinatorBotId);
    pushDiff("协作模式", settings.collaborationMode, baseline?.collaborationMode);
    pushDiff("保密级别", settings.confidentialityTier, baseline?.confidentialityTier);
    const nextRules = stringifyLines(settings.systemInstructions);
    if (nextRules && nextRules !== (baseline?.rulesSummaryText ?? "").trim()) {
      lines.push(`系统指令：${nextRules.split("\n").length} 条`);
    }
    const nextCriteria = stringifyLines(settings.successCriteria);
    if (nextCriteria && nextCriteria !== (baseline?.successCriteriaText ?? "").trim()) {
      lines.push(`成功标准：${nextCriteria.split("\n").length} 条`);
    }
  }
  const roster = proposal.roster;
  if (roster) {
    if (roster.humans) {
      lines.push(`真人成员：${roster.humans.length} 人`);
    }
    if (roster.bots) {
      lines.push(`机器人：${roster.bots.length} 个`);
    }
    const inviteHumanCount = roster.invites?.humans?.length ?? 0;
    const inviteBotCount = roster.invites?.bots?.length ?? 0;
    if (inviteHumanCount + inviteBotCount > 0) {
      lines.push(`待邀请：真人 ${inviteHumanCount} / 机器人 ${inviteBotCount}`);
    }
  }
  if (lines.length === 0) {
    lines.push(`将配置建议应用到协作小组 ${proposal.groupId}`);
  }
  return lines;
}

export function applyProposalToSettingsDraft(
  baseline: WorkbenchSettingsGroupDraft,
  proposal: GroupConfigProposal,
): WorkbenchSettingsGroupDraft {
  const settings = proposal.settings;
  if (!settings) {
    return { ...baseline, groupId: proposal.groupId || baseline.groupId };
  }
  return {
    ...baseline,
    groupId: proposal.groupId || baseline.groupId,
    ...(settings.title?.trim() ? { title: settings.title.trim() } : {}),
    ...(settings.purpose?.trim() ? { purpose: settings.purpose.trim() } : {}),
    ...(settings.currentMission?.trim() ? { currentMission: settings.currentMission.trim() } : {}),
    ...(settings.coordinatorBotId?.trim()
      ? { coordinatorBotId: settings.coordinatorBotId.trim() }
      : {}),
    ...(settings.collaborationMode?.trim()
      ? { collaborationMode: settings.collaborationMode.trim() }
      : {}),
    ...(settings.confidentialityTier?.trim()
      ? { confidentialityTier: settings.confidentialityTier.trim() }
      : {}),
    ...(settings.visibilityScope?.trim()
      ? { visibilityScope: settings.visibilityScope.trim() }
      : {}),
    ...(settings.systemInstructions != null
      ? { rulesSummaryText: stringifyLines(settings.systemInstructions) }
      : {}),
    ...(settings.successCriteria != null
      ? { successCriteriaText: stringifyLines(settings.successCriteria) }
      : {}),
    ...(settings.finalDecisionMode?.trim()
      ? { finalDecisionMode: settings.finalDecisionMode.trim() }
      : {}),
    ...(settings.finalDecisionRole?.trim()
      ? { finalDecisionRole: settings.finalDecisionRole.trim() }
      : {}),
    ...(typeof settings.allowAgentPublishProposal === "boolean"
      ? { allowAgentPublishProposal: settings.allowAgentPublishProposal }
      : {}),
    ...(typeof settings.openDiscussionWithoutMention === "boolean"
      ? { openDiscussionWithoutMention: settings.openDiscussionWithoutMention }
      : {}),
    ...(typeof settings.maxVisibleBotRepliesPerRound === "number"
      ? { maxVisibleBotRepliesPerRound: settings.maxVisibleBotRepliesPerRound }
      : {}),
  };
}

export type GroupConfigProposalRosterMapped = {
  humans: Array<{ id: string; label: string; kind: "human" }>;
  bots: Array<{ id: string; label: string; kind: "bot" }>;
  pendingHumanInvites: Array<{ intentId: string; label: string; message?: string }>;
  pendingBotInvites: Array<{ agentId: string; label: string }>;
};

export function mapProposalRosterToGovernanceState(
  roster: GroupConfigProposalRoster,
): GroupConfigProposalRosterMapped {
  return {
    humans: (roster.humans ?? []).map((entry) => ({
      id: entry.userId,
      label: entry.name?.trim() || entry.userId,
      kind: "human" as const,
    })),
    bots: (roster.bots ?? []).map((entry) => ({
      id: entry.agentId,
      label: entry.name?.trim() || entry.agentId,
      kind: "bot" as const,
    })),
    pendingHumanInvites: (roster.invites?.humans ?? []).map((entry) => ({
      intentId: `invite:${entry.userId}`,
      label: entry.name?.trim() || entry.userId,
      ...(entry.handle?.trim() ? { message: entry.handle.trim() } : {}),
    })),
    pendingBotInvites: (roster.invites?.bots ?? []).map((entry) => ({
      agentId: entry.agentId,
      label: entry.name?.trim() || entry.agentId,
    })),
  };
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

/** Scan chat messages newest-first for a valid proposal fence. */
export function extractLatestGroupConfigProposalFromMessages(
  messages: Array<{ role?: string; content?: unknown }> | null | undefined,
): ParsedGroupConfigProposal | null {
  if (!messages?.length) {
    return null;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (entry?.role !== "assistant") {
      continue;
    }
    const text = extractTextFromChatContent(entry.content);
    const fence = extractGroupConfigProposalFence(text);
    if (!fence) {
      continue;
    }
    const proposal = parseGroupConfigProposalJson(fence);
    if (!proposal) {
      continue;
    }
    return {
      proposal,
      fingerprint: fingerprintGroupConfigProposal(proposal),
      summaryLines: summarizeGroupConfigProposal(proposal),
      rawFence: fence,
    };
  }
  return null;
}

/** Human-confirmable standing-coordinator suggestion. Never auto-writes coordinatorBotId. */
export function buildStandingCoordinatorSuggestion(params: {
  groupId: string;
  coordinatorBotId: string;
  coordinatorLabel?: string;
}): GroupConfigProposal {
  const label = params.coordinatorLabel?.trim() || params.coordinatorBotId.trim();
  return {
    groupId: params.groupId.trim(),
    summary: `建议将 ${label} 设为协作小组主负责人。这是常设身份，不是本轮主答。`,
    settings: {
      coordinatorBotId: params.coordinatorBotId.trim(),
    },
  };
}

export type GroupConfigProposalPromptContext = {
  groupId: string;
  title: string;
  purpose?: string | null;
  currentMission?: string | null;
  coordinatorBotId?: string | null;
  collaborationMode?: string | null;
  confidentialityTier?: string | null;
  systemInstructions?: string[] | null;
  humans: string[];
  bots: string[];
  humanInvites: string[];
  botInvites: string[];
  instruction: string;
};

export type GroupConfigProposalCaptureState = {
  chatMessages?: Array<{ role?: string; content?: unknown }> | null;
  daibaiSourceSessionKey?: string | null;
  workbenchPendingGroupConfigProposal?: {
    groupId: string;
    fingerprint: string;
    summaryLines: string[];
    proposal: GroupConfigProposal;
    sourceSessionKey: string | null;
  } | null;
  workbenchGroupConfigProposalDismissedFingerprint?: string | null;
};

/** Capture a fresh proposal from steward chat into workbench pending state. */
export function syncPendingGroupConfigProposalFromChat(
  state: GroupConfigProposalCaptureState,
): boolean {
  const extracted = extractLatestGroupConfigProposalFromMessages(state.chatMessages);
  if (!extracted) {
    return false;
  }
  if (!proposalMatchesSourceSession(extracted.proposal, state.daibaiSourceSessionKey)) {
    return false;
  }
  if (state.workbenchGroupConfigProposalDismissedFingerprint === extracted.fingerprint) {
    return false;
  }
  if (state.workbenchPendingGroupConfigProposal?.fingerprint === extracted.fingerprint) {
    return false;
  }
  state.workbenchPendingGroupConfigProposal = {
    groupId: extracted.proposal.groupId,
    fingerprint: extracted.fingerprint,
    summaryLines: extracted.summaryLines,
    proposal: extracted.proposal,
    sourceSessionKey: state.daibaiSourceSessionKey ?? null,
  };
  return true;
}

/** Build the steward prompt that asks for a trailing group-config-proposal fence. */
export function buildGroupConfigProposalPrompt(context: GroupConfigProposalPromptContext): string {
  const instructions = (context.systemInstructions ?? [])
    .map((line) => line.trim())
    .filter(Boolean);
  return [
    `请协助我调整协作小组“${context.title}”的成员与可落库配置。`,
    `groupId：${context.groupId}`,
    `当前目标：${context.purpose?.trim() || "暂无"}`,
    `当前使命：${context.currentMission?.trim() || "暂无"}`,
    `主负责人：${context.coordinatorBotId?.trim() || "暂无"}`,
    `协作模式：${context.collaborationMode?.trim() || "暂无"}`,
    `保密级别：${context.confidentialityTier?.trim() || "暂无"}`,
    `系统指令：${instructions.join("；") || "暂无"}`,
    `当前真人成员：${context.humans.join("、") || "暂无"}`,
    `当前机器人：${context.bots.join("、") || "暂无"}`,
    `待邀请成员：${context.humanInvites.join("、") || "暂无"}`,
    `待确认机器人：${context.botInvites.join("、") || "暂无"}`,
    `我的要求：${context.instruction}`,
    "",
    "请先用简洁中文给出调整建议，并在回复末尾附带可机器解析的提案（不要省略 fence）：",
    "```group-config-proposal",
    "{",
    '  "groupId": "' + context.groupId + '",',
    '  "summary": "一句话摘要",',
    '  "settings": {',
    '    "title": "...",',
    '    "purpose": "...",',
    '    "currentMission": "...",',
    '    "coordinatorBotId": "...",',
    '    "collaborationMode": "...",',
    '    "confidentialityTier": "...",',
    '    "systemInstructions": ["..."],',
    '    "successCriteria": ["..."],',
    '    "finalDecisionMode": "human_required",',
    '    "finalDecisionRole": "owner",',
    '    "allowAgentPublishProposal": true,',
    '    "openDiscussionWithoutMention": true,',
    '    "maxVisibleBotRepliesPerRound": 5',
    "  },",
    '  "roster": {',
    '    "humans": [{ "userId": "...", "name": "..." }],',
    '    "bots": [{ "agentId": "...", "name": "..." }],',
    '    "invites": {',
    '      "humans": [{ "userId": "...", "name": "..." }],',
    '      "bots": [{ "agentId": "...", "name": "..." }]',
    "    }",
    "  }",
    "}",
    "```",
    "说明：只填写需要变更的可落库字段；成员职责/角色建议请写入 systemInstructions 或 mission 文案（本轮不直写 per-member role）。",
  ].join("\n");
}

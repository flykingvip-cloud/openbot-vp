import {
  deriveSessionChatType,
  isCronSessionKey,
  isSubagentSessionKey,
  parseAgentSessionKey,
  toCollaborationSpaceSessionKey,
} from "../../../../../../src/sessions/session-key-utils.ts";
import { i18n, t } from "../../../../i18n/index.ts";
import { resolveSessionDisplayName } from "../../../app-render.helpers.ts";
import {
  extractEmployeeStewardOwnerFromSessionKey,
  isGlobalStewardSessionAlias,
} from "../../../chat-session-key-match.ts";
import { isGroupScopedSessionKey } from "../../../collaboration/resolve-group-scope.ts";
import type {
  FrontstageContactCard,
  FrontstageGroupCard,
  FrontstageSessionCard,
} from "../../../data/frontstage-session-cards.ts";
import {
  buildContactCards,
  buildGroupCards,
  deriveSessionCards,
} from "../../../data/frontstage-session-cards.ts";
import { formatRelativeTimestamp } from "../../../format.ts";
import { resolveSessionSeenAtMs } from "../../../session-seen-at.ts";
import type {
  AgentsListResult,
  ChannelsStatusSnapshot,
  GatewayAgentRow,
  PresenceEntry,
  SessionsListResult,
} from "../../../types.ts";
import type { WorkbenchTeamObject } from "../../../workbench-team-object.ts";
import { isBareUuidLabel } from "../employee-workbench-agent-scope.ts";
import { buildWorkbenchModuleBundle, type WorkbenchModuleBundle } from "./workbench-modules.ts";
import {
  buildWorkbenchSignalBundle,
  type WorkbenchNoticesSummary,
  type WorkbenchPendingTasksSummary,
  type WorkbenchScheduleSummary,
  type WorkbenchSignalBundle,
  type WorkbenchStewardSuggestionSummary,
  type WorkbenchUpcomingCollaborationSummary,
} from "./workbench-signals.ts";

export type WorkbenchActivity = "active" | "warm" | "idle";

export type WorkbenchSidebarItem = {
  key: string;
  sessionKeys: string[];
  title: string;
  subtitle: string;
  preview: string;
  badge: string;
  meta: string;
  updatedAt: number | null;
  unreadCount: number;
  activity: WorkbenchActivity;
  kind: "agent" | "contact" | "group";
};

export type WorkbenchTeamEntry = {
  id: string;
  key: string;
  sessionKeys: string[];
  kind: "assistant" | "member" | "space";
  badge: string;
  title: string;
  subtitle: string;
  detail: string;
  meta: string;
  updatedAt: number | null;
  unreadCount: number;
  activity: WorkbenchActivity;
  saved: boolean;
  channelId?: string | null;
  directoryGroupId?: string | null;
  selectionKey?: string | null;
  entityId?: string | null;
  groupId?: string | null;
  /** Collaboration owner (creator) user id, when known. Used for owner-first ordering. */
  ownerUserId?: string | null;
};

export type WorkbenchSessionSummary = {
  title: string;
  subtitle: string;
  badge: string;
};

export type WorkbenchAccountsSummary = {
  total: number;
  active: number;
};

export type WorkbenchStat = {
  label: string;
  value: string;
  tone?: "default" | "ok";
};

export type WorkbenchHomeModel = {
  agents: WorkbenchSidebarItem[];
  contacts: WorkbenchSidebarItem[];
  groups: WorkbenchSidebarItem[];
  teamAssistants: WorkbenchTeamEntry[];
  teamMembers: WorkbenchTeamEntry[];
  teamSpaces: WorkbenchTeamEntry[];
  recentSessions: FrontstageSessionCard[];
  contactCards: FrontstageContactCard[];
  groupCards: FrontstageGroupCard[];
  accounts: WorkbenchAccountsSummary;
  sessionCount: number;
  activeSession: WorkbenchSessionSummary;
  onlineInstances: number;
  savedTeamCount: number;
  metrics: WorkbenchStat[];
  signals: WorkbenchSignalBundle;
  modules: WorkbenchModuleBundle;
};

export type WorkbenchFrontstageModel = {
  recentSessions?: FrontstageSessionCard[];
  contactCards?: FrontstageContactCard[];
  groupCards?: FrontstageGroupCard[];
  accounts?: WorkbenchAccountsSummary;
  onlineInstances?: number;
  sessionCount?: number;
  freshSurface?: boolean;
};

type MinimalShellReadModel = {
  agents?: WorkbenchSidebarItem[];
  contacts?: WorkbenchSidebarItem[];
  groups?: WorkbenchSidebarItem[];
  teamAssistants?: WorkbenchTeamEntry[];
  teamMembers?: WorkbenchTeamEntry[];
  activeSession?: WorkbenchSessionSummary | null;
};

type MinimalCollaborationReadModel = {
  teamSpaces?: WorkbenchTeamEntry[];
  savedTeamCount?: number;
};

export type WorkbenchHomeModelInput = {
  frontstageModel?: WorkbenchFrontstageModel | null;
  shellReadModel?: MinimalShellReadModel | null;
  collaborationReadModel?: MinimalCollaborationReadModel | null;
  policyEnvelope?: unknown;
  connected: boolean;
  cronNext: number | null;
  lastError: string | null;
  guideAcknowledged?: boolean;
  /** Pending-work projection for 待办事项 (must survive home-model reassembly). */
  pendingTasks?: WorkbenchPendingTasksSummary | null;
  notices?: WorkbenchNoticesSummary | null;
  upcomingCollaboration?: WorkbenchUpcomingCollaborationSummary | null;
  stewardSuggestion?: WorkbenchStewardSuggestionSummary | null;
  schedule?: WorkbenchScheduleSummary | null;
};

export type WorkbenchHomeStateSnapshotInput = {
  agentsList: AgentsListResult | null;
  sessionsResult: SessionsListResult | null;
  sessionSeenAt: Record<string, number>;
  activeSessionKey: string;
  /** Trusted current employee's steward key — scopes unread alias matching. */
  ownStewardSessionKey?: string | null;
  teamObjects: Record<string, WorkbenchTeamObject>;
  teamOrder: string[];
  channelsSnapshot: ChannelsStatusSnapshot | null;
  presenceEntries: PresenceEntry[];
  connected: boolean;
  cronNext: number | null;
  lastError: string | null;
  guideAcknowledged?: boolean;
  pendingTasks?: WorkbenchPendingTasksSummary | null;
  notices?: WorkbenchNoticesSummary | null;
  upcomingCollaboration?: WorkbenchUpcomingCollaborationSummary | null;
  stewardSuggestion?: WorkbenchStewardSuggestionSummary | null;
  schedule?: WorkbenchScheduleSummary | null;
};

export function initials(label: string) {
  const words = label
    .split(/[\s_-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);
  const value = words.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return value || "OC";
}

export function formatWorkspaceUpdatedAt(updatedAt: number | null) {
  if (!updatedAt) {
    return t("common.na");
  }
  return formatRelativeTimestamp(updatedAt);
}

export function isFreshEmployeeWorkbenchSurface(params: {
  contactsCount: number;
  groupsCount: number;
  agentsCount: number;
  guideAcknowledged?: boolean;
}): boolean {
  if (!params.guideAcknowledged) {
    return true;
  }
  return params.contactsCount === 0 && params.groupsCount === 0 && params.agentsCount <= 1;
}

export function formatCronMinutesLabel(count: number): string {
  const safeCount = Math.max(1, Math.round(count));
  const translated = t("frontstage.workbench.cards.cronMinutes", {
    count: String(safeCount),
  });
  if (translated !== "frontstage.workbench.cards.cronMinutes") {
    return translated;
  }
  return i18n.getLocale() === "zh-CN" ? `${safeCount} 分钟后` : `${safeCount} min`;
}

function buildCronLabel(cronNext: number | null) {
  if (!cronNext) {
    return t("common.na");
  }
  const deltaMs = Math.max(0, cronNext - Date.now());
  const minuteMs = 60 * 1000;
  if (deltaMs < 2 * minuteMs) {
    return t("common.now");
  }
  return formatCronMinutesLabel(Math.round(deltaMs / minuteMs));
}

function ensureSessionSummary(summary: WorkbenchSessionSummary | null | undefined) {
  if (summary) {
    return summary;
  }
  return {
    title: "Main Session",
    subtitle: t("common.na"),
    badge: "AI",
  } satisfies WorkbenchSessionSummary;
}

export function matchesWorkspaceQuery(fields: Array<string | null | undefined>, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return fields.some((field) => field?.toLowerCase().includes(normalized));
}

export function countWorkspaceAccounts(
  snapshot: ChannelsStatusSnapshot | null,
): WorkbenchAccountsSummary {
  let total = 0;
  let active = 0;
  for (const channelId of snapshot?.channelOrder ?? []) {
    for (const account of snapshot?.channelAccounts[channelId] ?? []) {
      total += 1;
      if (account.connected || account.running || account.configured) {
        active += 1;
      }
    }
  }
  return { total, active };
}

function formatSidebarPreview(preview: string | null | undefined, fallback: string) {
  const normalized = preview?.trim();
  if (normalized) {
    return normalized;
  }
  return fallback;
}

function resolveActivity(updatedAt: number | null): WorkbenchActivity {
  if (!updatedAt) {
    return "idle";
  }
  const ageMs = Date.now() - updatedAt;
  if (ageMs <= 10 * 60 * 1000) {
    return "active";
  }
  if (ageMs <= 2 * 60 * 60 * 1000) {
    return "warm";
  }
  return "idle";
}

function resolveUnreadSpaceSessionKey(sessionKey: string): string | null {
  const raw = sessionKey.trim();
  if (!raw) {
    return null;
  }
  if (raw.toLowerCase().startsWith("space:")) {
    return toCollaborationSpaceSessionKey(raw.slice("space:".length));
  }
  const match = raw.match(/:space:([^:]+)/i);
  return match ? toCollaborationSpaceSessionKey(match[1]) : null;
}

function isActiveUnreadSessionKey(
  key: string,
  activeSessionKey: string,
  ownStewardSessionKey?: string | null,
): boolean {
  const active = activeSessionKey.trim();
  if (!active) {
    return false;
  }
  if (key === active) {
    return true;
  }
  // Steward aliases share one inbox only within the trusted current user.
  // Different employee:<id> owners must not clear each other (account switch).
  const own = ownStewardSessionKey?.trim() || "";
  const keyOwner = extractEmployeeStewardOwnerFromSessionKey(key);
  const activeOwner = extractEmployeeStewardOwnerFromSessionKey(active);
  const keyIsSteward = isGlobalStewardSessionAlias(key) || Boolean(keyOwner);
  const activeIsSteward = isGlobalStewardSessionAlias(active) || Boolean(activeOwner);
  if (keyIsSteward && activeIsSteward) {
    if (keyOwner && activeOwner) {
      return keyOwner === activeOwner;
    }
    // One side is a public main alias: only treat as active for the trusted own steward.
    const ownOwner = extractEmployeeStewardOwnerFromSessionKey(own);
    if (keyOwner && ownOwner) {
      return (
        keyOwner === ownOwner && (isGlobalStewardSessionAlias(active) || activeOwner === ownOwner)
      );
    }
    if (activeOwner && ownOwner) {
      return (
        activeOwner === ownOwner && (isGlobalStewardSessionAlias(key) || keyOwner === ownOwner)
      );
    }
    // No employee ids and no trusted own — allow classic main↔main alias match only.
    if (!keyOwner && !activeOwner) {
      return isGlobalStewardSessionAlias(key) && isGlobalStewardSessionAlias(active);
    }
    return false;
  }
  const keySpace = resolveUnreadSpaceSessionKey(key);
  const activeSpace = resolveUnreadSpaceSessionKey(active);
  return Boolean(keySpace && activeSpace && keySpace === activeSpace);
}

function countUnreadSessions(
  sessionKeys: string[],
  sessionsResult: SessionsListResult | null,
  sessionSeenAt: Record<string, number>,
  activeSessionKey: string,
  ownStewardSessionKey?: string | null,
) {
  const rowsByKey = new Map((sessionsResult?.sessions ?? []).map((row) => [row.key, row] as const));
  return sessionKeys.reduce((count, key) => {
    if (isActiveUnreadSessionKey(key, activeSessionKey, ownStewardSessionKey)) {
      return count;
    }
    // P1（未读基于真实入站消息）：只有「承载真实对话消息」的会话才计入未读。
    // 排除 cron/subagent 等非用户会话，并要求存在实际消息预览（lastMessagePreview）——
    // 员工隔离初始化 / 协作组镜像 / 定时任务等只 bump updatedAt 而无真实消息的系统活动
    // 不再产生「从未对话过却显示未读」的假计数。
    if (isCronSessionKey(key) || isSubagentSessionKey(key)) {
      return count;
    }
    const row = rowsByKey.get(key);
    const updatedAt = row?.updatedAt ?? null;
    if (!updatedAt) {
      return count;
    }
    const hasRealMessage = Boolean(row?.lastMessagePreview && row.lastMessagePreview.trim());
    if (!hasRealMessage) {
      return count;
    }
    // Alias-aware cursor: UI may persist under canonical/steward alias while
    // sessions.list keeps employee:/space: mirror keys — exact lookup resurrects
    // badges after refresh.
    const seenAt = resolveSessionSeenAtMs(sessionSeenAt, key, {
      ownStewardSessionKey,
    });
    return updatedAt > seenAt ? count + 1 : count;
  }, 0);
}

function resolveOwnedAgentIdForSession(row: SessionsListResult["sessions"][number]): string | null {
  const parsed = parseAgentSessionKey(row.key);
  if (parsed?.agentId) {
    return parsed.agentId;
  }
  const key = row.key.trim().toLowerCase();
  if (key === "main" || key === "global" || row.kind === "global") {
    return "main";
  }
  return null;
}

function resolveAgentPrimarySessionKey(
  agentId: string,
  agentSessions: SessionsListResult["sessions"][number][],
): string {
  const canonical = agentId === "main" ? "agent:main:main" : `agent:${agentId}:main`;
  if (agentId !== "main") {
    return canonical;
  }
  const directSessions = agentSessions.filter((row) => !isGroupScopedSessionKey(row.key));
  return (
    directSessions.find((row) => row.key === canonical)?.key ??
    directSessions.find((row) => row.key === "main" || row.kind === "global")?.key ??
    directSessions[0]?.key ??
    "main"
  );
}

function sessionsByAgent(sessionsResult: SessionsListResult | null) {
  const counts = new Map<string, number>();
  for (const row of sessionsResult?.sessions ?? []) {
    if (isCronSessionKey(row.key)) {
      continue;
    }
    const agentId = resolveOwnedAgentIdForSession(row);
    if (!agentId) {
      continue;
    }
    counts.set(agentId, (counts.get(agentId) ?? 0) + 1);
  }
  return counts;
}

function sortSessionsByRecency(rows: SessionsListResult["sessions"]) {
  return [...rows].toSorted((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

function resolveAgentSessionTitle(
  agentId: string,
  rows: SessionsListResult["sessions"][number][],
  configuredName: string | null,
) {
  if (configuredName?.trim()) {
    return configuredName.trim();
  }
  const canonicalMainKey = agentId === "main" ? "main" : `agent:${agentId}:main`;
  const canonicalMainRow =
    rows.find((row) => row.key === canonicalMainKey) ??
    rows.find((row) => row.kind === "global" || row.key === "main") ??
    null;
  if (!canonicalMainRow) {
    return agentId;
  }
  return resolveSessionDisplayName(canonicalMainRow.key, canonicalMainRow);
}

function buildAgentItems(
  agentsList: AgentsListResult | null,
  sessionsResult: SessionsListResult | null,
  sessionSeenAt: Record<string, number>,
  activeSessionKey: string,
  ownStewardSessionKey?: string | null,
): WorkbenchSidebarItem[] {
  const sessionCounts = sessionsByAgent(sessionsResult);
  const sessionsByAgentId = new Map<string, SessionsListResult["sessions"][number][]>();
  for (const row of sessionsResult?.sessions ?? []) {
    if (isCronSessionKey(row.key)) {
      continue;
    }
    const agentId = resolveOwnedAgentIdForSession(row);
    if (!agentId) {
      continue;
    }
    const bucket = sessionsByAgentId.get(agentId) ?? [];
    bucket.push(row);
    sessionsByAgentId.set(agentId, bucket);
  }
  const configuredAgents = agentsList?.agents ?? [];
  // Per-user channel isolation: the sidebar lists ONLY agents returned by the
  // (server-side scoped) `agents.list`. We intentionally do NOT fall back to
  // agent ids merely seen in the session store — a foreign bot that happens to
  // have a session row must never leak into the current user's navigation.
  const orderedAgents: GatewayAgentRow[] = [...configuredAgents];

  return orderedAgents.flatMap((agent) => {
    const agentId = agent.id;
    const humanName = [agent.name, agent.identity?.name]
      .map((value) => value?.trim())
      .find((value) => Boolean(value) && !isBareUuidLabel(value));
    const title = humanName || agent.id;
    const agentSessions = sortSessionsByRecency(sessionsByAgentId.get(agentId) ?? []);
    const resolvedTitle = resolveAgentSessionTitle(agentId, agentSessions, title);
    if (isBareUuidLabel(resolvedTitle)) {
      return [];
    }
    const sessionCount = sessionCounts.get(agentId) ?? 0;
    const primarySessionKey = resolveAgentPrimarySessionKey(agentId, agentSessions);
    const primarySession =
      agentSessions.find((row) => row.key === primarySessionKey) ??
      agentSessions.find((row) => !isGroupScopedSessionKey(row.key)) ??
      agentSessions[0];
    const subtitle =
      agentId === agentsList?.defaultId
        ? t("frontstage.me.primaryPersona")
        : t("frontstage.personas.secondaryPersona");
    const meta = t("frontstage.personas.sessions", { count: String(sessionCount) });
    // Assistant badges must not inherit collaboration-space mirrors. Those rows
    // belong to 协作空间 entries; bundling them into 大白管家/助手 sessionKeys
    // made "open steward" batch-clear space badges in memory, then refresh
    // resurrected both steward and space unread counts.
    const sessionKeys = agentSessions
      .map((row) => row.key)
      .filter((key) => !isGroupScopedSessionKey(key));
    return [
      {
        key: primarySessionKey,
        sessionKeys: sessionKeys.length > 0 ? sessionKeys : [primarySessionKey],
        title: resolvedTitle,
        subtitle,
        preview: formatSidebarPreview(primarySession?.lastMessagePreview, subtitle),
        badge: agent.identity?.emoji?.trim() || initials(resolvedTitle),
        meta,
        updatedAt: primarySession?.updatedAt ?? null,
        unreadCount: countUnreadSessions(
          sessionKeys,
          sessionsResult,
          sessionSeenAt,
          activeSessionKey,
          ownStewardSessionKey,
        ),
        activity: resolveActivity(primarySession?.updatedAt ?? null),
        kind: "agent" as const,
      } satisfies WorkbenchSidebarItem,
    ];
  });
}

function buildContactItems(
  sessionsResult: SessionsListResult | null,
  sessionSeenAt: Record<string, number>,
  activeSessionKey: string,
  ownStewardSessionKey?: string | null,
): WorkbenchSidebarItem[] {
  const rowsByKey = new Map((sessionsResult?.sessions ?? []).map((row) => [row.key, row] as const));
  return buildContactCards(sessionsResult).map((contact) => {
    const latestRow = rowsByKey.get(contact.latestSessionKey);
    const subtitle = [
      t("frontstage.contacts.personaRoutes", { count: String(contact.personaIds.length) }),
      t("frontstage.contacts.surfaces", { count: String(contact.surfaces.length) }),
    ].join(" · ");
    return {
      key: contact.latestSessionKey,
      sessionKeys: contact.sessionKeys,
      title: contact.title,
      subtitle,
      preview: formatSidebarPreview(latestRow?.lastMessagePreview, subtitle),
      badge: initials(contact.title),
      meta: t("frontstage.contacts.sessions", { count: String(contact.sessionCount) }),
      updatedAt: contact.latestUpdatedAt,
      unreadCount: countUnreadSessions(
        contact.sessionKeys,
        sessionsResult,
        sessionSeenAt,
        activeSessionKey,
        ownStewardSessionKey,
      ),
      activity: resolveActivity(contact.latestUpdatedAt),
      kind: "contact" as const,
    } satisfies WorkbenchSidebarItem;
  });
}

function buildGroupItems(
  sessionsResult: SessionsListResult | null,
  sessionSeenAt: Record<string, number>,
  activeSessionKey: string,
  ownStewardSessionKey?: string | null,
): WorkbenchSidebarItem[] {
  const rowsByKey = new Map((sessionsResult?.sessions ?? []).map((row) => [row.key, row] as const));
  return buildGroupCards(sessionsResult).map((group) => {
    const latestRow = rowsByKey.get(group.latestSessionKey);
    const subtitle =
      group.chatType === "group"
        ? t("frontstage.groups.groupType")
        : t("frontstage.groups.channelType");
    return {
      key: group.latestSessionKey,
      sessionKeys: group.sessionKeys,
      title: group.title,
      subtitle,
      preview: formatSidebarPreview(latestRow?.lastMessagePreview, subtitle),
      badge: group.chatType === "group" ? "GR" : "CH",
      meta: t("frontstage.groups.sessions", { count: String(group.sessionCount) }),
      updatedAt: group.latestUpdatedAt,
      unreadCount: countUnreadSessions(
        group.sessionKeys,
        sessionsResult,
        sessionSeenAt,
        activeSessionKey,
        ownStewardSessionKey,
      ),
      activity: resolveActivity(group.latestUpdatedAt),
      kind: "group" as const,
    } satisfies WorkbenchSidebarItem;
  });
}

function toTeamEntries(
  items: WorkbenchSidebarItem[],
  kind: WorkbenchTeamEntry["kind"],
  limit = Number.POSITIVE_INFINITY,
): WorkbenchTeamEntry[] {
  return items.slice(0, limit).map((item) => ({
    id: item.key,
    key: item.key,
    sessionKeys: item.sessionKeys,
    kind,
    badge: item.badge,
    title: item.title,
    subtitle: item.subtitle,
    detail: item.preview,
    meta: item.meta,
    updatedAt: item.updatedAt,
    unreadCount: item.unreadCount,
    activity: item.activity,
    saved: false,
  }));
}

function applyTeamObjectPreferences(
  entries: WorkbenchTeamEntry[],
  teamObjects: Record<string, WorkbenchTeamObject>,
) {
  return entries.map((entry) => {
    const saved = teamObjects[entry.key];
    return {
      ...entry,
      // Local team objects are now compatibility metadata only: they may rename
      // an entry, but they no longer control structural ordering in the workbench.
      title: saved?.alias?.trim() || entry.title,
      saved: Boolean(saved),
    };
  });
}

function currentSessionSummary(
  activeSessionKey: string,
  sessionsResult: SessionsListResult | null,
): WorkbenchSessionSummary {
  const row = sessionsResult?.sessions.find((entry) => entry.key === activeSessionKey);
  const title = resolveSessionDisplayName(activeSessionKey, row);
  const chatType =
    row?.kind === "direct" || row?.kind === "group"
      ? row.kind
      : deriveSessionChatType(activeSessionKey);
  const subtitleParts = [
    row?.surface?.trim() || null,
    row?.subject?.trim() || null,
    row?.room?.trim() || null,
    chatType,
  ].filter(Boolean);
  return {
    title,
    subtitle: subtitleParts.join(" · ") || activeSessionKey,
    badge: initials(title),
  };
}

export function buildWorkbenchHomeModelFromState(
  input: WorkbenchHomeStateSnapshotInput,
): WorkbenchHomeModel {
  const agents = buildAgentItems(
    input.agentsList,
    input.sessionsResult,
    input.sessionSeenAt,
    input.activeSessionKey,
    input.ownStewardSessionKey,
  );
  const contacts = buildContactItems(
    input.sessionsResult,
    input.sessionSeenAt,
    input.activeSessionKey,
    input.ownStewardSessionKey,
  );
  const groups = buildGroupItems(
    input.sessionsResult,
    input.sessionSeenAt,
    input.activeSessionKey,
    input.ownStewardSessionKey,
  );
  const teamAssistants = applyTeamObjectPreferences(
    toTeamEntries(agents, "assistant"),
    input.teamObjects,
  );
  const teamMembers = applyTeamObjectPreferences(
    toTeamEntries(contacts, "member"),
    input.teamObjects,
  );
  const teamSpaces = applyTeamObjectPreferences(toTeamEntries(groups, "space"), input.teamObjects);
  const accounts = countWorkspaceAccounts(input.channelsSnapshot);
  const sessionCount = input.sessionsResult?.sessions.length ?? 0;
  const activeSession = currentSessionSummary(input.activeSessionKey, input.sessionsResult);
  const onlineInstances = input.presenceEntries.length;
  const savedTeamCount = teamSpaces.filter((entry) => entry.saved).length;
  const cronLabel = buildCronLabel(input.cronNext);
  const freshSurface = isFreshEmployeeWorkbenchSurface({
    contactsCount: contacts.length,
    groupsCount: groups.length,
    agentsCount: agents.length,
    guideAcknowledged: input.guideAcknowledged,
  });
  const recentSessions = deriveSessionCards(input.sessionsResult, [
    "direct",
    "group",
    "channel",
  ]).slice(0, 6);
  const contactCards = buildContactCards(input.sessionsResult).slice(0, 6);
  const groupCards = buildGroupCards(input.sessionsResult).slice(0, 6);

  return {
    agents,
    contacts,
    groups,
    teamAssistants,
    teamMembers,
    teamSpaces,
    recentSessions,
    contactCards,
    groupCards,
    accounts,
    sessionCount,
    activeSession,
    onlineInstances,
    savedTeamCount,
    metrics: [
      { label: t("frontstage.workbench.metrics.personas"), value: String(agents.length) },
      { label: t("frontstage.workbench.metrics.contacts"), value: String(contacts.length) },
      { label: t("frontstage.workbench.metrics.groups"), value: String(groups.length) },
      {
        label: t("frontstage.workbench.metrics.sessions"),
        value: String(sessionCount),
        tone: input.connected ? "ok" : "default",
      },
    ],
    signals: buildWorkbenchSignalBundle({
      cronLabel,
      sessionCount,
      contactsCount: contacts.length,
      agentsCount: agents.length,
      groupsCount: groups.length,
      activeAccounts: accounts.active,
      onlineInstances,
      connected: input.connected,
      lastError: input.lastError,
      freshSurface,
      pendingTasks: input.pendingTasks,
      notices: input.notices,
      upcomingCollaboration: input.upcomingCollaboration,
      stewardSuggestion: input.stewardSuggestion,
      schedule: input.schedule,
      // Server-derived next-item label (reuses the cron-label formatter), shown
      // when a real schedule is present; falls back to cronLabel otherwise.
      scheduleNextLabel:
        input.schedule?.nextStartAtMs != null ? buildCronLabel(input.schedule.nextStartAtMs) : null,
    }),
    modules: buildWorkbenchModuleBundle({
      agents,
      contacts,
      groups,
      recentSessions,
      teamAssistants,
      teamMembers,
      teamSpaces,
    }),
  };
}

export function buildWorkbenchHomeModel(input: WorkbenchHomeModelInput): WorkbenchHomeModel {
  const agents = input.shellReadModel?.agents ?? [];
  const contacts = input.shellReadModel?.contacts ?? [];
  const groups = input.shellReadModel?.groups ?? [];
  const teamAssistants = input.shellReadModel?.teamAssistants ?? [];
  const teamMembers = input.shellReadModel?.teamMembers ?? [];
  const teamSpaces = input.collaborationReadModel?.teamSpaces ?? [];
  const recentSessions = input.frontstageModel?.recentSessions ?? [];
  const contactCards = input.frontstageModel?.contactCards ?? [];
  const groupCards = input.frontstageModel?.groupCards ?? [];
  const accounts = input.frontstageModel?.accounts ?? { total: 0, active: 0 };
  const onlineInstances = input.frontstageModel?.onlineInstances ?? 0;
  const sessionCount = input.frontstageModel?.sessionCount ?? recentSessions.length;
  const activeSession = ensureSessionSummary(input.shellReadModel?.activeSession);
  const savedTeamCount = input.collaborationReadModel?.savedTeamCount ?? 0;
  const freshSurface =
    input.frontstageModel?.freshSurface ??
    isFreshEmployeeWorkbenchSurface({
      contactsCount: contactCards.length,
      groupsCount: teamSpaces.length,
      agentsCount: teamAssistants.length,
      guideAcknowledged: input.guideAcknowledged,
    });
  const cronLabel = buildCronLabel(input.cronNext);

  return {
    agents,
    contacts,
    groups,
    teamAssistants,
    teamMembers,
    teamSpaces,
    recentSessions,
    contactCards,
    groupCards,
    accounts,
    sessionCount,
    activeSession,
    onlineInstances,
    savedTeamCount,
    metrics: [
      { label: t("frontstage.workbench.metrics.sessions"), value: String(sessionCount) },
      { label: t("frontstage.workbench.metrics.groups"), value: String(teamSpaces.length) },
      {
        label: t("frontstage.workbench.metrics.connected"),
        value: input.connected ? t("common.yes") : t("common.no"),
        tone: input.connected ? "ok" : "default",
      },
    ],
    signals: buildWorkbenchSignalBundle({
      cronLabel,
      sessionCount,
      contactsCount: contactCards.length,
      agentsCount: teamAssistants.length,
      groupsCount: teamSpaces.length,
      activeAccounts: accounts.active,
      onlineInstances,
      connected: input.connected,
      lastError: input.lastError,
      freshSurface,
      pendingTasks: input.pendingTasks,
      notices: input.notices,
      upcomingCollaboration: input.upcomingCollaboration,
      stewardSuggestion: input.stewardSuggestion,
      schedule: input.schedule,
      scheduleNextLabel:
        input.schedule?.nextStartAtMs != null ? buildCronLabel(input.schedule.nextStartAtMs) : null,
    }),
    modules: buildWorkbenchModuleBundle({
      agents,
      contacts,
      groups,
      recentSessions,
      teamAssistants,
      teamMembers,
      teamSpaces,
    }),
  };
}

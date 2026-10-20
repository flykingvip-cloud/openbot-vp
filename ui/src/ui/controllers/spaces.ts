import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  WorkbenchMyTasksSummary,
  WorkbenchNoticeKindRef,
  WorkbenchNoticesSummary,
  WorkbenchPendingTasksSummary,
  WorkbenchScheduleSummary,
  WorkbenchStewardSuggestionSummary,
  WorkbenchUpcomingCollaborationSummary,
} from "../ports/employee/views/workbench-signals.ts";
import type { CollaborationSpacesListResult } from "../types.ts";
import { loadSessions, type SessionsLoadState } from "./sessions.ts";

const LEGACY_SPACE_AVATAR_RE = /unexpected property ['"]avatar['"]/i;

export type WorkbenchSpaceHumanMemberDraft = {
  userId: string;
  name?: string;
  handle?: string;
};

export type WorkbenchSpaceBotMemberDraft = {
  agentId: string;
  name?: string;
};

export type WorkbenchSpaceMembersUpdateParams = {
  groupId: string;
  title?: string;
  avatar?: string;
  visibilityScope?: string;
  purpose?: string;
  currentMission?: string;
  coordinatorBotId?: string;
  collaborationMode?: string;
  workspacePath?: string;
  successCriteria?: string[];
  systemInstructions?: string[];
  confidentialityTier?: string;
  finalDecisionPolicy?: {
    mode?: string;
    defaultFinalDeciderRole?: string;
    allowAgentPublishProposal?: boolean;
  };
  tenantId?: string;
  ownerPositionId?: string;
  ownerPositionLabel?: string;
  ownerUserLabel?: string;
  actorEmployeeUserId?: string;
  members: {
    humans?: WorkbenchSpaceHumanMemberDraft[];
    bots?: WorkbenchSpaceBotMemberDraft[];
  };
  invites?: {
    humans?: WorkbenchSpaceHumanMemberDraft[];
    bots?: WorkbenchSpaceBotMemberDraft[];
  };
};

export type WorkbenchSpacesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  collaborationSpacesLoading: boolean;
  collaborationSpacesResult: CollaborationSpacesListResult;
  collaborationSpacesError: string | null;
  /** Pending-work projection — merged into the 待办事项 card (co-loaded). */
  workbenchPendingTasks?: WorkbenchPendingTasksSummary | null;
  /**
   * Notices projection (co-loaded). Meeting-invite / minutes fold into 待办事项;
   * governance counts feed the steward suggestion path, not a home card.
   */
  workbenchNotices?: WorkbenchNoticesSummary | null;
  /** Upcoming-collaboration projection — merged into the 待办事项 card (co-loaded). */
  workbenchUpcomingCollaboration?: WorkbenchUpcomingCollaborationSummary | null;
  /** Actor-scoped schedule projection for the 今日日程 card (Phase A0, co-loaded). */
  workbenchSchedule?: WorkbenchScheduleSummary | null;
  /** Single steward (大白) suggestion line for the home (M4, co-loaded). */
  workbenchStewardSuggestion?: WorkbenchStewardSuggestionSummary | null;
  /** Lane counts for 我的任务 tabs (cron / 待我处理 / 开发监督). */
  workbenchMyTasks?: WorkbenchMyTasksSummary | null;
};

export type WorkbenchSpacesLoadState = WorkbenchSpacesState;

export type WorkbenchSpacesLoadOptions = {
  /** Personal workbench default. Mesh / 机巢 must pass `"tenant"`. */
  scope?: "self" | "tenant";
};

export type WorkbenchSpacesManageState = WorkbenchSpacesState;

export type WorkbenchSpaceResetParams = {
  groupId: string;
};

export type WorkbenchSpaceDissolveParams = {
  groupId: string;
};

export type WorkbenchSpaceLeaveParams = {
  groupId: string;
};

/** Actor-local IANA zone for schedule "today" boundaries on the gateway read-model. */
export function resolveWorkbenchScheduleListParams(): { timeZone: string } {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof timeZone === "string" && timeZone.trim()) {
      return { timeZone: timeZone.trim() };
    }
  } catch {
    // Fall through to UTC when the runtime cannot resolve a local zone.
  }
  return { timeZone: "UTC" };
}

export type WorkbenchSpaceTransferOwnershipParams = {
  groupId: string;
  newOwnerUserId: string;
  newOwnerLabel?: string;
};

async function reloadCollaborationWorkbenchProjection(state: WorkbenchSpacesManageState) {
  await loadWorkbenchSpaces(state);
  if ("sessionsLoading" in state && "sessionsResult" in state) {
    await loadSessions(state as WorkbenchSpacesManageState & SessionsLoadState);
  }
}

export async function loadWorkbenchSpaces(
  state: WorkbenchSpacesLoadState,
  options?: WorkbenchSpacesLoadOptions,
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.collaborationSpacesLoading) {
    return;
  }
  state.collaborationSpacesLoading = true;
  state.collaborationSpacesError = null;
  try {
    const params = options?.scope === "tenant" ? { scope: "tenant" as const } : {};
    const res = await state.client.request<CollaborationSpacesListResult | undefined>(
      "collaboration.spaces.list",
      params,
    );
    state.collaborationSpacesResult = res ?? { spaces: [] };
  } catch (err) {
    state.collaborationSpacesError = String(err);
  } finally {
    state.collaborationSpacesLoading = false;
  }
  // Refresh the home workbench signal cards alongside the spaces list.
  await refreshWorkbenchSignals(state);
}

/**
 * Refresh the deterministic home workbench signal projections that back the
 * two overview cards (今日日程 / 待办事项). Reused by loadWorkbenchSpaces and a
 * periodic refresh. On failure the relevant value is cleared (null) so the card
 * falls back to its empty/proxy state instead of showing stale real counts.
 */
export async function refreshWorkbenchSignals(state: WorkbenchSpacesLoadState): Promise<void> {
  const client = state.client;
  if (!client || !state.connected) {
    return;
  }
  // Pending-work projection (feeds 待办事项). The read-model returns flat counts
  // plus top auto-extracted `items` (task / governance / invite); we normalize
  // those into clickable card entries ({id,title}).
  try {
    const res = await client.request<{
      totalCount?: number;
      taskCount?: number;
      ackRequiredCount?: number;
      governanceCount?: number;
      inviteCount?: number;
      items?: Array<{ id?: string; title?: string }>;
    }>("workbench.pending-tasks.list", {});
    state.workbenchPendingTasks = res
      ? {
          totalCount: res.totalCount ?? 0,
          taskCount: res.taskCount ?? 0,
          ackRequiredCount: res.ackRequiredCount ?? 0,
          governanceCount: res.governanceCount ?? 0,
          inviteCount: res.inviteCount ?? 0,
          items: Array.isArray(res.items)
            ? res.items
                .filter((it) => typeof it.id === "string" && typeof it.title === "string")
                .map((it) => ({ id: String(it.id), title: String(it.title) }))
            : [],
        }
      : null;
  } catch {
    state.workbenchPendingTasks = null;
  }
  // Notices projection (workbench.notices.list). Actor-scoped; meeting-review
  // kinds fold into 待办事项, governance kinds stay off the home strip.
  try {
    const res = await client.request<{
      conflictCount?: number;
      attentionCount?: number;
      meetingInviteReviewCount?: number;
      meetingMinutesConfirmCount?: number;
      items?: Array<{ id?: string; kind?: string; count?: number }>;
    }>("workbench.notices.list", {});
    const noticeKinds = new Set<string>([
      "governance-conflict",
      "governance-attention",
      "meeting-invite-review",
      "meeting-minutes-confirm",
    ]);
    state.workbenchNotices = res
      ? {
          conflictCount: res.conflictCount ?? 0,
          attentionCount: res.attentionCount ?? 0,
          meetingInviteReviewCount: res.meetingInviteReviewCount ?? 0,
          meetingMinutesConfirmCount: res.meetingMinutesConfirmCount ?? 0,
          items: Array.isArray(res.items)
            ? res.items
                .filter(
                  (it): it is { id: string; kind: WorkbenchNoticeKindRef; count: number } =>
                    typeof it.id === "string" &&
                    typeof it.kind === "string" &&
                    noticeKinds.has(it.kind) &&
                    typeof it.count === "number",
                )
                .map((it) => ({ id: it.id, kind: it.kind, count: it.count }))
            : [],
        }
      : null;
  } catch {
    state.workbenchNotices = null;
  }
  // Upcoming-collaboration projection (merged into 待办事项): spaces needing the
  // actor's response, from workbench.upcoming-collaboration.list.
  try {
    const res = await client.request<{
      needsResponseCount?: number;
      decisionCount?: number;
      reviewCount?: number;
      activeCount?: number;
      items?: Array<{ id?: string; title?: string; summary?: string }>;
    }>("workbench.upcoming-collaboration.list", {});
    state.workbenchUpcomingCollaboration = res
      ? {
          needsResponseCount: res.needsResponseCount ?? 0,
          decisionCount: res.decisionCount ?? 0,
          reviewCount: res.reviewCount ?? 0,
          activeCount: res.activeCount ?? 0,
          items: Array.isArray(res.items)
            ? res.items
                .filter((it) => typeof it.id === "string" && typeof it.title === "string")
                .map((it) => ({
                  id: String(it.id),
                  title: String(it.title),
                  ...(typeof it.summary === "string" && it.summary.trim()
                    ? { meta: it.summary.trim() }
                    : {}),
                }))
            : [],
        }
      : null;
  } catch {
    state.workbenchUpcomingCollaboration = null;
  }
  // Schedule projection (今日日程, Phase A0): actor-scoped server read-model that
  // merges real ScheduleEntries (none until Phase A1) with the actor's cron-derived
  // entries, replacing the front-end cronNext proxy. On failure the value is
  // cleared so the card falls back to the legacy cronLabel + sessionCount.
  try {
    const res = await client.request<{
      todayCount?: number;
      upcomingCount?: number;
      cronDerivedCount?: number;
      nextStartAtMs?: number;
      nextTitle?: string;
      hasRealEntries?: boolean;
      items?: Array<{
        id?: string;
        title?: string;
        startAtMs?: number;
        kind?: string;
        cronDerived?: boolean;
      }>;
    }>("workbench.schedule.list", resolveWorkbenchScheduleListParams());
    state.workbenchSchedule = res
      ? {
          todayCount: res.todayCount ?? 0,
          upcomingCount: res.upcomingCount ?? 0,
          cronDerivedCount: res.cronDerivedCount ?? 0,
          ...(typeof res.nextStartAtMs === "number" ? { nextStartAtMs: res.nextStartAtMs } : {}),
          ...(typeof res.nextTitle === "string" ? { nextTitle: res.nextTitle } : {}),
          hasRealEntries: res.hasRealEntries ?? false,
          items: Array.isArray(res.items)
            ? res.items
                .filter((it) => typeof it.id === "string" && typeof it.startAtMs === "number")
                .map((it) => ({
                  id: String(it.id),
                  title: typeof it.title === "string" ? it.title : "",
                  startAtMs: Number(it.startAtMs),
                  kind: typeof it.kind === "string" ? it.kind : "personal",
                  cronDerived: Boolean(it.cronDerived),
                }))
            : [],
        }
      : null;
  } catch {
    state.workbenchSchedule = null;
  }
  // Unified 我的任务 lane counts (cron / supervised / assigned). Feeds the tab badges.
  try {
    const res = await client.request<{
      totalCount?: number;
      cronCount?: number;
      supervisedCount?: number;
      assignedCount?: number;
    }>("workbench.my-tasks.list", {});
    state.workbenchMyTasks = res
      ? {
          totalCount: res.totalCount ?? 0,
          cronCount: res.cronCount ?? 0,
          supervisedCount: res.supervisedCount ?? 0,
          assignedCount: res.assignedCount ?? 0,
        }
      : null;
  } catch {
    state.workbenchMyTasks = null;
  }
  // Steward suggestion (M4): the single 大白 "what to look at first" line derived
  // from the pending / notices / upcoming signals. The server returns the final
  // text (deterministic template in M4a); a null suggestion hides the bar.
  try {
    const res = await client.request<{
      suggestion?: {
        text?: string;
        kind?: string;
        source?: "template" | "llm";
      } | null;
    }>("workbench.steward-suggestion.get", {});
    const suggestion = res?.suggestion;
    state.workbenchStewardSuggestion =
      suggestion && typeof suggestion.text === "string" && suggestion.text.trim()
        ? {
            text: suggestion.text,
            kind: suggestion.kind ?? "",
            source: suggestion.source === "llm" ? "llm" : "template",
          }
        : null;
  } catch {
    state.workbenchStewardSuggestion = null;
  }
  // CollabDispatch D1: mirror pending organizer meeting tickets into chat confirm state.
  try {
    const { syncMeetingPendingConfirmation } = await import("./meeting-confirmation.ts");
    await syncMeetingPendingConfirmation(state as never);
  } catch {
    // Meeting confirm sync is best-effort; signals already refreshed.
  }
}

export type WorkbenchScheduleEntryDraft = {
  title: string;
  startAtMs: number;
  endAtMs?: number;
  kind?: string;
  timezone?: string;
};

/**
 * Manual schedule add (Phase A1): writes one ScheduleEntry via schedule.entry.upsert
 * (actor-scoped server-side) then refreshes the home signal cards so the new entry
 * surfaces immediately on the 今日日程 card. No-op when disconnected.
 */
export async function upsertWorkbenchScheduleEntry(
  state: WorkbenchSpacesState,
  draft: WorkbenchScheduleEntryDraft,
) {
  if (!state.client || !state.connected) {
    return null;
  }
  const result = await state.client.request("schedule.entry.upsert", {
    title: draft.title,
    startAtMs: draft.startAtMs,
    ...(draft.endAtMs !== undefined ? { endAtMs: draft.endAtMs } : {}),
    ...(draft.kind !== undefined ? { kind: draft.kind } : {}),
    ...(draft.timezone !== undefined ? { timezone: draft.timezone } : {}),
  });
  await refreshWorkbenchSignals(state);
  return result;
}

/**
 * Manual schedule cancel (Phase A1): soft-cancels one entry via schedule.entry.cancel
 * (scoped to the actor's own store) then refreshes the cards. No-op when disconnected.
 */
export async function cancelWorkbenchScheduleEntry(state: WorkbenchSpacesState, id: string) {
  if (!state.client || !state.connected) {
    return null;
  }
  const result = await state.client.request("schedule.entry.cancel", { id });
  await refreshWorkbenchSignals(state);
  return result;
}

export async function updateWorkbenchSpaceMembers(
  state: WorkbenchSpacesManageState,
  params: WorkbenchSpaceMembersUpdateParams,
) {
  if (!state.client || !state.connected) {
    return null;
  }
  state.collaborationSpacesError = null;
  let result: unknown;
  try {
    result = await state.client.request("collaboration.spaces.members.update", params);
  } catch (error) {
    if (params.avatar && LEGACY_SPACE_AVATAR_RE.test(String(error))) {
      const { avatar: _avatar, ...legacyCompatibleParams } = params;
      result = await state.client.request(
        "collaboration.spaces.members.update",
        legacyCompatibleParams,
      );
    } else {
      throw error;
    }
  }
  await loadWorkbenchSpaces(state);
  return result;
}

export async function resetWorkbenchSpace(
  state: WorkbenchSpacesManageState,
  params: WorkbenchSpaceResetParams,
) {
  if (!state.client || !state.connected) {
    return null;
  }
  state.collaborationSpacesError = null;
  const result = await state.client.request("collaboration.spaces.reset", params);
  await reloadCollaborationWorkbenchProjection(state);
  return result;
}

export async function dissolveWorkbenchSpace(
  state: WorkbenchSpacesManageState,
  params: WorkbenchSpaceDissolveParams,
) {
  if (!state.client || !state.connected) {
    return null;
  }
  state.collaborationSpacesError = null;
  const result = await state.client.request("collaboration.spaces.dissolve", params);
  await reloadCollaborationWorkbenchProjection(state);
  return result;
}

export async function leaveWorkbenchSpace(
  state: WorkbenchSpacesManageState,
  params: WorkbenchSpaceLeaveParams,
) {
  if (!state.client || !state.connected) {
    return null;
  }
  state.collaborationSpacesError = null;
  const result = await state.client.request("collaboration.spaces.leave", params);
  await loadWorkbenchSpaces(state);
  return result;
}

export async function transferWorkbenchSpaceOwnership(
  state: WorkbenchSpacesManageState,
  params: WorkbenchSpaceTransferOwnershipParams,
) {
  if (!state.client || !state.connected) {
    return null;
  }
  state.collaborationSpacesError = null;
  const result = await state.client.request("collaboration.spaces.transferOwnership", params);
  await loadWorkbenchSpaces(state);
  return result;
}

import type { GatewayBrowserClient } from "../gateway.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";

export type CollaborationWakeTimelineRow = {
  from: string;
  to: string;
  source: string;
  outcome: string;
  at: number;
  wakeId: string;
};

export type CollaborationWakeEventRow = {
  wakeId: string;
  groupId: string;
  taskId?: string;
  itemId?: string;
  fromAgentId: string;
  toAgentIds: readonly string[];
  source: string;
  outcome: string;
  at: number;
  reason?: string;
  relatedId?: string;
};

export type CollaborationBoardClaimRow = {
  itemId: string;
  groupId: string;
  taskId: string;
  title: string;
  status: string;
  publishedBy?: string;
  claimantId?: string;
  claimedAt?: number;
  submissionId?: string;
  submittedAt?: number;
};

export type CollaborationPeerReviewRow = {
  reviewId: string;
  groupId: string;
  taskId: string;
  itemId: string;
  submissionId: string;
  reviewerId: string;
  authorId: string;
  verdict: string;
  comment?: string;
  at: number;
};

export type CollaborationMemberProgressSnapshot = {
  itemCount: number;
  memberCount: number;
  members: Array<{
    memberId: string;
    itemId: string;
    taskId: string;
    title: string;
    status: string;
    isSubmitted: boolean;
    isActiveWork: boolean;
  }>;
  unclaimed: Array<{ itemId: string; taskId: string; title: string; status: string }>;
  gaps: string[];
};

export type CollaborationObservabilitySnapshot = {
  groupId: string;
  taskId: string | null;
  events: CollaborationWakeEventRow[];
  timeline: CollaborationWakeTimelineRow[];
  boardItems: CollaborationBoardClaimRow[];
  peerReviews: CollaborationPeerReviewRow[];
  memberProgress: CollaborationMemberProgressSnapshot | null;
};

export type CollaborationObservabilityState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  workbenchTeamSelectedKey?: string;
  sessionsResult: SessionsListResult | null;
  workbenchTaskDetailId?: string | null;
  collaborationLearningSnapshot?: { tasks?: Array<{ taskId: string }> } | null;
  collaborationObservabilityLoading: boolean;
  collaborationObservabilityError: string | null;
  collaborationObservabilitySnapshot: CollaborationObservabilitySnapshot | null;
  collaborationObservabilityRequestKey: string | null;
};

function normalizeValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function extractSpaceIdentity(value: string | null | undefined) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("space:")) {
    return normalized.slice("space:".length).trim() || null;
  }
  const scopedMatch = normalized.match(/(?:^|:)space:([^:]+)$/);
  return scopedMatch?.[1]?.trim() || null;
}

function hasGroupScope(row: GatewaySessionRow | null | undefined) {
  return Boolean(
    row?.groupId?.trim() ||
    row?.collaborationGroupProfile?.groupId?.trim() ||
    row?.collaborationParticipationOverlay?.groupId?.trim(),
  );
}

function resolveSelectionKeys(state: CollaborationObservabilityState) {
  return [
    ...new Set(
      [state.sessionKey, state.workbenchTeamSelectedKey]
        .map((value) => normalizeValue(value))
        .filter(Boolean) as string[],
    ),
  ];
}

function resolveActiveSessionRow(state: CollaborationObservabilityState): GatewaySessionRow | null {
  const rows = state.sessionsResult?.sessions ?? [];
  const exactRow = rows.find((entry) => entry.key === state.sessionKey) ?? null;
  if (hasGroupScope(exactRow)) {
    return exactRow;
  }

  const selectionKeys = resolveSelectionKeys(state);
  const selectionIdentities = new Set(
    selectionKeys.map((value) => extractSpaceIdentity(value)).filter(Boolean) as string[],
  );

  const matchingRows = rows
    .filter((entry) => {
      if (selectionKeys.includes(entry.key)) {
        return true;
      }
      const key = normalizeValue(entry.key);
      if (!key) {
        return false;
      }
      return [...selectionIdentities].some((identity) => {
        const normalizedIdentity = identity.trim();
        return (
          key === `space:${normalizedIdentity}` ||
          key.endsWith(`:space:${normalizedIdentity}`) ||
          entry.groupId?.trim() === normalizedIdentity ||
          entry.collaborationGroupProfile?.groupId?.trim() === normalizedIdentity ||
          entry.collaborationParticipationOverlay?.groupId?.trim() === normalizedIdentity
        );
      });
    })
    .toSorted((left, right) => {
      const leftScoped = hasGroupScope(left) ? 1 : 0;
      const rightScoped = hasGroupScope(right) ? 1 : 0;
      if (rightScoped !== leftScoped) {
        return rightScoped - leftScoped;
      }
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    });

  return matchingRows[0] ?? exactRow;
}

function resolveGroupId(state: CollaborationObservabilityState): string | null {
  const sessionRow = resolveActiveSessionRow(state);
  return (
    sessionRow?.groupId?.trim() ||
    sessionRow?.collaborationGroupProfile?.groupId?.trim() ||
    sessionRow?.collaborationParticipationOverlay?.groupId?.trim() ||
    null
  );
}

function resolveTaskId(state: CollaborationObservabilityState): string | null {
  const selected = normalizeValue(state.workbenchTaskDetailId);
  if (selected) {
    return selected;
  }
  const firstTask = state.collaborationLearningSnapshot?.tasks?.[0]?.taskId?.trim();
  return firstTask || null;
}

export function resetCollaborationObservabilitySnapshot(state: CollaborationObservabilityState) {
  state.collaborationObservabilityLoading = false;
  state.collaborationObservabilityError = null;
  state.collaborationObservabilitySnapshot = null;
  state.collaborationObservabilityRequestKey = null;
}

type WhoWokeWhomPayload = {
  events?: CollaborationWakeEventRow[];
  timeline?: CollaborationWakeTimelineRow[];
};

type BoardItemsPayload = { items?: CollaborationBoardClaimRow[] };
type PeerReviewsPayload = { reviews?: CollaborationPeerReviewRow[] };
type MemberProgressPayload = { progress?: CollaborationMemberProgressSnapshot };

export async function loadCollaborationObservabilitySnapshot(
  state: CollaborationObservabilityState,
  opts?: { force?: boolean; taskId?: string | null },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const groupId = resolveGroupId(state);
  if (!groupId) {
    resetCollaborationObservabilitySnapshot(state);
    return;
  }
  const taskId = opts?.taskId === undefined ? resolveTaskId(state) : normalizeValue(opts.taskId);
  const requestKey = `${groupId}::${taskId ?? ""}`;
  if (!opts?.force) {
    if (state.collaborationObservabilityLoading) {
      return;
    }
    if (
      state.collaborationObservabilityRequestKey === requestKey &&
      state.collaborationObservabilitySnapshot
    ) {
      return;
    }
  }

  state.collaborationObservabilityLoading = true;
  state.collaborationObservabilityError = null;
  try {
    const wakeParams = taskId ? { groupId, taskId } : { groupId };
    const wake = await state.client.request<WhoWokeWhomPayload>(
      "collaboration.task.whoWokeWhom",
      wakeParams,
    );

    let boardItems: CollaborationBoardClaimRow[] = [];
    let peerReviews: CollaborationPeerReviewRow[] = [];
    let memberProgress: CollaborationMemberProgressSnapshot | null = null;

    if (taskId) {
      const [board, peers, progress] = await Promise.all([
        state.client
          .request<BoardItemsPayload>("collaboration.task.listBoardItems", { groupId, taskId })
          .catch(() => ({ items: [] as CollaborationBoardClaimRow[] })),
        state.client
          .request<PeerReviewsPayload>("collaboration.task.listPeerReviews", { groupId, taskId })
          .catch(() => ({ reviews: [] as CollaborationPeerReviewRow[] })),
        state.client
          .request<MemberProgressPayload>("collaboration.task.getMemberProgress", {
            groupId,
            taskId,
          })
          .catch(() => ({ progress: undefined })),
      ]);
      boardItems = board.items ?? [];
      peerReviews = peers.reviews ?? [];
      memberProgress = progress.progress ?? null;
    }

    state.collaborationObservabilitySnapshot = {
      groupId,
      taskId,
      events: wake.events ?? [],
      timeline: wake.timeline ?? [],
      boardItems,
      peerReviews,
      memberProgress,
    };
    state.collaborationObservabilityRequestKey = requestKey;
  } catch (err) {
    state.collaborationObservabilityError = String(err);
    state.collaborationObservabilitySnapshot = null;
    state.collaborationObservabilityRequestKey = requestKey;
  } finally {
    state.collaborationObservabilityLoading = false;
  }
}

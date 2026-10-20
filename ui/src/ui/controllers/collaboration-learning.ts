import type { GatewayBrowserClient } from "../gateway.ts";
import type { WorkbenchCollaborationGovernanceSnapshot } from "../ports/employee/views/workbench-types.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";

type GatewayCollaborationLearningSnapshot = NonNullable<
  WorkbenchCollaborationGovernanceSnapshot["learningObjects"]
>;

export type CollaborationLearningState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  workbenchTeamSelectedKey?: string;
  sessionsResult: SessionsListResult | null;
  collaborationLearningLoading: boolean;
  collaborationLearningError: string | null;
  collaborationLearningSnapshot: GatewayCollaborationLearningSnapshot | null;
  collaborationLearningRequestKey: string | null;
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

function hasLearningScope(row: GatewaySessionRow | null | undefined) {
  return Boolean(
    row?.groupId?.trim() ||
    row?.collaborationGroupProfile?.groupId?.trim() ||
    row?.collaborationParticipationOverlay?.groupId?.trim(),
  );
}

function resolveSelectionKeys(state: CollaborationLearningState) {
  return [
    ...new Set(
      [state.sessionKey, state.workbenchTeamSelectedKey]
        .map((value) => normalizeValue(value))
        .filter(Boolean) as string[],
    ),
  ];
}

function resolveActiveSessionRow(state: CollaborationLearningState): GatewaySessionRow | null {
  const rows = state.sessionsResult?.sessions ?? [];
  const exactRow = rows.find((entry) => entry.key === state.sessionKey) ?? null;
  if (hasLearningScope(exactRow)) {
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
      const leftScoped = hasLearningScope(left) ? 1 : 0;
      const rightScoped = hasLearningScope(right) ? 1 : 0;
      if (rightScoped !== leftScoped) {
        return rightScoped - leftScoped;
      }
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    });

  return matchingRows[0] ?? exactRow;
}

function resolveLearningScope(state: CollaborationLearningState) {
  const sessionRow = resolveActiveSessionRow(state);
  const groupId =
    sessionRow?.groupId?.trim() ||
    sessionRow?.collaborationGroupProfile?.groupId?.trim() ||
    sessionRow?.collaborationParticipationOverlay?.groupId?.trim() ||
    "";
  const botId = sessionRow?.collaborationParticipationOverlay?.botId?.trim() || "";
  if (!groupId) {
    return null;
  }
  return {
    groupId,
    ...(botId ? { botId } : {}),
  };
}

export function resetCollaborationLearningSnapshot(state: CollaborationLearningState) {
  state.collaborationLearningLoading = false;
  state.collaborationLearningError = null;
  state.collaborationLearningSnapshot = null;
  state.collaborationLearningRequestKey = null;
}

export async function loadCollaborationLearningSnapshot(
  state: CollaborationLearningState,
  opts?: { force?: boolean },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const scope = resolveLearningScope(state);
  if (!scope) {
    resetCollaborationLearningSnapshot(state);
    return;
  }
  const requestKey = `${scope.groupId}::${scope.botId ?? ""}`;
  if (!opts?.force) {
    if (state.collaborationLearningLoading) {
      return;
    }
    if (
      state.collaborationLearningRequestKey === requestKey &&
      state.collaborationLearningSnapshot
    ) {
      return;
    }
  }
  state.collaborationLearningLoading = true;
  state.collaborationLearningError = null;
  try {
    const payload = await state.client.request<GatewayCollaborationLearningSnapshot>(
      "collaboration.learning.snapshot",
      scope,
    );
    state.collaborationLearningSnapshot = payload;
    state.collaborationLearningRequestKey = requestKey;
  } catch (err) {
    state.collaborationLearningError = String(err);
    state.collaborationLearningSnapshot = null;
    state.collaborationLearningRequestKey = requestKey;
  } finally {
    state.collaborationLearningLoading = false;
  }
}

import type { CollaborationRoundPlanPayload } from "../../../../src/gateway/collaboration-dispatch/types.js";

export type CollaborationRoundPlanHost = {
  sessionKey: string;
  collaborationRoundPlan: CollaborationRoundPlanPayload | null;
  collaborationRoundPlanSessionKey: string | null;
  collaborationRoundSummaries: Record<string, string>;
};

export function handleCollaborationRoundPlanEvent(
  state: CollaborationRoundPlanHost,
  payload: CollaborationRoundPlanPayload | undefined,
) {
  if (!payload?.sessionKey?.trim()) {
    return;
  }
  state.collaborationRoundPlan = payload;
  state.collaborationRoundPlanSessionKey = payload.sessionKey.trim();
  if (payload.roundId.trim()) {
    state.collaborationRoundSummaries = {
      ...state.collaborationRoundSummaries,
      [payload.roundId.trim()]: payload.summaryText,
    };
  }
}

export function resolveActiveCollaborationRoundSummaries(state: CollaborationRoundPlanHost) {
  const activeSessionKey = state.sessionKey.trim();
  if (!activeSessionKey || state.collaborationRoundPlanSessionKey !== activeSessionKey) {
    return state.collaborationRoundSummaries;
  }
  return state.collaborationRoundSummaries;
}

export function resolveActiveCollaborationRoundPlan(state: CollaborationRoundPlanHost) {
  const activeSessionKey = state.sessionKey.trim();
  if (!activeSessionKey || state.collaborationRoundPlanSessionKey !== activeSessionKey) {
    return null;
  }
  return state.collaborationRoundPlan;
}

export function clearCollaborationRoundPlan(state: CollaborationRoundPlanHost) {
  state.collaborationRoundPlan = null;
  state.collaborationRoundPlanSessionKey = null;
}

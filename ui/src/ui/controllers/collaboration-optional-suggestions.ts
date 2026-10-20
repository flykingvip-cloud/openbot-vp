export type CollaborationOptionalSuggestion = {
  id: string;
  roundId: string;
  sessionKey: string;
  agentId: string;
  agentName: string;
  title: string;
  body: string;
  recordedAtMs: number;
};

export type CollaborationOptionalSuggestionsHost = {
  sessionKey: string;
  collaborationOptionalSuggestions: CollaborationOptionalSuggestion[];
};

export function handleCollaborationOptionalSuggestionEvent(
  state: CollaborationOptionalSuggestionsHost,
  payload:
    | {
        roundId?: string;
        sessionKey?: string;
        agentId?: string;
        agentName?: string;
        title?: string;
        body?: string;
        recordedAtMs?: number;
      }
    | undefined,
) {
  const sessionKey = payload?.sessionKey?.trim();
  if (!sessionKey || !payload?.roundId?.trim() || !payload.agentId?.trim()) {
    return;
  }
  const entry: CollaborationOptionalSuggestion = {
    id: `${payload.roundId}:${payload.agentId}:${payload.recordedAtMs ?? Date.now()}`,
    roundId: payload.roundId.trim(),
    sessionKey,
    agentId: payload.agentId.trim(),
    agentName: payload.agentName?.trim() || payload.agentId.trim(),
    title: payload.title?.trim() || `${payload.agentName ?? payload.agentId} 的可选补充`,
    body: payload.body?.trim() || "",
    recordedAtMs: payload.recordedAtMs ?? Date.now(),
  };
  state.collaborationOptionalSuggestions = [
    entry,
    ...state.collaborationOptionalSuggestions.filter((item) => item.id !== entry.id),
  ].slice(0, 12);
}

export function resolveActiveCollaborationOptionalSuggestions(
  state: CollaborationOptionalSuggestionsHost,
) {
  const activeSessionKey = state.sessionKey.trim();
  if (!activeSessionKey) {
    return [];
  }
  return (state.collaborationOptionalSuggestions ?? []).filter(
    (item) => item.sessionKey.trim() === activeSessionKey,
  );
}

export function clearCollaborationOptionalSuggestions(state: CollaborationOptionalSuggestionsHost) {
  state.collaborationOptionalSuggestions = [];
}

export function dismissCollaborationOptionalSuggestion(
  state: CollaborationOptionalSuggestionsHost,
  id: string,
) {
  const normalized = id.trim();
  if (!normalized) {
    return;
  }
  state.collaborationOptionalSuggestions = state.collaborationOptionalSuggestions.filter(
    (item) => item.id !== normalized,
  );
}

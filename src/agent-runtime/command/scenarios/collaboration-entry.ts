/** Existing explicit collaboration routing evidence, not authorization or task lifecycle state. */
export type CollaborationSessionScope = {
  groupId?: string;
  space?: string;
  collaborationGroupProfile?: { groupId?: string };
};

/**
 * Group discussion turns set CollaborationRoundInvoked even when the per-bot
 * session entry omits space/groupId. Those turns still use collaboration assembly.
 */
export function shouldUseCollaborationRuntimeAssembly(params: {
  collaborationGroupId?: string | null;
  sessionEntry?: CollaborationSessionScope;
  collaborationRoundInvoked?: boolean;
}): boolean {
  const groupId = params.collaborationGroupId?.trim();
  if (params.collaborationRoundInvoked && groupId) {
    return true;
  }
  return isCollaborationGroupRuntimeSession({
    groupId,
    sessionEntry: params.sessionEntry,
  });
}

export function isCollaborationGroupRuntimeSession(params: {
  groupId?: string | null;
  sessionEntry?: CollaborationSessionScope;
}): boolean {
  const groupId = params.groupId?.trim();
  if (!groupId) {
    return false;
  }
  if (params.sessionEntry?.collaborationGroupProfile?.groupId?.trim() === groupId) {
    return true;
  }
  return (
    params.sessionEntry?.groupId?.trim() === groupId ||
    params.sessionEntry?.space?.trim() === groupId
  );
}

/** Prefer explicit CollaborationGroupId from the turn context over session-key heuristics. */
export function resolveCollaborationGroupIdForRun(params: {
  collaborationGroupId?: string | null;
  groupSessionId?: string | null;
  sessionEntry?: CollaborationSessionScope;
}): string | undefined {
  const explicit = params.collaborationGroupId?.trim();
  if (explicit) {
    return explicit;
  }
  const fromGroupKey = params.groupSessionId?.trim();
  if (fromGroupKey) {
    return fromGroupKey;
  }
  return (
    params.sessionEntry?.collaborationGroupProfile?.groupId?.trim() ||
    params.sessionEntry?.groupId?.trim() ||
    params.sessionEntry?.space?.trim() ||
    undefined
  );
}

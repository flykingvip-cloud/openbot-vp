import type { GatewaySessionRow, SessionsListResult } from "../types.ts";

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

/** True when the chat key is itself a group/space lane (`space:…` or `…:space:…`). */
export function isGroupScopedSessionKey(sessionKey: string | null | undefined): boolean {
  return extractSpaceIdentity(sessionKey) !== null;
}

function hasGroupScope(row: GatewaySessionRow | null | undefined) {
  return Boolean(
    row?.groupId?.trim() ||
    row?.collaborationGroupProfile?.groupId?.trim() ||
    row?.collaborationParticipationOverlay?.groupId?.trim(),
  );
}

export function resolveGroupIdFromSessionContext(params: {
  sessionKey: string;
  sessionsResult: SessionsListResult | null;
  workbenchTeamSelectedKey?: string | null;
}): string | null {
  const rows = params.sessionsResult?.sessions ?? [];
  const sessionKey = normalizeValue(params.sessionKey);
  if (!sessionKey) {
    return null;
  }

  const exactRow = rows.find((entry) => entry.key === sessionKey) ?? null;
  if (hasGroupScope(exactRow)) {
    return (
      exactRow?.groupId?.trim() ||
      exactRow?.collaborationGroupProfile?.groupId?.trim() ||
      exactRow?.collaborationParticipationOverlay?.groupId?.trim() ||
      null
    );
  }

  const selectionKeys = [
    ...new Set(
      [sessionKey, params.workbenchTeamSelectedKey]
        .map((value) => normalizeValue(value))
        .filter(Boolean) as string[],
    ),
  ];
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

  const row = matchingRows[0] ?? exactRow;
  return (
    row?.groupId?.trim() ||
    row?.collaborationGroupProfile?.groupId?.trim() ||
    row?.collaborationParticipationOverlay?.groupId?.trim() ||
    null
  );
}

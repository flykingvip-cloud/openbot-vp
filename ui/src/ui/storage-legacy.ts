export type DeprecatedPersistedWorkbenchTeamState = {
  workspaceTeamObjects?: unknown;
  workspaceTeamOrder?: unknown;
  workbenchTeamObjects?: unknown;
  workbenchTeamOrder?: unknown;
};

const DEPRECATED_WORKBENCH_TEAM_METADATA_KEYS = [
  "workspaceTeamObjects",
  "workspaceTeamOrder",
  "workbenchTeamObjects",
  "workbenchTeamOrder",
] as const;

export function hasDeprecatedWorkbenchTeamMetadata(
  parsed: Partial<DeprecatedPersistedWorkbenchTeamState>,
): parsed is Partial<DeprecatedPersistedWorkbenchTeamState> &
  DeprecatedPersistedWorkbenchTeamState {
  return DEPRECATED_WORKBENCH_TEAM_METADATA_KEYS.some((key) => key in parsed);
}

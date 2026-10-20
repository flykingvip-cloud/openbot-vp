/**
 * Phase 1B item 5 fail-closed identity checks.
 *
 * Wired into the tool-cwd read lookup only. Does not flip the resolver
 * write switch and does not attach production write-path miss=deny.
 */
export type FailClosedIdentityInput = {
  catalogRecordCount?: number;
  agentId?: string;
  agentAssetId?: string;
  path?: string;
  realpath?: string;
  displayName?: string;
};

export type FailClosedIdentityResult =
  | { ok: true; agentAssetId: string }
  | { ok: false; reason: string };

export function assertFailClosedWorkspaceIdentity(
  input: FailClosedIdentityInput,
): FailClosedIdentityResult {
  if (input.path || input.realpath || input.displayName) {
    return { ok: false, reason: "identity_from_path_or_name_forbidden" };
  }
  if (input.catalogRecordCount === 0 || input.catalogRecordCount == null) {
    return { ok: false, reason: "empty_catalog_synthesis_forbidden" };
  }
  if (!input.agentAssetId) {
    return { ok: false, reason: "agent_asset_id_required" };
  }
  if (input.agentId && input.agentId === input.agentAssetId) {
    return { ok: false, reason: "agentId_is_not_agentAssetId" };
  }
  return { ok: true, agentAssetId: input.agentAssetId };
}

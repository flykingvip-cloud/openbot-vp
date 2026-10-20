import type { OpenBotConfig } from "../../config/types.js";
import { assertFailClosedWorkspaceIdentity } from "../data-governance/workspace-identity-fail-closed.js";
import { buildWorkspaceResourceId } from "./builders.js";
import type { WorkspaceResourceCatalog } from "./catalog.js";
import { openWorkspaceResourceAccess, resolveWorkspaceResource } from "./resolve.js";
import type { WorkspaceResolveActor } from "./types.js";
export type ResolveAuthorizedAgentToolWorkspaceCwdParams = {
  catalog?: WorkspaceResourceCatalog;
  cfg?: OpenBotConfig;
  actor: WorkspaceResolveActor;
  tenantId: string;
  userId: string;
  agentId: string;
  agentAssetId?: string;
  workspaceRoot: string;
};
export type AuthorizedAgentToolWorkspaceCwdResult =
  | { ok: true; cwd: string; resourceId: string; bindingId: string }
  | { ok: false; reason: string };

export function resolveAuthorizedAgentToolWorkspaceCwd(
  params: ResolveAuthorizedAgentToolWorkspaceCwdParams,
): AuthorizedAgentToolWorkspaceCwdResult {
  const catalog = params.catalog;
  if (!catalog || !params.agentAssetId || params.agentAssetId === params.agentId) {
    return {
      ok: false,
      reason: !catalog ? "empty_catalog_synthesis_forbidden" : "agent_asset_id_required",
    };
  }
  const identity = assertFailClosedWorkspaceIdentity({
    catalogRecordCount: Object.keys(catalog.snapshot().resources).length,
    agentId: params.agentId,
    agentAssetId: params.agentAssetId,
  });
  if (!identity.ok) {
    return { ok: false, reason: identity.reason };
  }
  // Read existing Catalog SoT only. Do not synthesize a user-owned row.
  const userOwnedId = buildWorkspaceResourceId({
    tenantId: params.tenantId,
    scope: {
      kind: "user_owned",
      userId: params.userId,
      agentAssetId: params.agentAssetId,
      proof: {
        source: "explicit_binding",
        ownerType: "user",
        ownerId: params.userId,
        agentAssetId: params.agentAssetId,
      },
    },
  });
  void import("./item7-w3-shadow.js").then(({ scheduleItem7W3CatalogSynthesisShadow }) =>
    scheduleItem7W3CatalogSynthesisShadow({
      ledgerId: "S28",
      existingResourceId: userOwnedId,
    }),
  );
  const existing =
    catalog.getResource(userOwnedId) != null
      ? { resourceId: userOwnedId }
      : findExistingAssetCatalogResource(catalog, params.agentAssetId);
  if (!existing) {
    return { ok: false, reason: "catalog_record_required" };
  }
  const resolved = resolveWorkspaceResource({
    catalog,
    cfg: params.cfg,
    actor: params.actor,
    resourceId: existing.resourceId,
    operation: "read",
    purpose: "agent.tool.cwd",
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  const access = openWorkspaceResourceAccess({ catalog, resolved });
  if (!access) {
    return { ok: false, reason: "binding_not_found" };
  }
  return {
    ok: true,
    cwd: access.realRootPath(),
    resourceId: resolved.resourceId,
    bindingId: resolved.bindingId,
  };
}

function findExistingAssetCatalogResource(
  catalog: WorkspaceResourceCatalog,
  agentAssetId: string,
): { resourceId: string } | null {
  const suffix = `:asset:${agentAssetId}`;
  const matches = Object.values(catalog.snapshot().resources).filter(
    (resource) =>
      resource.lifecycleState === "active" &&
      resource.ownerScope.kind !== "unknown" &&
      resource.resourceId.endsWith(suffix),
  );
  if (matches.length !== 1) {
    return null;
  }
  return { resourceId: matches[0].resourceId };
}

export { loadExistingGovernedWorkspaceIdentity } from "../data-governance/workspace-catalog-projection.js";

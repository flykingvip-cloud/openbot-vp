import type { OpenBotConfig } from "../../config/types.js";
import { declareWorkspaceRelativePath } from "../../shared/workspace-deliverable-path.js";
import { buildWorkspaceResourceId } from "./builders.js";
import type { WorkspaceResourceCatalog } from "./catalog.js";
import { openWorkspaceResourceAccess, resolveWorkspaceResource } from "./resolve.js";
import type { WorkspaceResolveActor } from "./types.js";

export type StewardWorkspaceRootCandidate = {
  agentAssetId: string;
  workspaceRoot: string;
};

export type ReadStewardWorkspaceFileParams = {
  catalog: WorkspaceResourceCatalog;
  cfg?: OpenBotConfig;
  actor: WorkspaceResolveActor;
  tenantId: string;
  userId: string;
  roots: StewardWorkspaceRootCandidate[];
  relativePath: string;
  maxBytes?: number;
};

export type StewardWorkspaceFileReadResult =
  | {
      ok: true;
      buffer: Buffer;
      byteLength: number;
      relativePath: string;
      resourceId: string;
      bindingId: string;
    }
  | {
      ok: false;
      reason: string;
    };

/**
 * Exact workspace-relative path only. Nested declarations are not reduced to a
 * basename, and bare names are not searched across other directories here.
 */
export function buildWorkspaceRelativePathCandidates(relativePath: string): string[] {
  const located = declareWorkspaceRelativePath(relativePath);
  if (!located.ok || located.kind === "mapped") {
    return [];
  }
  return [located.relativePath];
}

/**
 * Handler integration helper (P0-c): read steward / agent workspace files through resolver,
 * searching ordered workspace roots with the same path-candidate expansion as the legacy handler.
 */
export function readStewardWorkspaceFileContent(
  params: ReadStewardWorkspaceFileParams,
): StewardWorkspaceFileReadResult {
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  if (!tenantId || !userId) {
    return { ok: false, reason: !tenantId ? "tenant_id_required" : "user_id_required" };
  }
  const catalog = params.catalog;
  if (!catalog || Object.keys(catalog.snapshot().resources).length === 0) {
    return { ok: false, reason: "empty_catalog_synthesis_forbidden" };
  }
  const pathCandidates = buildWorkspaceRelativePathCandidates(params.relativePath);
  const seenRoots = new Set<string>();

  for (const root of params.roots) {
    const trimmed = root.workspaceRoot.trim();
    const agentAssetId = root.agentAssetId.trim();
    if (!trimmed || !agentAssetId || seenRoots.has(trimmed)) {
      continue;
    }
    seenRoots.add(trimmed);

    // Read existing Catalog SoT only. Do not synthesize a user-owned row.
    const resourceId = buildWorkspaceResourceId({
      tenantId,
      scope: {
        kind: "user_owned",
        userId,
        agentAssetId,
        proof: {
          source: "explicit_binding",
          ownerType: "user",
          ownerId: userId,
          agentAssetId,
        },
      },
    });
    void import("./item7-w3-shadow.js").then(({ scheduleItem7W3CatalogSynthesisShadow }) =>
      scheduleItem7W3CatalogSynthesisShadow({
        ledgerId: "S22",
        existingResourceId: resourceId,
      }),
    );
    const existing = catalog.getResource(resourceId);
    if (!existing || existing.tenantId !== tenantId) {
      continue;
    }

    const resolved = resolveWorkspaceResource({
      catalog,
      cfg: params.cfg,
      actor: params.actor,
      resourceId: existing.resourceId,
      operation: "read",
      purpose: "workbench.steward-file.read",
    });
    if (!resolved.ok) {
      continue;
    }

    const access = openWorkspaceResourceAccess({ catalog, resolved });
    if (!access) {
      continue;
    }

    for (const candidate of pathCandidates) {
      const stat = access.statRelativeFile(candidate);
      if (!stat) {
        continue;
      }
      if (params.maxBytes != null && stat.size > params.maxBytes) {
        return { ok: false, reason: "file_too_large" };
      }
      const buffer = access.readRelativeFile(candidate);
      if (!buffer) {
        continue;
      }
      return {
        ok: true,
        buffer,
        byteLength: stat.size,
        relativePath: candidate,
        resourceId: resolved.resourceId,
        bindingId: resolved.bindingId,
      };
    }
  }

  return { ok: false, reason: "file_not_found" };
}

import { resolveAgentConfig } from "../../agents/agent-scope.js";
import { sanitizeEmployeeStewardIdentity } from "../../agents/builtin-steward/employee-isolation.js";
import {
  BUILTIN_STEWARD_AGENT_ID,
  isBuiltinStewardAgent,
} from "../../agents/builtin-steward/identity.js";
import { resolveStateDir } from "../../config/paths.js";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveLegacyAgentId } from "../agent-registry/legacy-resolver.js";
import { setPrimaryOwner } from "../agent-registry/ownership.js";
import { createAgentAsset, findAgentAssetBySlug } from "../agent-registry/registry.js";
import { loadAgentRegistryStore, saveAgentRegistryStore } from "../agent-registry/store.js";
import { AgentRegistryError } from "../agent-registry/types.js";
import { buildWorkspaceResourceId } from "../workspace-resolver/builders.js";
import {
  InMemoryWorkspaceResourceCatalog,
  type WorkspaceResourceCatalog,
} from "../workspace-resolver/catalog.js";
import type {
  WorkspaceBindingRecord,
  WorkspaceResourceRecord,
} from "../workspace-resolver/types.js";
import { resolveRobotOwnWriteRoot } from "../workspace-resolver/write-roots.js";
import { classifyWorkspaceOwnership } from "../workspace/ownership-classifier.js";
import type { WorkspaceOwnerScope } from "../workspace/types.js";
import {
  getSharedDataGovernanceCatalog,
  upsertWorkspaceGovernanceRecord,
} from "./runtime-catalog.js";
import type { CatalogRecord } from "./types.js";
import { repairMalformedRegistryAsset } from "./workspace-registry-repair.js";

export type ExistingGovernedWorkspaceIdentity = {
  catalog?: WorkspaceResourceCatalog;
  agentAssetId?: string;
};

const USER_OWNED_ASSET_ID = /^ws:([^:]+):user:([^:]+):asset:(.+)$/;
const SEAT_OWNED_ASSET_ID = /^ws:([^:]+):seat:([^:]+):asset:(.+)$/;
/** Same token as steward-write.STEWARD_BUILTIN_AGENT_ASSET_ID — keep inlined to avoid chat importing cutover. */
const STEWARD_BUILTIN_AGENT_ASSET_ID = "steward:builtin" as const;

function stewardTargetWorkspaceDir(params: {
  tenantId: string;
  userId: string;
  stateDir?: string;
}): string {
  return resolveRobotOwnWriteRoot({
    stateDir: params.stateDir ?? resolveStateDir(process.env),
    tenantId: params.tenantId.trim(),
    userId: sanitizeEmployeeStewardIdentity(params.userId),
    agentId: BUILTIN_STEWARD_AGENT_ID,
  });
}

function parseUserOwnedAsset(params: {
  resourceId: string;
  tenantId: string;
  userId: string;
  agentId: string;
}): string | undefined {
  const match = USER_OWNED_ASSET_ID.exec(params.resourceId);
  if (!match) {
    return undefined;
  }
  const [, tenantId, userId, agentAssetId] = match;
  if (tenantId !== params.tenantId || userId !== params.userId) {
    return undefined;
  }
  if (!agentAssetId || agentAssetId === params.agentId) {
    return undefined;
  }
  return agentAssetId;
}

function parseSeatOwnedAsset(params: {
  resourceId: string;
  tenantId: string;
  agentId: string;
  /**
   * Path B runtime ids such as `agt-…` are both the agent id and the asset id.
   * Keep that seat row only for the occupied seat; every other asset===agentId
   * row stays unresolved.
   */
  occupiedSeatId?: string | null;
}): { seatId: string; agentAssetId: string } | undefined {
  const match = SEAT_OWNED_ASSET_ID.exec(params.resourceId);
  if (!match) {
    return undefined;
  }
  const [, tenantId, seatId, agentAssetId] = match;
  if (tenantId !== params.tenantId || !seatId || !agentAssetId) {
    return undefined;
  }
  if (agentAssetId === params.agentId && seatId !== params.occupiedSeatId?.trim()) {
    return undefined;
  }
  return { seatId, agentAssetId };
}

function projectActiveWorkspace(record: CatalogRecord): {
  resource: WorkspaceResourceRecord;
  bindings: WorkspaceBindingRecord[];
} | null {
  if (record.envelope.resourceType !== "workspace" || record.envelope.lifecycleState !== "active") {
    return null;
  }
  const owner = record.envelope.owner;
  let resource: WorkspaceResourceRecord | null = null;
  if (owner.kind === "user") {
    const parsed = USER_OWNED_ASSET_ID.exec(record.envelope.resourceId);
    const agentAssetId = parsed?.[3];
    if (!parsed || !agentAssetId) {
      return null;
    }
    resource = {
      resourceId: record.envelope.resourceId,
      resourceType: "workspace",
      tenantId: record.envelope.tenantId,
      ownerScope: {
        kind: "user_owned",
        userId: owner.userId,
        agentAssetId,
        proof: {
          source: "explicit_binding",
          ownerType: "user",
          ownerId: owner.userId,
          agentAssetId,
        },
      },
      lifecycleState: "active",
      classification: record.envelope.classification,
      governanceVersion: record.envelope.governanceVersion,
    };
  } else if (owner.kind === "position") {
    const parsed = SEAT_OWNED_ASSET_ID.exec(record.envelope.resourceId);
    const agentAssetId = parsed?.[3];
    if (!parsed || !agentAssetId) {
      return null;
    }
    resource = {
      resourceId: record.envelope.resourceId,
      resourceType: "workspace",
      tenantId: record.envelope.tenantId,
      ownerScope: {
        kind: "position_owned",
        seatId: owner.seatId,
        agentAssetId,
      },
      lifecycleState: "active",
      classification: record.envelope.classification,
      governanceVersion: record.envelope.governanceVersion,
    };
  }
  if (!resource) {
    return null;
  }
  const bindings: WorkspaceBindingRecord[] = record.bindings
    .filter((binding) => binding.role === "canonical" || binding.role === "compatibility")
    .map((binding) => ({
      bindingId: binding.bindingId,
      resourceId: binding.resourceId,
      role: binding.role === "compatibility" ? "compatibility" : "canonical",
      locator: binding.locator,
      state: binding.state === "read_only" ? "read_only" : "active",
      contentVersion: binding.contentVersion,
    }));
  if (bindings.length === 0) {
    return null;
  }
  return { resource, bindings };
}

function catalogFromProjected(
  rows: Array<{ resource: WorkspaceResourceRecord; bindings: WorkspaceBindingRecord[] }>,
  agentAssetId: string,
): ExistingGovernedWorkspaceIdentity {
  const resources: Record<string, WorkspaceResourceRecord> = {};
  const bindings: Record<string, WorkspaceBindingRecord> = {};
  for (const row of rows) {
    resources[row.resource.resourceId] = row.resource;
    for (const binding of row.bindings) {
      bindings[binding.bindingId] = binding;
    }
  }
  return {
    catalog: new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources,
      bindings,
    }),
    agentAssetId,
  };
}

/**
 * Read-only projection of existing Catalog workspace rows. Never synthesizes
 * empty Catalogs or user-owned entries, and never writes.
 *
 * When Agent Registry resolves `agentId` to exactly one asset, only that
 * asset is returned — even if the user has several occupancy-minted rows.
 * A resolved miss does not fall back to another asset. Unresolved agentIds
 * keep the unique user-owned row rule.
 */
export async function loadExistingGovernedWorkspaceIdentity(params: {
  tenantId: string;
  userId: string;
  agentId: string;
  stateDir?: string;
  registryStorePath?: string;
  /** When set, a position row whose asset id equals agentId is kept for this seat only. */
  occupiedSeatId?: string | null;
}): Promise<ExistingGovernedWorkspaceIdentity> {
  try {
    const records = await getSharedDataGovernanceCatalog({ stateDir: params.stateDir }).list(
      "workspace",
    );
    const userOwned: Array<{
      assetId: string;
      projected: { resource: WorkspaceResourceRecord; bindings: WorkspaceBindingRecord[] };
    }> = [];
    const seatOwned: Array<{
      assetId: string;
      projected: { resource: WorkspaceResourceRecord; bindings: WorkspaceBindingRecord[] };
    }> = [];
    for (const record of records) {
      if (record.envelope.tenantId !== params.tenantId) {
        continue;
      }
      const projected = projectActiveWorkspace(record);
      if (!projected) {
        continue;
      }
      const userAssetId = parseUserOwnedAsset({
        resourceId: projected.resource.resourceId,
        tenantId: params.tenantId,
        userId: params.userId,
        agentId: params.agentId,
      });
      if (userAssetId) {
        userOwned.push({ assetId: userAssetId, projected });
        continue;
      }
      const seatAsset = parseSeatOwnedAsset({
        resourceId: projected.resource.resourceId,
        tenantId: params.tenantId,
        agentId: params.agentId,
        occupiedSeatId: params.occupiedSeatId,
      });
      if (seatAsset) {
        seatOwned.push({ assetId: seatAsset.agentAssetId, projected });
      }
    }

    const registry = await loadAgentRegistryStore(params.registryStorePath);
    const resolution = resolveLegacyAgentId({
      store: registry,
      enterpriseId: params.tenantId,
      legacyAgentId: params.agentId,
    });
    if (resolution.kind === "resolved") {
      const agentAssetId = resolution.ref.agentAssetId;
      if (!agentAssetId || agentAssetId === params.agentId) {
        const occupiedRuntime = seatOwned.filter((row) => row.assetId === params.agentId);
        if (occupiedRuntime.length === 1) {
          return catalogFromProjected(
            occupiedRuntime.map((row) => row.projected),
            params.agentId,
          );
        }
        return {};
      }
      const matched = [
        ...userOwned.filter((row) => row.assetId === agentAssetId),
        ...seatOwned.filter((row) => row.assetId === agentAssetId),
      ];
      if (matched.length === 0) {
        return {};
      }
      return catalogFromProjected(
        matched.map((row) => row.projected),
        agentAssetId,
      );
    }

    // Builtin steward is not an enterprise asset. Do not use the unique-row
    // fallback — a user with several occupancy rows would miss the steward
    // workspace even when steward:builtin is already catalogued.
    if (resolution.kind === "builtin-universal") {
      const steward = userOwned.filter((row) => row.assetId === STEWARD_BUILTIN_AGENT_ASSET_ID);
      if (steward.length !== 1) {
        return {};
      }
      return catalogFromProjected(
        steward.map((row) => row.projected),
        STEWARD_BUILTIN_AGENT_ASSET_ID,
      );
    }

    const occupiedRuntime = seatOwned.filter((row) => row.assetId === params.agentId);
    if (userOwned.length === 0 && occupiedRuntime.length === 1) {
      return catalogFromProjected(
        occupiedRuntime.map((row) => row.projected),
        params.agentId,
      );
    }

    const uniqueIds = new Set(userOwned.map((row) => row.assetId));
    if (uniqueIds.size !== 1) {
      return {};
    }
    const agentAssetId = [...uniqueIds][0];
    return catalogFromProjected(
      userOwned.map((row) => row.projected),
      agentAssetId,
    );
  } catch {
    return {};
  }
}

function configuredAgentOwnerId(cfg: OpenBotConfig, agentId: string): string | null {
  const list = cfg.agents?.list;
  if (!Array.isArray(list)) {
    return null;
  }
  const entry = list.find((item) => item?.id === agentId);
  const ownerId = typeof entry?.ownerId === "string" ? entry.ownerId.trim() : "";
  return ownerId || null;
}

/**
 * Mint the occupied seat's plain-id workspace row when a UI-visible robot is
 * only catalogued under a different seat. Locator is caller-supplied and must
 * already be the Path B tenant-user root — this function does not read config
 * workspace paths or legacy `workspace-<id>` directories.
 */
export async function ensureOccupiedSeatWorkspaceCatalog(params: {
  tenantId: string;
  seatId: string;
  agentAssetId: string;
  locator: string;
  stateDir?: string;
}): Promise<void> {
  const tenantId = params.tenantId.trim();
  const seatId = params.seatId.trim();
  const agentAssetId = params.agentAssetId.trim();
  const locator = params.locator.trim();
  if (!tenantId || !seatId || !agentAssetId || !locator || agentAssetId.includes(":")) {
    return;
  }
  const ownerScope: WorkspaceOwnerScope = {
    kind: "position_owned",
    seatId,
    agentAssetId,
  };
  await upsertWorkspaceGovernanceRecord({
    resourceId: buildWorkspaceResourceId({ tenantId, scope: ownerScope }),
    tenantId,
    ownerScope,
    locator,
    classification: "agent_workspace",
    lifecycleState: "active",
    stateDir: params.stateDir,
  });
}

function userOwnedScope(userId: string, agentAssetId: string): WorkspaceOwnerScope {
  return {
    kind: "user_owned",
    userId,
    agentAssetId,
    proof: {
      source: "explicit_binding",
      ownerType: "user",
      ownerId: userId,
      agentAssetId,
    },
  };
}

/**
 * Mint the Item 7 plain-id Catalog row (and Registry asset when missing) so
 * chat can project an identity. Reuses agents.create's write:
 * `upsertWorkspaceGovernanceRecord` + `builders.buildWorkspaceResourceId`.
 * Never writes hashed resource-resolver ids. Never treats agentId as assetId.
 */
export async function ensureGovernedWorkspaceCatalogIdentity(params: {
  tenantId: string;
  userId: string;
  agentId: string;
  cfg: OpenBotConfig;
  workspaceLocator: string;
  currentSeatId?: string | null;
  stateDir?: string;
  registryStorePath?: string;
}): Promise<ExistingGovernedWorkspaceIdentity> {
  const existing = await loadExistingGovernedWorkspaceIdentity(params);
  if (existing.catalog && existing.agentAssetId) {
    return existing;
  }

  const agentId = params.agentId.trim();
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  if (!agentId || !tenantId || !userId) {
    return {};
  }

  try {
    if (isBuiltinStewardAgent(agentId)) {
      const locator = stewardTargetWorkspaceDir({
        tenantId,
        userId,
        stateDir: params.stateDir,
      });
      const scope = userOwnedScope(userId, STEWARD_BUILTIN_AGENT_ASSET_ID);
      await upsertWorkspaceGovernanceRecord({
        resourceId: buildWorkspaceResourceId({ tenantId, scope }),
        tenantId,
        ownerScope: scope,
        locator,
        classification: "employee_private",
        lifecycleState: "active",
        stateDir: params.stateDir,
      });
      return loadExistingGovernedWorkspaceIdentity(params);
    }

    const locator =
      params.workspaceLocator.trim() ||
      resolveRobotOwnWriteRoot({
        stateDir: params.stateDir ?? resolveStateDir(process.env),
        tenantId,
        userId,
        agentId,
      });

    const registry = await loadAgentRegistryStore(params.registryStorePath);
    const resolution = resolveLegacyAgentId({
      store: registry,
      enterpriseId: tenantId,
      legacyAgentId: agentId,
    });

    let agentAssetId: string | undefined;
    let registryDirty = false;
    const nowIso = new Date().toISOString();

    if (resolution.kind === "resolved") {
      agentAssetId = resolution.ref.agentAssetId;
      if (!agentAssetId || agentAssetId === agentId) {
        const repaired = repairMalformedRegistryAsset({
          store: registry,
          tenantId,
          legacyAgentId: agentId,
          nowIso,
          displayName: resolveAgentConfig(params.cfg, agentId)?.name?.trim() || agentId,
          defaultOwner: { userId, seatId: params.currentSeatId ?? null },
        });
        if (!repaired.agentAssetId) {
          return {};
        }
        agentAssetId = repaired.agentAssetId;
        if (repaired.repaired) {
          registryDirty = true;
        }
      }
    } else if (resolution.kind === "not-found") {
      const repaired = repairMalformedRegistryAsset({
        store: registry,
        tenantId,
        legacyAgentId: agentId,
        nowIso,
        displayName: resolveAgentConfig(params.cfg, agentId)?.name?.trim() || agentId,
        defaultOwner: { userId, seatId: params.currentSeatId ?? null },
      });
      if (repaired.agentAssetId) {
        agentAssetId = repaired.agentAssetId;
        if (repaired.repaired) {
          registryDirty = true;
        }
      } else {
        try {
          const asset = createAgentAsset({
            store: registry,
            enterpriseId: tenantId,
            agentSlug: agentId,
            displayName: resolveAgentConfig(params.cfg, agentId)?.name?.trim() || agentId,
            nowIso,
            legacyAgentId: agentId,
          });
          agentAssetId = asset.agentAssetId;
          registryDirty = true;
        } catch (err) {
          if (!(err instanceof AgentRegistryError) || err.code !== "SLUG_CONFLICT") {
            return {};
          }
          const bySlug = findAgentAssetBySlug(registry, tenantId, agentId);
          if (!bySlug) {
            return {};
          }
          if (bySlug.agentAssetId === agentId) {
            const slugRepair = repairMalformedRegistryAsset({
              store: registry,
              tenantId,
              legacyAgentId: agentId,
              nowIso,
              displayName: resolveAgentConfig(params.cfg, agentId)?.name?.trim() || agentId,
              defaultOwner: { userId, seatId: params.currentSeatId ?? null },
            });
            if (!slugRepair.agentAssetId) {
              return {};
            }
            agentAssetId = slugRepair.agentAssetId;
            if (slugRepair.repaired) {
              registryDirty = true;
            }
          } else {
            agentAssetId = bySlug.agentAssetId;
          }
        }
      }
    } else {
      return {};
    }

    if (!agentAssetId || agentAssetId === agentId) {
      return {};
    }

    const classified = classifyWorkspaceOwnership({
      actor: { tenantId, userId },
      registry,
      agentAssetId,
    });
    let ownerScope = classified;
    if (ownerScope.kind === "unknown") {
      const seatId = params.currentSeatId?.trim();
      const ownerId = configuredAgentOwnerId(params.cfg, agentId) || userId;
      setPrimaryOwner({
        store: registry,
        ref: { enterpriseId: tenantId, agentAssetId },
        ownerType: seatId ? "seat" : "membership",
        ownerId: seatId || ownerId,
        nowIso,
      });
      registryDirty = true;
      ownerScope = seatId
        ? { kind: "position_owned", seatId, agentAssetId }
        : userOwnedScope(ownerId, agentAssetId);
    }

    if (registryDirty) {
      await saveAgentRegistryStore(registry, params.registryStorePath);
    }

    await upsertWorkspaceGovernanceRecord({
      resourceId: buildWorkspaceResourceId({ tenantId, scope: ownerScope }),
      tenantId,
      ownerScope,
      locator,
      classification: "agent_workspace",
      lifecycleState: "active",
      stateDir: params.stateDir,
    });
    return loadExistingGovernedWorkspaceIdentity(params);
  } catch {
    return {};
  }
}

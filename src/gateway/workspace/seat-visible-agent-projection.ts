/**
 * Path B seat-grant projection.
 *
 * The employee robots list treats `agents.list[].ownerId === occupiedSeatId`
 * as visible even when `defaultAgentAssetIds` and seat asset bindings omit
 * that agent. S29 then authorizes whatever catalog seat owns the asset.
 * A stale or foreign position row fails `authorizeGrant` with `auth_failure`
 * while the occupied seat still has no grant. This module writes the missing
 * seat SoT (defaults + asset binding + execute policy) without opening a
 * legacy workspace.
 */
import path from "node:path";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import type { OpenBotConfig } from "../../config/types.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { attachSeatManagedAsset } from "../enterprise-seat-assets-governance.js";
import {
  clipPositionAgentAssetIds,
  grantEnterpriseAccessPolicy,
  resolveSeatGrantedAgentAssetIds,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import { resolveTenantLiveRoot } from "../tenant-store-paths.js";
import type { WorkspaceResourceCatalog } from "../workspace-resolver/catalog.js";
import { resolveRobotOwnWriteRoot } from "../workspace-resolver/write-roots.js";

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isAgentConfigOwnedBySeat(
  cfg: OpenBotConfig,
  agentId: string,
  seatId: string,
): boolean {
  const seatKey = normalizeIdentity(seatId);
  const agentKey = normalizeAgentId(agentId);
  if (!seatKey || !agentKey || isBuiltinStewardAgent(agentKey)) {
    return false;
  }
  for (const entry of cfg.agents?.list ?? []) {
    if (!entry?.id || normalizeAgentId(entry.id) !== agentKey) {
      continue;
    }
    return normalizeIdentity(entry.ownerId) === seatKey;
  }
  return false;
}

export function catalogIncludesOccupiedSeatAgent(params: {
  catalog: WorkspaceResourceCatalog | null | undefined;
  seatId: string;
  agentAssetId: string | null | undefined;
}): boolean {
  const seatId = params.seatId.trim();
  const agentAssetId = params.agentAssetId?.trim() ?? "";
  if (!params.catalog || !seatId || !agentAssetId) {
    return false;
  }
  return Object.values(params.catalog.snapshot().resources).some((resource) => {
    const scope = resource.ownerScope;
    return (
      scope.kind === "position_owned" &&
      scope.seatId === seatId &&
      scope.agentAssetId === agentAssetId
    );
  });
}

/**
 * Path B robot workspace on the tenant volume:
 * `<OPENBOT_TENANTS_ROOT>/<tenant>/users/<user>/OpenBot/agents/<id>/workspace`.
 *
 * The successful HK cutover kept `OPENBOT_TENANTS_ROOT=/root/openbot-tenants`
 * separate from the gateway state dir (`/root/.openbot`). Gate 0 labels
 * `OPENBOT_MULTITENANT=1` as shared_process even when the dedicated boundary
 * env is set; the cwd the account worker can use is still this tenant-user
 * data root. A `stateDir/tenants/...` shadow is a different disk.
 * Never `workspace-<id>` and never `agents.list[].workspace`.
 */
export function resolvePathBSeatAgentWorkspaceLocator(params: {
  tenantId: string;
  userId: string;
  agentId: string;
  /** Tenant volume root. Defaults to `OPENBOT_TENANTS_ROOT` or `CONFIG_DIR/tenants`. */
  tenantsRoot?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  const tenantLive = params.tenantsRoot?.trim()
    ? path.join(params.tenantsRoot.trim(), tenantId)
    : resolveTenantLiveRoot(tenantId, params.env);
  const dataRoot = path.join(tenantLive, "users", userId, "OpenBot");
  return resolveRobotOwnWriteRoot({
    tenantId,
    userId,
    agentId: params.agentId,
    dataRoot,
  });
}

/** True when locator is already this actor's Path B tenant-volume workspace. */
export function isPathBSeatWorkspaceLocator(
  locator: string,
  params: {
    tenantId: string;
    userId: string;
    agentId: string;
    tenantsRoot?: string;
    env?: NodeJS.ProcessEnv;
  },
): boolean {
  const trimmed = locator.trim();
  if (!trimmed) {
    return false;
  }
  let canonical: string;
  try {
    canonical = resolvePathBSeatAgentWorkspaceLocator(params);
  } catch {
    return false;
  }
  return path.resolve(trimmed) === path.resolve(canonical);
}

/**
 * True when locator is already the **tenant-volume** Path B workspace for this
 * agent under **any** host user (sticky seat canonical). A gateway state-dir
 * shadow (`…/.openbot/tenants/…`) is not sticky — callers may retarget it onto
 * `OPENBOT_TENANTS_ROOT`. Used so a new occupant does not rewrite a real Path B
 * locator to their own userId.
 */
export function isStickyPathBSeatWorkspaceLocator(
  locator: string,
  params: {
    tenantId: string;
    agentId: string;
    tenantsRoot?: string;
    env?: NodeJS.ProcessEnv;
  },
): boolean {
  const trimmed = locator.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = path.resolve(trimmed).split(path.sep).join("/");
  const usersMarker = "/users/";
  const usersIdx = normalized.toLowerCase().lastIndexOf(usersMarker);
  if (usersIdx < 0) {
    return false;
  }
  const afterUsers = normalized.slice(usersIdx + usersMarker.length);
  const hostUserId = afterUsers.split("/")[0]?.trim() ?? "";
  if (!hostUserId) {
    return false;
  }
  let canonical: string;
  try {
    canonical = resolvePathBSeatAgentWorkspaceLocator({
      tenantId: params.tenantId,
      userId: hostUserId,
      agentId: params.agentId,
      tenantsRoot: params.tenantsRoot,
      env: params.env,
    });
  } catch {
    return false;
  }
  return path.resolve(trimmed) === path.resolve(canonical);
}

/** Registry `agentAssetId` shape. Runtime agent ids are slugs (`bot-2`, `agt-…`). */
const OPAQUE_AGENT_ASSET_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isOpaqueAgentAssetId(agentId: string): boolean {
  return OPAQUE_AGENT_ASSET_ID_RE.test(agentId);
}

/**
 * Add omitted UI-visible agents to the occupied seat's grant SoT.
 * Returns true when the store changed. Does not save.
 * Asset-binding + execute policy are written even when defaultAgentAssetIds
 * is already at the position cap; the cap clips only the default-id list.
 *
 * Seat SoT stores runtime agent ids only. An opaque registry UUID is skipped
 * unless that same id is present in `runtimeAgentIds` (agents.list). Catalog
 * projection may still key rows by `agentAssetId`.
 */
export function applyVisibleSeatAgentGrant(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  agentIds: readonly string[];
  /**
   * Runtime `agents.list` ids. UUID-shaped ids outside this set are registry
   * asset ids and must not become seat bindings. Omit to skip every UUID.
   */
  runtimeAgentIds?: readonly string[];
  actorUserId: string;
  nowIso: string;
}): boolean {
  const seat = params.store.seats[params.seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    return false;
  }
  const runtimeAgentIds = new Set<string>();
  for (const raw of params.runtimeAgentIds ?? []) {
    const trimmed = raw.trim();
    if (trimmed) {
      runtimeAgentIds.add(normalizeAgentId(trimmed));
    }
  }
  const granted = new Set(
    resolveSeatGrantedAgentAssetIds({
      store: params.store,
      tenantId: params.tenantId,
      seat,
    }),
  );
  let changed = false;
  for (const raw of params.agentIds) {
    const agentId = raw.trim();
    if (!agentId || granted.has(agentId) || isBuiltinStewardAgent(agentId)) {
      continue;
    }
    if (isOpaqueAgentAssetId(agentId) && !runtimeAgentIds.has(normalizeAgentId(agentId))) {
      continue;
    }
    const nextDefaults = clipPositionAgentAssetIds({
      agentIds: [...seat.defaultAgentAssetIds, agentId],
    });
    if (nextDefaults.includes(agentId) && !seat.defaultAgentAssetIds.includes(agentId)) {
      seat.defaultAgentAssetIds = nextDefaults;
    }
    attachSeatManagedAsset({
      store: params.store,
      tenantId: params.tenantId,
      seatId: params.seatId,
      assetType: "agent",
      assetId: agentId,
      source: "seat_default",
      createdBy: params.actorUserId,
      nowIso: params.nowIso,
    });
    grantEnterpriseAccessPolicy({
      store: params.store,
      tenantId: params.tenantId,
      subjectType: "employee",
      subjectId: params.actorUserId,
      resourceType: "agent",
      resourceId: agentId,
      action: "execute",
      nowIso: params.nowIso,
      actorEmployeeId: params.actorUserId,
    });
    grantEnterpriseAccessPolicy({
      store: params.store,
      tenantId: params.tenantId,
      subjectType: "seat",
      subjectId: params.seatId,
      resourceType: "agent",
      resourceId: agentId,
      action: "execute",
      nowIso: params.nowIso,
      actorEmployeeId: params.actorUserId,
    });
    granted.add(agentId);
    changed = true;
  }
  if (changed) {
    seat.updatedAt = params.nowIso;
  }
  return changed;
}

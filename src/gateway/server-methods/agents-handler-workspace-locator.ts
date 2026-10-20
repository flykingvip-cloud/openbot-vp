import { resolveAgentConfig } from "../../agents/agent-scope.js";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { isManagedDataMode } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  ensureGovernedWorkspaceCatalogIdentity,
  ensureOccupiedSeatWorkspaceCatalog,
  loadExistingGovernedWorkspaceIdentity,
} from "../data-governance/workspace-catalog-projection.js";
import { findSeatContextForLegacyAgent } from "../data-governance/workspace-identity-repair.js";
import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import { findActiveOwnershipRecord } from "../ownership-store.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import {
  loadSeatAssetsStoreForTenantId,
  saveSeatAssetsStoreForTenantId,
} from "../platform-auth/seat-store-loader.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveTenantContextForSessionStore } from "../tenant-context.js";
import { inferSeatOwnershipFromAgentConfig } from "../workspace-resolver/canonical-write-root.js";
import type { WorkspaceResourceCatalog } from "../workspace-resolver/catalog.js";
import {
  deniedWorkspaceLocator,
  isAuthoritativeSeatMember,
  resolveWorkspaceLocator,
  type WorkspaceLocatorGrant,
  type WorkspaceLocatorQueryAttempt,
  type WorkspaceLocatorResult,
} from "../workspace-resolver/strict-locator.js";
import type { WorkspaceResourceRecord } from "../workspace-resolver/types.js";
import { loadAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import {
  applyVisibleSeatAgentGrant,
  catalogIncludesOccupiedSeatAgent,
  isAgentConfigOwnedBySeat,
  isPathBSeatWorkspaceLocator,
  isStickyPathBSeatWorkspaceLocator,
  resolvePathBSeatAgentWorkspaceLocator,
} from "../workspace/seat-visible-agent-projection.js";
import type { GatewayClient, RespondFn } from "./types.js";

const logSeatVisibleGrant = createSubsystemLogger("gateway/workspace/seat-visible-agent-grant");

function configuredRuntimeAgentIds(cfg: OpenBotConfig): string[] {
  const ids: string[] = [];
  for (const entry of cfg.agents?.list ?? []) {
    const id = entry?.id?.trim();
    if (id) {
      ids.push(id);
    }
  }
  return ids;
}

type CatalogSelection =
  | { status: "unique"; resource: WorkspaceResourceRecord }
  | { status: "miss" }
  | { status: "ambiguous" };

function denyIncompleteLocatorQuery(params: {
  cfg: OpenBotConfig;
  tenantContext?: WorkspaceLocatorQueryAttempt["tenantContext"];
  tenantId?: WorkspaceLocatorQueryAttempt["tenantId"];
  actor?: WorkspaceLocatorQueryAttempt["actor"];
  resourceId?: WorkspaceLocatorQueryAttempt["resourceId"];
  agentAssetId?: WorkspaceLocatorQueryAttempt["agentAssetId"];
  catalog?: WorkspaceLocatorQueryAttempt["catalog"];
  membership?: WorkspaceLocatorQueryAttempt["membership"];
}): WorkspaceLocatorResult {
  // Explicit incomplete fields — never a cfg-only locator query.
  return resolveWorkspaceLocator({
    tenantContext: params.tenantContext ?? null,
    tenantId: params.tenantId ?? null,
    actor: params.actor ?? null,
    resourceId: params.resourceId ?? null,
    agentAssetId: params.agentAssetId ?? null,
    catalog: params.catalog ?? null,
    membership: params.membership,
    cfg: params.cfg,
  });
}

function actorUserGrant(actorUserId: string, purpose: string): WorkspaceLocatorGrant {
  return { kind: "user", subjectId: actorUserId, purpose };
}

/**
 * Prefer seat grant when the trusted session has an active seat; otherwise user
 * grant. Used so incomplete catalog/asset identity still passes a real grant
 * into Item 7 instead of coercing grant:null → missing_grant.
 */
function resolveAvailableActorGrant(
  actor: { userId: string; currentSeatId?: string | null },
  purpose: string,
): WorkspaceLocatorGrant {
  const seatId = typeof actor.currentSeatId === "string" ? actor.currentSeatId.trim() : "";
  if (seatId) {
    return { kind: "seat", subjectId: seatId, purpose };
  }
  return actorUserGrant(actor.userId, purpose);
}

function grantFromTrustedResource(
  resource: WorkspaceResourceRecord,
  actorUserId: string,
  purpose: string,
): WorkspaceLocatorGrant | null {
  if (resource.ownerScope.kind === "user_owned") {
    return { kind: "user", subjectId: actorUserId, purpose };
  }
  if (resource.ownerScope.kind === "position_owned") {
    return { kind: "seat", subjectId: resource.ownerScope.seatId, purpose };
  }
  if (resource.ownerScope.kind === "group_owned") {
    return { kind: "group", subjectId: resource.ownerScope.groupId, purpose };
  }
  return null;
}

/**
 * Unique Catalog pick: tenantId + owner scope + agentAssetId must match
 * together. Zero matches → miss. More than one → ambiguous. Never first-match.
 *
 * Dual occupancy defaults: actor user_owned is personal; seat row is shadow.
 * For seat-primary / shared robots (`preferPositionOwned`), the position_owned
 * row is the deliverable SoT and must win so write+preview share one root.
 */
function selectTrustedCatalogResource(params: {
  catalog: WorkspaceResourceCatalog;
  tenantId: string;
  actorUserId: string;
  agentAssetId: string;
  /**
   * When set, position-owned rows for other seats are not candidates.
   * A foreign catalog seat must not become auth_failure for a robot the
   * occupied seat already shows in the robots list.
   */
  occupiedSeatId?: string | null;
  /** Seat-primary shared robots: prefer position_owned over actor user_owned. */
  preferPositionOwned?: boolean;
}): CatalogSelection {
  const occupiedSeatId = params.occupiedSeatId?.trim() || "";
  const matching = Object.values(params.catalog.snapshot().resources).filter((resource) => {
    if (resource.tenantId !== params.tenantId) {
      return false;
    }
    const scope = resource.ownerScope;
    if (scope.kind === "user_owned") {
      return scope.userId === params.actorUserId && scope.agentAssetId === params.agentAssetId;
    }
    if (scope.kind === "position_owned") {
      if (scope.agentAssetId !== params.agentAssetId) {
        return false;
      }
      if (occupiedSeatId) {
        return scope.seatId === occupiedSeatId;
      }
      return true;
    }
    if (scope.kind === "group_owned") {
      return scope.groupId === params.agentAssetId;
    }
    return false;
  });
  if (matching.length === 0) {
    return { status: "miss" };
  }
  if (matching.length > 1) {
    if (params.preferPositionOwned) {
      const positionOwned = matching.filter((resource) => {
        if (resource.ownerScope.kind !== "position_owned") {
          return false;
        }
        if (occupiedSeatId && resource.ownerScope.seatId !== occupiedSeatId) {
          return false;
        }
        return resource.ownerScope.agentAssetId === params.agentAssetId;
      });
      if (positionOwned.length === 1) {
        const [uniqueSeat] = positionOwned;
        if (uniqueSeat) {
          return { status: "unique", resource: uniqueSeat };
        }
      }
    }
    const userOwned = matching.filter(
      (resource) =>
        resource.ownerScope.kind === "user_owned" &&
        resource.ownerScope.userId === params.actorUserId &&
        resource.ownerScope.agentAssetId === params.agentAssetId,
    );
    if (userOwned.length === 1) {
      const [uniqueUser] = userOwned;
      if (uniqueUser) {
        return { status: "unique", resource: uniqueUser };
      }
    }
    return { status: "ambiguous" };
  }
  const [unique] = matching;
  if (!unique) {
    return { status: "miss" };
  }
  return { status: "unique", resource: unique };
}

function actorIdentityKeys(actor: { userId: string; userEmail?: string | null }): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const value of [actor.userId, actor.userEmail]) {
    const key = value?.trim().toLowerCase() ?? "";
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/**
 * Ownership-store manager proof for agents.delete only. A seat handover can
 * leave the catalog position-owned while the user still manages the robot.
 * File reads do not receive this proof.
 */
function durableDeleteManagerProof(params: {
  purpose: string;
  tenantId: string;
  agentId: string;
  actorUserId: string;
  actorIdentities: readonly string[];
  seatId: string;
}): NonNullable<WorkspaceLocatorQueryAttempt["membership"]>["durableAgentManager"] {
  if (params.purpose !== "agents.delete") {
    return undefined;
  }
  const record = findActiveOwnershipRecord({
    tenantId: params.tenantId,
    subjectKind: "agent",
    subjectId: params.agentId,
  });
  const manager = record?.currentManagerUserId?.trim().toLowerCase() ?? "";
  if (!manager || !params.actorIdentities.includes(manager)) {
    return undefined;
  }
  return {
    purpose: "agents.delete",
    actorUserId: params.actorUserId,
    seatId: params.seatId,
  };
}

function activeMemberUserIds(
  members: ReadonlyArray<{ status?: string; userId?: string }>,
): string[] {
  const ids: string[] = [];
  for (const member of members) {
    if (member.status !== "active" && member.status !== "invited") {
      continue;
    }
    const userId = member.userId?.trim();
    if (userId) {
      ids.push(userId);
    }
  }
  return ids;
}

/**
 * Membership is loaded from trusted Platform Auth / seat / group SoT only.
 * Handler params and client wire fields are never consulted.
 */
async function loadTrustedMembership(params: {
  cfg: OpenBotConfig;
  tenantId: string;
  resource: WorkspaceResourceRecord;
}): Promise<WorkspaceLocatorQueryAttempt["membership"]> {
  const scope = params.resource.ownerScope;
  if (scope.kind === "position_owned") {
    let platformAuthStore = null;
    let seatStore = null;
    try {
      const authConfig = resolvePlatformAuthConfig(params.cfg.gateway?.auth?.trustedProxy);
      if (authConfig) {
        platformAuthStore = await loadPlatformAuthStore(authConfig);
      }
    } catch {
      platformAuthStore = null;
    }
    try {
      seatStore = await loadSeatAssetsStoreForTenantId(params.tenantId, params.cfg);
    } catch {
      seatStore = null;
    }
    return {
      source: "platform-auth",
      platformAuthStore,
      seatStore,
    };
  }
  if (scope.kind === "group_owned") {
    try {
      const members = await loadAuthoritativeGroupMembers({
        groupId: scope.groupId,
        tenantId: params.tenantId,
        profile: isManagedDataMode(params.cfg) ? "managed_enterprise" : "personal_local",
        cfg: params.cfg,
      });
      return {
        source: "platform-auth",
        groupAcl: {
          tenantId: params.tenantId,
          groupId: scope.groupId,
          memberUserIds: activeMemberUserIds(members),
          available: true,
        },
      };
    } catch {
      return {
        source: "platform-auth",
        groupAcl: {
          tenantId: params.tenantId,
          groupId: scope.groupId,
          memberUserIds: [],
          available: false,
        },
      };
    }
  }
  return undefined;
}

function occupiedSeatCanonicalLocator(params: {
  catalog: WorkspaceResourceCatalog | null | undefined;
  seatId: string;
  agentAssetId: string;
}): string {
  if (!params.catalog || !params.seatId || !params.agentAssetId) {
    return "";
  }
  const snapshot = params.catalog.snapshot();
  const resource = Object.values(snapshot.resources).find((entry) => {
    const scope = entry.ownerScope;
    return (
      scope.kind === "position_owned" &&
      scope.seatId === params.seatId &&
      scope.agentAssetId === params.agentAssetId
    );
  });
  if (!resource) {
    return "";
  }
  const binding = Object.values(snapshot.bindings).find(
    (entry) =>
      entry.resourceId === resource.resourceId &&
      entry.role === "canonical" &&
      entry.state === "active",
  );
  return binding?.locator?.trim() ?? "";
}

/**
 * Build a complete Item 7 locator query from server-trusted session/catalog
 * identity. Wire fields (params.workspace, params.tenantId, client hints) are
 * not used as authority.
 */
export async function resolveAgentsHandlerWorkspaceLocator(params: {
  client: GatewayClient | null | undefined;
  cfg: OpenBotConfig;
  agentId: string;
  purpose: string;
}): Promise<WorkspaceLocatorResult> {
  let tenantContext = null;
  try {
    // Chat/tool cwd must tolerate domain-less but membership-bearing sessions
    // (header-only or cookie-gap connects). Control-plane APIs keep resolveTenantContext.
    tenantContext = await resolveTenantContextForSessionStore(params.client ?? null);
  } catch {
    return denyIncompleteLocatorQuery({ cfg: params.cfg, tenantContext: null });
  }
  if (!tenantContext) {
    return denyIncompleteLocatorQuery({ cfg: params.cfg, tenantContext: null });
  }

  const actor = await resolveEmployeeWorkbenchActor(params.client ?? null);
  if (!actor?.userId) {
    return denyIncompleteLocatorQuery({
      cfg: params.cfg,
      tenantContext,
      tenantId: tenantContext.tenantId,
      actor: null,
    });
  }

  let identity = await loadExistingGovernedWorkspaceIdentity({
    tenantId: tenantContext.tenantId,
    userId: actor.userId,
    agentId: params.agentId,
    occupiedSeatId: actor.currentSeatId,
  });
  const occupiedSeatId = actor.currentSeatId?.trim() || "";
  const configOwnedByOccupiedSeat =
    occupiedSeatId.length > 0 &&
    !isBuiltinStewardAgent(params.agentId) &&
    isAgentConfigOwnedBySeat(params.cfg, params.agentId, occupiedSeatId);
  if (!identity.catalog) {
    // Configured workspace only — do not add a resolveAgentWorkspaceDir* site.
    // Seat-visible robots use the Path B tenant-user root, not cfg workspace.
    let currentSeatId = occupiedSeatId || null;
    if (!currentSeatId) {
      const seatStore = await loadSeatAssetsStoreForTenantId(tenantContext.tenantId, params.cfg);
      // Seat-assets may be unavailable (test mocks / store outage). Treat as
      // no seat hint and continue to catalog ensure / fail-closed deny — never
      // throw TypeError on null store.
      currentSeatId = seatStore
        ? (findSeatContextForLegacyAgent({
            store: seatStore,
            tenantId: tenantContext.tenantId,
            legacyAgentId: params.agentId,
          })?.seatId ?? null)
        : null;
    }
    const pathBLocator = configOwnedByOccupiedSeat
      ? resolvePathBSeatAgentWorkspaceLocator({
          tenantId: tenantContext.tenantId,
          userId: actor.userId,
          agentId: params.agentId,
        })
      : "";
    identity = await ensureGovernedWorkspaceCatalogIdentity({
      tenantId: tenantContext.tenantId,
      userId: actor.userId,
      agentId: params.agentId,
      cfg: params.cfg,
      workspaceLocator:
        pathBLocator || (resolveAgentConfig(params.cfg, params.agentId)?.workspace?.trim() ?? ""),
      currentSeatId,
    });
  }
  const catalogOwnedByOccupiedSeat = catalogIncludesOccupiedSeatAgent({
    catalog: identity.catalog,
    seatId: occupiedSeatId,
    agentAssetId: identity.agentAssetId,
  });
  const seatVisible = configOwnedByOccupiedSeat || catalogOwnedByOccupiedSeat;
  let constrainToOccupiedSeat = false;
  if (seatVisible && occupiedSeatId) {
    let seatStore = null;
    try {
      seatStore = await loadSeatAssetsStoreForTenantId(tenantContext.tenantId, params.cfg);
    } catch {
      seatStore = null;
    }
    const actorIdentities = actorIdentityKeys(actor);
    const occupies =
      seatStore != null &&
      isAuthoritativeSeatMember({
        seatStore,
        tenantId: tenantContext.tenantId,
        actorUserId: actor.userId,
        actorIdentities,
        seatId: occupiedSeatId,
      });
    if (occupies && seatStore) {
      constrainToOccupiedSeat = true;
      const pathBLocator = resolvePathBSeatAgentWorkspaceLocator({
        tenantId: tenantContext.tenantId,
        userId: actor.userId,
        agentId: params.agentId,
      });
      const projectedAssetId =
        identity.agentAssetId?.trim() ||
        (params.agentId.includes(":") ? "" : params.agentId.trim());
      const occupiedLocator = occupiedSeatCanonicalLocator({
        catalog: identity.catalog,
        seatId: occupiedSeatId,
        agentAssetId: projectedAssetId,
      });
      const occupiedRowMissing = !catalogIncludesOccupiedSeatAgent({
        catalog: identity.catalog,
        seatId: occupiedSeatId,
        agentAssetId: projectedAssetId,
      });
      // LIVE 高级秘书: the governed row is an agent record, or a workspace row
      // whose locator is the agent directory or the gateway state dir.
      // Chat cwd must be the tenant-volume Path B root
      // (`OPENBOT_TENANTS_ROOT/<tid>/users/<user>/OpenBot/agents/<id>/workspace`),
      // not that directory and not the legacy managed workspace.
      const locatorIsPathB = isPathBSeatWorkspaceLocator(occupiedLocator, {
        tenantId: tenantContext.tenantId,
        userId: actor.userId,
        agentId: params.agentId,
      });
      // Sticky seat canonical: an existing Path B under any host must not be
      // rewritten to the current actor's user tree (CEO vs Elle fork).
      const locatorIsStickyPathB = isStickyPathBSeatWorkspaceLocator(occupiedLocator, {
        tenantId: tenantContext.tenantId,
        agentId: params.agentId,
      });
      const shouldProjectSeatWorkspace =
        Boolean(projectedAssetId) &&
        (occupiedRowMissing || (!locatorIsPathB && !locatorIsStickyPathB));
      if (shouldProjectSeatWorkspace) {
        try {
          await ensureOccupiedSeatWorkspaceCatalog({
            tenantId: tenantContext.tenantId,
            seatId: occupiedSeatId,
            agentAssetId: projectedAssetId,
            locator: pathBLocator,
          });
          identity = await loadExistingGovernedWorkspaceIdentity({
            tenantId: tenantContext.tenantId,
            userId: actor.userId,
            agentId: params.agentId,
            occupiedSeatId,
          });
          logSeatVisibleGrant.info(
            `projected occupied-seat workspace seatId=${occupiedSeatId} agentId=${params.agentId}`,
          );
        } catch (err) {
          logSeatVisibleGrant.warn(
            `occupied-seat workspace projection failed seatId=${occupiedSeatId} agentId=${params.agentId}: ${String(err)}`,
          );
        }
      }
      // Seat grant SoT is the runtime agent id only. identity.agentAssetId is
      // the registry catalog key (often a UUID) and stays on the workspace
      // catalog row above. Writing it here made employeeAccess.agentIds grow
      // registry-only UUIDs, which the workbench rendered as nameless stubs.
      if (
        applyVisibleSeatAgentGrant({
          store: seatStore,
          tenantId: tenantContext.tenantId,
          seatId: occupiedSeatId,
          agentIds: [params.agentId],
          runtimeAgentIds: configuredRuntimeAgentIds(params.cfg),
          actorUserId: actor.userId,
          nowIso: new Date().toISOString(),
        })
      ) {
        try {
          await saveSeatAssetsStoreForTenantId(tenantContext.tenantId, seatStore, params.cfg);
          logSeatVisibleGrant.info(
            `projected seat agent grant seatId=${occupiedSeatId} agentId=${params.agentId}`,
          );
        } catch (err) {
          logSeatVisibleGrant.warn(
            `seat agent grant save failed seatId=${occupiedSeatId} agentId=${params.agentId}: ${String(err)}`,
          );
        }
      }
    }
  }
  if (!identity.catalog || !identity.agentAssetId) {
    if (constrainToOccupiedSeat) {
      return deniedWorkspaceLocator("seat_agent_unbound");
    }
    // Pass through user/seat grant when available so Item 7 emits
    // catalog_projection_miss / missing_agent_asset instead of missing_grant.
    return denyIncompleteLocatorQuery({
      cfg: params.cfg,
      tenantContext,
      tenantId: tenantContext.tenantId,
      actor: {
        userId: actor.userId,
        grant: resolveAvailableActorGrant(actor, params.purpose),
      },
      catalog: identity.catalog ?? null,
      agentAssetId: identity.agentAssetId ?? null,
    });
  }

  const seatPrimaryFromConfig = Boolean(
    inferSeatOwnershipFromAgentConfig(params.cfg, params.agentId),
  );
  const selection = selectTrustedCatalogResource({
    catalog: identity.catalog,
    tenantId: tenantContext.tenantId,
    actorUserId: actor.userId,
    agentAssetId: identity.agentAssetId,
    occupiedSeatId: constrainToOccupiedSeat ? occupiedSeatId : null,
    preferPositionOwned: constrainToOccupiedSeat || seatPrimaryFromConfig || seatVisible,
  });
  if (selection.status === "miss") {
    if (constrainToOccupiedSeat) {
      return deniedWorkspaceLocator("seat_agent_unbound");
    }
    return resolveWorkspaceLocator({
      tenantContext,
      tenantId: tenantContext.tenantId,
      actor: { userId: actor.userId, grant: actorUserGrant(actor.userId, params.purpose) },
      resourceId: null,
      agentAssetId: identity.agentAssetId,
      catalog: identity.catalog,
      cfg: params.cfg,
    });
  }
  if (selection.status === "ambiguous") {
    return resolveWorkspaceLocator({
      tenantContext,
      tenantId: tenantContext.tenantId,
      actor: { userId: actor.userId, grant: actorUserGrant(actor.userId, params.purpose) },
      resourceId: "ws:catalog-ambiguous",
      agentAssetId: identity.agentAssetId,
      catalog: identity.catalog,
      cfg: params.cfg,
      selectFirstCanonical: true,
    });
  }

  const grant = grantFromTrustedResource(selection.resource, actor.userId, params.purpose);
  if (!grant) {
    return denyIncompleteLocatorQuery({
      cfg: params.cfg,
      tenantContext,
      tenantId: tenantContext.tenantId,
      actor: { userId: actor.userId, grant: null },
      resourceId: selection.resource.resourceId,
      agentAssetId: identity.agentAssetId,
      catalog: identity.catalog,
    });
  }

  const membership = await loadTrustedMembership({
    cfg: params.cfg,
    tenantId: tenantContext.tenantId,
    resource: selection.resource,
  });
  const actorIdentities = actorIdentityKeys(actor);
  const durableAgentManager =
    selection.resource.ownerScope.kind === "position_owned"
      ? durableDeleteManagerProof({
          purpose: params.purpose,
          tenantId: tenantContext.tenantId,
          agentId: params.agentId,
          actorUserId: actor.userId,
          actorIdentities,
          seatId: selection.resource.ownerScope.seatId,
        })
      : undefined;
  const membershipWithActor =
    membership == null
      ? membership
      : {
          ...membership,
          actorIdentities,
          ...(durableAgentManager ? { durableAgentManager } : {}),
        };

  return resolveWorkspaceLocator({
    tenantContext,
    tenantId: tenantContext.tenantId,
    actor: { userId: actor.userId, grant },
    resourceId: selection.resource.resourceId,
    agentAssetId: identity.agentAssetId,
    catalog: identity.catalog,
    membership: membershipWithActor,
    cfg: params.cfg,
  });
}

function workspaceLocatorDeniedMessage(reasonCode: string): string {
  const base = `workspace locator denied: ${reasonCode}`;
  if (reasonCode === "seat_agent_unbound") {
    return `${base}. This assistant is listed on the occupied seat but has no governed workspace grant on that seat.`;
  }
  if (reasonCode !== "auth_failure") {
    return base;
  }
  return `${base}. Refresh the session and try again. If this robot is still listed as manageable, its workspace seat binding does not match this account — an admin must confirm the seat occupant.`;
}

export function respondWorkspaceLocatorDenied(
  respond: RespondFn,
  result: Extract<WorkspaceLocatorResult, { ok: false }>,
): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, workspaceLocatorDeniedMessage(result.reasonCode)),
  );
}

export async function resolveAgentsHandlerWorkspaceLocatorOrRespond(params: {
  client: GatewayClient | null | undefined;
  cfg: OpenBotConfig;
  agentId: string;
  purpose: string;
  respond: RespondFn;
}): Promise<string | null> {
  const located = await resolveAgentsHandlerWorkspaceLocator(params);
  if (!located.ok) {
    respondWorkspaceLocatorDenied(params.respond, located);
    return null;
  }
  return located.handle.locator;
}

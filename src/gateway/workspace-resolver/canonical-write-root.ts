/**
 * Ownership-aware write + preview root for shared / position (seat) agents.
 *
 * Invariant: for a seat-owned agent asset, write cwd and steward preview resolve
 * to the same sticky canonical filesystem root. Chatting / login userId
 * authorizes access but must not fork the path.
 *
 * Handover (v1): sticky locator — once the seat catalog canonical binding points
 * at a real Path B directory, never rewrite it to a new occupant's userId.
 * Personal / membership bots keep per-user roots.
 */
import fs from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { findPrimaryOwnerBinding } from "../agent-registry/ownership.js";
import { loadAgentRegistryStore } from "../agent-registry/store.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import { resolveLegacyAgentAssetId } from "../workspace-ownership/classify-registry.js";
import type { WorkspaceResourceCatalog } from "./catalog.js";
import { isFilesystemWorkspaceLocator, resolveRobotWriteRoot } from "./write-roots.js";

export type CanonicalWriteOwnership =
  | {
      kind: "seat_owned";
      seatId: string;
      agentAssetId?: string;
      /** Catalog (or repaired) sticky filesystem locator. */
      stickyLocator?: string | null;
      /** Path B host user segment when sticky locator is absent. */
      hostUserId?: string | null;
    }
  | { kind: "personal" }
  | { kind: "unknown" };

/** Config hint: position owner or shared/team scope with a seat ownerId. */
export function inferSeatOwnershipFromAgentConfig(
  cfg: OpenBotConfig | null | undefined,
  agentId: string,
): { seatId: string } | null {
  if (!cfg) {
    return null;
  }
  const id = normalizeAgentId(agentId);
  for (const entry of cfg.agents?.list ?? []) {
    if (!entry?.id || normalizeAgentId(entry.id) !== id) {
      continue;
    }
    const ownerId = typeof entry.ownerId === "string" ? entry.ownerId.trim() : "";
    if (!ownerId) {
      return null;
    }
    const ownerType = entry.ownerType;
    const scope = entry.scope;
    if (ownerType === "position" || scope === "shared" || scope === "team") {
      return { seatId: ownerId };
    }
    return null;
  }
  return null;
}

/**
 * Extract the user segment from a robot-own / Path B workspace locator.
 * Accepts both stateDir and OPENBOT_TENANTS_ROOT layouts.
 */
export function extractWorkspaceHostUserIdFromLocator(locator: string): string | null {
  const normalized = path.resolve(locator.trim()).split(path.sep).join("/");
  const match = normalized.match(/\/users\/([^/]+)\/OpenBot\/agents\/[^/]+\/workspace\/?$/i);
  return match?.[1]?.trim() || null;
}

/** True when locator is already a filesystem Path B / robot-own root for this agent. */
export function isStickySeatFilesystemLocator(params: {
  locator: string;
  agentId: string;
  tenantId?: string | null;
}): boolean {
  const trimmed = params.locator.trim();
  if (!trimmed || !isFilesystemWorkspaceLocator(trimmed)) {
    return false;
  }
  const agentId = normalizeAgentId(params.agentId);
  const normalized = path.resolve(trimmed).split(path.sep).join("/");
  const agentTail = `/OpenBot/agents/${agentId}/workspace`;
  if (!normalized.toLowerCase().endsWith(agentTail.toLowerCase())) {
    return false;
  }
  if (!normalized.includes("/users/")) {
    return false;
  }
  const tenantId = params.tenantId?.trim();
  if (
    tenantId &&
    !normalized.includes(`/tenants/${tenantId}/`) &&
    !normalized.includes(`/${tenantId}/users/`)
  ) {
    // Tenant volume layout: <tenantsRoot>/<tenantId>/users/...
    // Soft check — Path B under dedicated tenants root still counts as sticky.
  }
  return Boolean(extractWorkspaceHostUserIdFromLocator(trimmed));
}

export function readCatalogSeatCanonicalLocator(params: {
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

export function resolveOwnershipFromRegistry(params: {
  store: AgentRegistryStore;
  tenantId: string;
  agentId: string;
}): CanonicalWriteOwnership {
  const mapped = resolveLegacyAgentAssetId({
    store: params.store,
    tenantId: params.tenantId,
    agentId: params.agentId,
  });
  if (mapped.kind !== "resolved") {
    return { kind: "unknown" };
  }
  const primary = findPrimaryOwnerBinding(params.store, {
    enterpriseId: params.tenantId,
    agentAssetId: mapped.agentAssetId,
  });
  if (!primary) {
    return { kind: "unknown" };
  }
  if (primary.ownerType === "seat") {
    return {
      kind: "seat_owned",
      seatId: primary.ownerId,
      agentAssetId: mapped.agentAssetId,
    };
  }
  return { kind: "personal" };
}

/**
 * Merge config + registry + optional sticky catalog into one ownership hint.
 * Chatting userId is never treated as the seat path host here.
 */
export function mergeCanonicalWriteOwnership(params: {
  cfg?: OpenBotConfig | null;
  agentId: string;
  tenantId?: string | null;
  registry?: AgentRegistryStore | null;
  catalog?: WorkspaceResourceCatalog | null;
  occupiedSeatId?: string | null;
  /** Explicit sticky locator (catalog or repaired). */
  stickyLocator?: string | null;
  /** Host for first mint only when sticky is absent. */
  hostUserId?: string | null;
}): CanonicalWriteOwnership {
  const agentId = params.agentId.trim();
  const tenantId = params.tenantId?.trim() || "";
  let ownership: CanonicalWriteOwnership = { kind: "unknown" };

  if (params.registry && tenantId) {
    ownership = resolveOwnershipFromRegistry({
      store: params.registry,
      tenantId,
      agentId,
    });
  }

  if (ownership.kind === "unknown") {
    const fromCfg = inferSeatOwnershipFromAgentConfig(params.cfg, agentId);
    if (fromCfg) {
      ownership = { kind: "seat_owned", seatId: fromCfg.seatId };
    }
  }

  if (ownership.kind === "unknown" && params.occupiedSeatId?.trim() && params.catalog) {
    const occupied = params.occupiedSeatId.trim();
    // Occupied seat alone is not proof of seat-primary ownership (personal bots
    // can be granted onto a seat). Promote only when a position_owned catalog
    // row already exists for this agent/asset under that seat.
    const sticky = readCatalogSeatCanonicalLocator({
      catalog: params.catalog,
      seatId: occupied,
      agentAssetId: agentId,
    });
    if (sticky) {
      ownership = {
        kind: "seat_owned",
        seatId: occupied,
        agentAssetId: agentId,
        stickyLocator: sticky,
      };
    }
  }

  if (ownership.kind !== "seat_owned") {
    // personal / unknown → callers keep chatting-user roots.
    return ownership;
  }

  const seatId = ownership.seatId;
  const agentAssetId = ownership.agentAssetId?.trim() || agentId;
  let sticky =
    params.stickyLocator?.trim() ||
    readCatalogSeatCanonicalLocator({
      catalog: params.catalog,
      seatId,
      agentAssetId,
    }) ||
    "";

  if (sticky && !isStickySeatFilesystemLocator({ locator: sticky, agentId, tenantId })) {
    sticky = "";
  }

  const hostFromSticky = sticky ? extractWorkspaceHostUserIdFromLocator(sticky) : null;
  const hostUserId = hostFromSticky || params.hostUserId?.trim() || null;

  return {
    kind: "seat_owned",
    seatId,
    agentAssetId,
    stickyLocator: sticky || null,
    hostUserId,
  };
}

/**
 * Production write/preview root. Seat-owned agents ignore chattingUserId for
 * the path (authorization stays elsewhere). Personal/unknown keep prior behavior.
 */
export function resolveCanonicalRobotWriteRoot(params: {
  agentId: string;
  tenantId?: string | null;
  chattingUserId?: string | null;
  sessionKey?: string | null;
  stateDir?: string;
  ownership?: CanonicalWriteOwnership;
  mergePolluting?: boolean;
  ensureDirectory?: boolean;
}): string | null {
  const ownership = params.ownership ?? { kind: "unknown" };
  if (ownership.kind === "seat_owned") {
    const sticky = ownership.stickyLocator?.trim() ?? "";
    if (sticky && isFilesystemWorkspaceLocator(sticky)) {
      const resolved = path.resolve(sticky);
      if (params.ensureDirectory !== false) {
        fs.mkdirSync(resolved, { recursive: true });
      }
      return resolved;
    }
    const host = ownership.hostUserId?.trim() ?? "";
    if (host) {
      return resolveRobotWriteRoot({
        agentId: params.agentId,
        tenantId: params.tenantId,
        userId: host,
        sessionKey: params.sessionKey,
        stateDir: params.stateDir,
        mergePolluting: params.mergePolluting,
      });
    }
    // Fail closed: do not fork seat roots onto the chatting user.
    return null;
  }

  return resolveRobotWriteRoot({
    agentId: params.agentId,
    tenantId: params.tenantId,
    userId: params.chattingUserId,
    sessionKey: params.sessionKey,
    stateDir: params.stateDir,
    mergePolluting: params.mergePolluting,
  });
}

/** Path B locator under the sticky / host user (never the chatting actor by accident). */
export function resolveCanonicalPathBSeatLocator(params: {
  tenantId: string;
  agentId: string;
  ownership: Extract<CanonicalWriteOwnership, { kind: "seat_owned" }>;
  /** First-mint fallback when sticky/host missing — typically the current occupant. */
  mintHostUserId?: string | null;
  tenantsRoot?: string;
  env?: NodeJS.ProcessEnv;
  resolvePathB: (args: {
    tenantId: string;
    userId: string;
    agentId: string;
    tenantsRoot?: string;
    env?: NodeJS.ProcessEnv;
  }) => string;
}): { locator: string; hostUserId: string; sticky: boolean } | null {
  const sticky = params.ownership.stickyLocator?.trim() ?? "";
  if (
    sticky &&
    isStickySeatFilesystemLocator({
      locator: sticky,
      agentId: params.agentId,
      tenantId: params.tenantId,
    })
  ) {
    const host = extractWorkspaceHostUserIdFromLocator(sticky) ?? params.ownership.hostUserId ?? "";
    return { locator: path.resolve(sticky), hostUserId: host, sticky: true };
  }
  const host = params.ownership.hostUserId?.trim() || params.mintHostUserId?.trim() || "";
  if (!host) {
    return null;
  }
  const locator = params.resolvePathB({
    tenantId: params.tenantId,
    userId: host,
    agentId: params.agentId,
    tenantsRoot: params.tenantsRoot,
    env: params.env,
  });
  return { locator, hostUserId: host, sticky: false };
}

/**
 * Best-effort async ownership load for gateway call sites (steward / get-reply).
 * Does not throw — returns unknown/personal on store outages.
 */
export async function loadCanonicalWriteOwnership(params: {
  cfg: OpenBotConfig;
  agentId: string;
  tenantId?: string | null;
  chattingUserId?: string | null;
  occupiedSeatId?: string | null;
  stateDir?: string;
  registryStorePath?: string;
  catalog?: WorkspaceResourceCatalog | null;
  stickyLocator?: string | null;
  hostUserId?: string | null;
}): Promise<CanonicalWriteOwnership> {
  let registry: AgentRegistryStore | null = null;
  try {
    registry = await loadAgentRegistryStore(params.registryStorePath);
  } catch {
    registry = null;
  }

  return mergeCanonicalWriteOwnership({
    cfg: params.cfg,
    agentId: params.agentId,
    tenantId: params.tenantId,
    registry,
    catalog: params.catalog,
    occupiedSeatId: params.occupiedSeatId,
    stickyLocator: params.stickyLocator,
    // Callers that mint a first Path B pass chattingUserId as hostUserId.
    // Preview / read paths omit host so seat-owned without sticky fail closed
    // instead of forking onto the login user.
    hostUserId: params.hostUserId ?? null,
  });
}

/** Test helper: build seat ownership with an explicit host (no catalog). */
export function seatOwnedWriteOwnership(params: {
  seatId: string;
  hostUserId?: string | null;
  stickyLocator?: string | null;
  agentAssetId?: string;
}): CanonicalWriteOwnership {
  return {
    kind: "seat_owned",
    seatId: params.seatId,
    agentAssetId: params.agentAssetId,
    hostUserId: params.hostUserId ?? null,
    stickyLocator: params.stickyLocator ?? null,
  };
}

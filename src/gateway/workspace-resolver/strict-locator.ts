import { isManagedDataMode } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
import { SCHEMA_V2_ENABLED } from "../../memory/schema-v2.js";
import {
  listTenantSeats,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import type { PlatformAuthStore } from "../platform-auth/store-types.js";
import type { TenantContext } from "../tenant-context.js";
import type { GroupAclEvidence, WorkspaceOwnerScope } from "../workspace-ownership/types.js";
import type { WorkspaceResourceCatalog } from "./catalog.js";
import type { WorkspaceBindingRecord, WorkspaceResourceRecord } from "./types.js";

export const ITEM7_LOCATOR_CONTRACT = "item7-strict-locator/v1" as const;
export const ITEM7_LOCATOR_LIVE_WRITE_WATCH_INDEX = 36;
export const ITEM7_LOCATOR_FROZEN_WRITE_WATCH_INDEX = 38;
export const ITEM7_LOCATOR_RETIRED_THIS_CHANGE = 1;
export const ITEM7_LOCATOR_DELETE_CALL_SITES = false;
export const ITEM7_LOCATOR_WIRED_TO_PRODUCTION = false;
export const ITEM7_LOCATOR_PRODUCTION_CATALOG_WRITE = "none" as const;
export const ITEM7_LOCATOR_SCHEMA_V2_WRITE = SCHEMA_V2_ENABLED ? "enabled" : "disabled";
export const ITEM7_LOCATOR_LIVE = "forbidden" as const;
export const ITEM7_LOCATOR_ITEM7 = "not-met" as const;
export const ITEM7_LOCATOR_PHASE1B_UNLOCK = "not-issued" as const;
export const ITEM7_LOCATOR_EXECUTION_BLOCKED = true;
export const ITEM7_LOCATOR_DEPLOY_AUTHORIZED = false;

export type WorkspaceLocatorGrant = {
  kind: "user" | "seat" | "group";
  /** userId when kind=user, seatId when kind=seat, groupId when kind=group. */
  subjectId: string;
  purpose: string;
};

export type WorkspaceLocatorHandle = {
  resourceId: string;
  agentAssetId: string;
  bindingId: string;
  locator: string;
  tenantId: string;
};

export type WorkspaceLocatorReasonCode =
  | "missing_tenant_context"
  | "missing_tenant_id"
  | "tenant_id_optional_forbidden"
  | "missing_actor"
  | "actor_optional_forbidden"
  | "missing_grant"
  | "auth_failure"
  | "seat_agent_unbound"
  | "missing_membership_sot"
  | "workspace_kind_blocked"
  | "tenant_mismatch"
  | "agent_id_slug_query_forbidden"
  | "resource_id_substring_match_forbidden"
  | "catalog_global_snapshot_fallback_forbidden"
  | "catch_continue_forbidden"
  | "first_canonical_selection_forbidden"
  | "empty_workspace_dir_forbidden"
  | "catalog_projection_miss"
  | "missing_agent_asset"
  | "catalog_miss"
  | "catalog_unavailable"
  | "catalog_ambiguous"
  | "multi_binding"
  | "agent_asset_mismatch"
  | "live_cutover_forbidden"
  | "item7_met_forbidden"
  | "delete_call_sites_forbidden"
  | "rewrite_watch_index_forbidden";

export type WorkspaceLocatorSuccess = {
  ok: true;
  handle: WorkspaceLocatorHandle;
  locator: WorkspaceLocatorHandle;
};

export type WorkspaceLocatorFailure = {
  ok: false;
  reasonCode: WorkspaceLocatorReasonCode;
  failClosed: true;
  item7: "not-met";
  liveWriteWatchIndex: 36;
  retiredThisChange: 1;
  deleteCallSites: false;
  wiredToProductionResolver: false;
  productionCatalogWrite: "none";
  schemaV2Write: "disabled";
  live: "forbidden";
  phase1bExecutionBlocked: true;
  phase1bUnlock: "not-issued";
  deployAuthorized: false;
};

export type WorkspaceLocatorResult = WorkspaceLocatorSuccess | WorkspaceLocatorFailure;

/**
 * Incomplete shapes are accepted so tests can prove denial. Production callers
 * must not pass agentId/slug/substring/fallback flags; those always fail closed.
 */
export type WorkspaceLocatorQueryAttempt = {
  tenantContext?: TenantContext | null;
  tenantId?: string | null;
  actor?: {
    /** Current employee. Never a seatId or groupId. */
    userId?: string | null;
    grant?: WorkspaceLocatorGrant | null;
  } | null;
  /**
   * Authoritative platform-auth membership/grant evidence.
   * Seat and group grants must use this SoT; callers may not invent a second store.
   */
  membership?: {
    source: "platform-auth";
    platformAuthStore?: PlatformAuthStore | null;
    seatStore?: EnterpriseSeatAssetsStore | null;
    groupAcl?: GroupAclEvidence | null;
    /**
     * Extra actor identities (email, etc.) the handler already resolved.
     * Seat occupancy matches any of these, not only `actor.userId`.
     * Server-built. Client wire fields are never copied here.
     */
    actorIdentities?: readonly string[] | null;
    /**
     * Delete-only proof that this actor is still the ownership-store manager
     * of the agent, after a seat handover left them off `currentEmployeeId`.
     * File reads do not set this and stay fail-closed.
     */
    durableAgentManager?: {
      purpose: "agents.delete";
      actorUserId: string;
      seatId: string;
    } | null;
  } | null;
  resourceId?: string | null;
  agentAssetId?: string | null;
  agentId?: string | null;
  slug?: string | null;
  resourceIdMatch?: "exact" | "includes" | "endsWith" | null;
  fallbackToGlobalSnapshot?: boolean;
  catchContinue?: boolean;
  selectFirstCanonical?: boolean;
  emptyWorkspaceDirOnMiss?: boolean;
  catalog?: WorkspaceResourceCatalog | null;
  cfg?: OpenBotConfig;
  liveCutover?: boolean;
  item7Met?: boolean;
  deleteCallSites?: boolean;
  liveWriteWatchIndex?: number;
};

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function deniedWorkspaceLocator(
  reasonCode: WorkspaceLocatorReasonCode,
): WorkspaceLocatorFailure {
  return deny(reasonCode);
}

function deny(reasonCode: WorkspaceLocatorReasonCode): WorkspaceLocatorFailure {
  return {
    ok: false,
    reasonCode,
    failClosed: true,
    item7: "not-met",
    liveWriteWatchIndex: ITEM7_LOCATOR_LIVE_WRITE_WATCH_INDEX,
    retiredThisChange: ITEM7_LOCATOR_RETIRED_THIS_CHANGE,
    deleteCallSites: false,
    wiredToProductionResolver: false,
    productionCatalogWrite: "none",
    schemaV2Write: "disabled",
    live: "forbidden",
    phase1bExecutionBlocked: true,
    phase1bUnlock: "not-issued",
    deployAuthorized: false,
  };
}

function ownerAgentAssetId(resource: WorkspaceResourceRecord): string | null {
  if (resource.ownerScope.kind === "user_owned" || resource.ownerScope.kind === "position_owned") {
    return resource.ownerScope.agentAssetId;
  }
  return null;
}

function ownerIdentityKey(scope: WorkspaceOwnerScope): string | null {
  if (scope.kind === "user_owned") {
    return `user:${scope.userId}`;
  }
  if (scope.kind === "position_owned") {
    return `seat:${scope.seatId}`;
  }
  if (scope.kind === "group_owned") {
    return `group:${scope.groupId}`;
  }
  return null;
}

function platformAuthUserExists(store: PlatformAuthStore, userId: string): boolean {
  return Boolean(store.users[userId]);
}

function identityKey(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function actorIdentityKeys(
  actorUserId: string,
  extras: readonly string[] | null | undefined,
): Set<string> {
  const keys = new Set<string>();
  const primary = identityKey(actorUserId);
  if (primary) {
    keys.add(primary);
  }
  for (const extra of extras ?? []) {
    const key = identityKey(extra);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function identityMatches(
  identities: ReadonlySet<string>,
  value: string | null | undefined,
): boolean {
  const key = identityKey(value);
  return key.length > 0 && identities.has(key);
}

export function isAuthoritativeSeatMember(params: {
  seatStore: EnterpriseSeatAssetsStore;
  tenantId: string;
  actorUserId: string;
  actorIdentities?: readonly string[] | null;
  seatId: string;
}): boolean {
  const identities = actorIdentityKeys(params.actorUserId, params.actorIdentities);
  const seat = listTenantSeats(params.seatStore, params.tenantId).find(
    (entry) => entry.seatId === params.seatId,
  );
  if (identityMatches(identities, seat?.currentEmployeeId)) {
    return true;
  }
  return Object.values(params.seatStore.bindings ?? {}).some(
    (binding) =>
      binding.tenantId === params.tenantId &&
      binding.seatId === params.seatId &&
      identityMatches(identities, binding.employeeId) &&
      binding.bindingStatus === "active",
  );
}

type DurableAgentManagerProof = NonNullable<
  NonNullable<WorkspaceLocatorQueryAttempt["membership"]>["durableAgentManager"]
>;

function isDurableDeleteManager(params: {
  actorUserId: string;
  grantSeatId: string;
  grantPurpose: string;
  durable: DurableAgentManagerProof | null | undefined;
}): boolean {
  const durable = params.durable;
  if (!durable) {
    return false;
  }
  // The proof object is purpose-tagged, but the grant is what this call is
  // actually asking to do. A files.get (or any non-delete) grant must not
  // succeed just because a delete proof was attached.
  return (
    params.grantPurpose === "agents.delete" &&
    durable.purpose === "agents.delete" &&
    durable.actorUserId === params.actorUserId &&
    durable.seatId === params.grantSeatId
  );
}

function isLocatorFailure(
  value: WorkspaceBindingRecord | WorkspaceLocatorFailure,
): value is WorkspaceLocatorFailure {
  return "ok" in value && !value.ok;
}

function uniqueActiveCanonicalBinding(
  bindings: WorkspaceBindingRecord[],
  resourceId: string,
): WorkspaceBindingRecord | WorkspaceLocatorFailure {
  const canonical = bindings.filter(
    (binding) =>
      binding.resourceId === resourceId &&
      binding.role === "canonical" &&
      binding.state === "active",
  );
  if (canonical.length === 0) {
    return deny("catalog_miss");
  }
  if (canonical.length > 1) {
    return deny("multi_binding");
  }
  return canonical[0];
}

/**
 * Select the unique cutover TARGET binding for a resource: role=compatibility,
 * state=read_only. Used by resolveWorkspaceTargetBinding. Fail-closed with
 * catalog_miss when absent and multi_binding when duplicated; never returns the
 * first match and never falls back to the canonical/source binding.
 */
function uniqueTargetBinding(
  bindings: WorkspaceBindingRecord[],
  resourceId: string,
): WorkspaceBindingRecord | WorkspaceLocatorFailure {
  const targets = bindings.filter(
    (binding) =>
      binding.resourceId === resourceId &&
      binding.role === "compatibility" &&
      binding.state === "read_only",
  );
  if (targets.length === 0) {
    return deny("catalog_miss");
  }
  if (targets.length > 1) {
    return deny("multi_binding");
  }
  return targets[0];
}

function authorizeGrant(params: {
  grant: WorkspaceLocatorGrant;
  tenantContext: TenantContext;
  actorUserId: string;
  tenantId: string;
  resource: WorkspaceResourceRecord;
  membership: WorkspaceLocatorQueryAttempt["membership"];
}): WorkspaceLocatorFailure | null {
  if (!hasText(params.grant.purpose)) {
    return deny("auth_failure");
  }
  const scope = params.resource.ownerScope;
  if (scope.kind === "unknown") {
    return deny("workspace_kind_blocked");
  }
  if (params.grant.kind === "user") {
    if (params.grant.subjectId !== params.actorUserId) {
      return deny("auth_failure");
    }
    if (params.grant.subjectId !== params.tenantContext.userId) {
      return deny("auth_failure");
    }
    if (scope.kind !== "user_owned" || scope.userId !== params.grant.subjectId) {
      return deny("auth_failure");
    }
    return null;
  }
  if (params.grant.kind === "seat") {
    if (scope.kind !== "position_owned" || scope.seatId !== params.grant.subjectId) {
      return deny("auth_failure");
    }
    const store = params.membership?.source === "platform-auth" ? params.membership : null;
    if (!store?.platformAuthStore || !store.seatStore) {
      return deny("missing_membership_sot");
    }
    if (!platformAuthUserExists(store.platformAuthStore, params.actorUserId)) {
      return deny("missing_membership_sot");
    }
    if (
      !isAuthoritativeSeatMember({
        seatStore: store.seatStore,
        tenantId: params.tenantId,
        actorUserId: params.actorUserId,
        actorIdentities: store.actorIdentities,
        seatId: params.grant.subjectId,
      })
    ) {
      // Seat occupancy is still required unless this grant is agents.delete
      // and the ownership store still names this actor as manager.
      if (
        !isDurableDeleteManager({
          actorUserId: params.actorUserId,
          grantSeatId: params.grant.subjectId,
          grantPurpose: params.grant.purpose,
          durable: store.durableAgentManager,
        })
      ) {
        return deny("auth_failure");
      }
    }
    return null;
  }
  if (params.grant.kind === "group") {
    if (scope.kind !== "group_owned" || scope.groupId !== params.grant.subjectId) {
      return deny("auth_failure");
    }
    const groupAcl =
      params.membership?.source === "platform-auth" ? params.membership.groupAcl : null;
    if (!groupAcl || !groupAcl.available) {
      return deny("missing_membership_sot");
    }
    if (groupAcl.tenantId !== params.tenantId || groupAcl.groupId !== params.grant.subjectId) {
      return deny("tenant_mismatch");
    }
    if (!groupAcl.memberUserIds.includes(params.actorUserId)) {
      return deny("auth_failure");
    }
    return null;
  }
  return deny("auth_failure");
}

type ValidatedLocatorQuery = {
  catalog: WorkspaceResourceCatalog;
  resourceId: string;
  tenantId: string;
  resource: WorkspaceResourceRecord;
  resolvedAgentAssetId: string;
};

/**
 * Shared guardrail + identity + authorization validation for the strict locator
 * family. Runs every fail-closed check up to (but not including) binding
 * selection, so the canonical-source resolver and the cutover-target resolver
 * share one security posture and cannot diverge. Returns the validated,
 * non-null resource context on success, or a WorkspaceLocatorFailure otherwise.
 */
function validateWorkspaceLocatorQuery(
  attempt: WorkspaceLocatorQueryAttempt,
): WorkspaceLocatorFailure | ValidatedLocatorQuery {
  if (attempt.liveCutover === true) {
    return deny("live_cutover_forbidden");
  }
  if (attempt.item7Met === true) {
    return deny("item7_met_forbidden");
  }
  if (attempt.deleteCallSites === true) {
    return deny("delete_call_sites_forbidden");
  }
  if (attempt.liveWriteWatchIndex === 0) {
    return deny("rewrite_watch_index_forbidden");
  }
  if (attempt.catchContinue === true) {
    return deny("catch_continue_forbidden");
  }
  if (attempt.fallbackToGlobalSnapshot === true) {
    return deny("catalog_global_snapshot_fallback_forbidden");
  }
  if (attempt.selectFirstCanonical === true) {
    return deny("first_canonical_selection_forbidden");
  }
  if (attempt.emptyWorkspaceDirOnMiss === true) {
    return deny("empty_workspace_dir_forbidden");
  }
  if (hasText(attempt.agentId) || hasText(attempt.slug)) {
    return deny("agent_id_slug_query_forbidden");
  }
  if (attempt.resourceIdMatch === "includes" || attempt.resourceIdMatch === "endsWith") {
    return deny("resource_id_substring_match_forbidden");
  }
  if (attempt.tenantContext == null) {
    return deny("missing_tenant_context");
  }
  if (attempt.tenantId == null) {
    return deny("tenant_id_optional_forbidden");
  }
  if (!hasText(attempt.tenantId)) {
    return deny("missing_tenant_id");
  }
  if (attempt.actor == null) {
    return deny("actor_optional_forbidden");
  }
  if (!hasText(attempt.actor.userId)) {
    return deny("missing_actor");
  }
  if (attempt.actor.grant == null) {
    return deny("missing_grant");
  }
  // Precise incomplete-identity codes: do not let a null grant (or missing
  // resourceId alone) mask catalog projection / agent-asset gaps as missing_grant.
  if (attempt.catalog == null) {
    return deny("catalog_projection_miss");
  }
  if (!hasText(attempt.agentAssetId) && !hasText(attempt.resourceId)) {
    return deny("missing_agent_asset");
  }
  if (!hasText(attempt.resourceId)) {
    return deny("catalog_miss");
  }
  if (
    attempt.tenantContext.tenantId !== attempt.tenantId ||
    attempt.tenantContext.userId !== attempt.actor.userId
  ) {
    return deny("tenant_mismatch");
  }

  const managed = isManagedDataMode(attempt.cfg);
  try {
    const snapshot = attempt.catalog.snapshot();
    if (snapshot.status !== "available") {
      return deny(managed ? "catalog_unavailable" : "catalog_miss");
    }

    const resource = attempt.catalog.getResource(attempt.resourceId);
    if (!resource) {
      return deny("catalog_miss");
    }
    if (resource.tenantId !== attempt.tenantId) {
      return deny("tenant_mismatch");
    }
    if (resource.ownerScope.kind === "unknown") {
      return deny("workspace_kind_blocked");
    }
    let resolvedAgentAssetId: string;
    if (resource.ownerScope.kind === "group_owned") {
      // Group workspaces have no agent asset; reuse the groupId when the caller omits one.
      resolvedAgentAssetId = hasText(attempt.agentAssetId)
        ? attempt.agentAssetId
        : resource.ownerScope.groupId;
    } else {
      if (!hasText(attempt.agentAssetId)) {
        return deny("catalog_miss");
      }
      if (ownerAgentAssetId(resource) !== attempt.agentAssetId) {
        return deny("agent_asset_mismatch");
      }
      resolvedAgentAssetId = attempt.agentAssetId;
    }
    const grantDenied = authorizeGrant({
      grant: attempt.actor.grant,
      tenantContext: attempt.tenantContext,
      actorUserId: attempt.actor.userId,
      tenantId: attempt.tenantId,
      resource,
      membership: attempt.membership,
    });
    if (grantDenied) {
      return grantDenied;
    }

    const ownerKey = ownerIdentityKey(resource.ownerScope);
    const sameOwnerAsset = Object.values(snapshot.resources).filter((candidate) => {
      if (candidate.tenantId !== attempt.tenantId) {
        return false;
      }
      if (ownerIdentityKey(candidate.ownerScope) !== ownerKey) {
        return false;
      }
      if (resource.ownerScope.kind === "group_owned") {
        return candidate.ownerScope.kind === "group_owned";
      }
      return ownerAgentAssetId(candidate) === attempt.agentAssetId;
    });
    if (sameOwnerAsset.length > 1) {
      return deny("catalog_ambiguous");
    }

    return {
      catalog: attempt.catalog,
      resourceId: attempt.resourceId,
      tenantId: attempt.tenantId,
      resource,
      resolvedAgentAssetId,
    };
  } catch {
    return deny("catalog_unavailable");
  }
}

function finalizeLocator(
  validated: ValidatedLocatorQuery,
  binding: WorkspaceBindingRecord | WorkspaceLocatorFailure,
): WorkspaceLocatorResult {
  if (isLocatorFailure(binding)) {
    return binding;
  }
  if (!hasText(binding.locator)) {
    return deny("empty_workspace_dir_forbidden");
  }
  const handle: WorkspaceLocatorHandle = {
    resourceId: validated.resourceId,
    agentAssetId: validated.resolvedAgentAssetId,
    bindingId: binding.bindingId,
    locator: binding.locator,
    tenantId: validated.tenantId,
  };
  return { ok: true, handle, locator: handle };
}

/**
 * Strict workspace locator. Not wired to remaining production call-sites.
 * Resolves the unique active canonical binding (the source/current writer).
 */
export function resolveWorkspaceLocator(
  attempt: WorkspaceLocatorQueryAttempt,
): WorkspaceLocatorResult {
  const validated = validateWorkspaceLocatorQuery(attempt);
  if ("ok" in validated) {
    return validated;
  }
  try {
    return finalizeLocator(
      validated,
      uniqueActiveCanonicalBinding(
        validated.catalog.listBindingsForResource(validated.resourceId),
        validated.resourceId,
      ),
    );
  } catch {
    return deny("catalog_unavailable");
  }
}

/**
 * Strict cutover TARGET-binding resolver (Item 7 S25). Reads the unique
 * compatibility/read_only target binding that already exists on the same
 * resource in the Catalog SoT. Shares every identity/authorization check with
 * resolveWorkspaceLocator via validateWorkspaceLocatorQuery, then selects the
 * target binding instead of the canonical source. Fail-closed on miss,
 * duplicate, cross-tenant, or unauthorized access; never falls back to the
 * canonical/source binding and never mutates the catalog (no mkdir/copy/write/
 * delete/Catalog mutation). Not wired to production beyond the single
 * controlled steward-write target read.
 */
export function resolveWorkspaceTargetBinding(
  attempt: WorkspaceLocatorQueryAttempt,
): WorkspaceLocatorResult {
  const validated = validateWorkspaceLocatorQuery(attempt);
  if ("ok" in validated) {
    return validated;
  }
  try {
    return finalizeLocator(
      validated,
      uniqueTargetBinding(
        validated.catalog.listBindingsForResource(validated.resourceId),
        validated.resourceId,
      ),
    );
  } catch {
    return deny("catalog_unavailable");
  }
}

export type LegacyLocatorCallerShape =
  | "agentId-only"
  | "client-scoped-agentId"
  | "empty-catalog-synthesize"
  | "builder-without-tenant-context";

export const LEGACY_LOCATOR_CALLER_MATRIX: ReadonlyArray<{
  pathId: string;
  symbol: string;
  file: string;
  shape: LegacyLocatorCallerShape;
  expectedReasonCode: WorkspaceLocatorReasonCode;
}> = [
  {
    pathId: "P1",
    symbol: "resolveAgentWorkspaceDir",
    file: "src/auto-reply/reply/get-reply.ts",
    shape: "agentId-only",
    expectedReasonCode: "agent_id_slug_query_forbidden",
  },
  {
    pathId: "P3",
    symbol: "resolveAgentWorkspaceDirForClient",
    file: "src/commands/agent.ts",
    shape: "client-scoped-agentId",
    expectedReasonCode: "agent_id_slug_query_forbidden",
  },
  {
    pathId: "P4",
    symbol: "createEmptyWorkspaceCatalog",
    file: "src/gateway/knowledge/deliverables/maybe-auto-capture-agent-deliverable.ts",
    shape: "empty-catalog-synthesize",
    expectedReasonCode: "catalog_projection_miss",
  },
  {
    pathId: "P4",
    symbol: "buildUserOwnedWorkspaceCatalogEntry",
    file: "src/gateway/workspace-resolver/builders.ts",
    shape: "builder-without-tenant-context",
    expectedReasonCode: "missing_tenant_context",
  },
];

export function denyLegacyLocatorCaller(shape: LegacyLocatorCallerShape): WorkspaceLocatorResult {
  if (shape === "agentId-only" || shape === "client-scoped-agentId") {
    return resolveWorkspaceLocator({ agentId: "main" });
  }
  if (shape === "empty-catalog-synthesize") {
    return resolveWorkspaceLocator({
      tenantContext: { tenantId: "tenant-a", userId: "user-a", domain: "enterprise" },
      tenantId: "tenant-a",
      actor: {
        userId: "user-a",
        grant: { kind: "user", subjectId: "user-a", purpose: "legacy-empty-catalog" },
      },
      resourceId: "ws:tenant-a:user:user-a:asset:main",
      agentAssetId: "main",
    });
  }
  return resolveWorkspaceLocator({
    tenantId: "tenant-a",
    actor: {
      userId: "user-a",
      grant: { kind: "user", subjectId: "user-a", purpose: "legacy-builder" },
    },
    resourceId: "ws:tenant-a:user:user-a:asset:main",
    agentAssetId: "main",
  });
}

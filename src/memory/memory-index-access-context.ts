/**
 * Item 7 Stage C — server-built structured access context for the memory index
 * pipeline. It is resolved ONCE at the getMemorySearchManager dispatch seam
 * (ledger S32) and, for managed_enterprise, binds the manager to a canonical
 * workspace handle via CogniWeaveMemoryManager.createFromHandle (identity +
 * scope + permission gating). personal_local keeps the legacy
 * resolveAgentWorkspaceDir path untouched.
 *
 * The qmd/builtin local index roots (backend-config.ts / manager.ts /
 * qmd-manager.ts, ledger S30/S31/S36/S37) are frozen by the Phase 0 retirement
 * scan and are NOT tenant/resource-isolated in this slice; a managed tenant on a
 * non-cogniweave backend therefore fails closed at dispatch rather than sharing
 * a legacy local root. Isolating those roots in place is deferred to their
 * retirement (which updates the CODEOWNERS-pinned freeze baseline).
 *
 * This is the ONLY sanctioned identity object for the memory index pipeline. It
 * is:
 *   - SERVER-BUILT — constructed from an authenticated call entry (tenant/actor/
 *     ownership proof) or an explicit background marker; never assembled from
 *     loose, client-overridable wire fields.
 *   - FROZEN + BRANDED — a spread/cast cannot forge one, and the wire-supplied
 *     tenantId / userId / resourceId / agentAssetId can never override the
 *     server-resolved identity downstream.
 *   - AUDITABLE — `provenance` records where it was built and the owner kind;
 *     a `system`-owned proof may NOT drive a user memory index (no forged
 *     operator/system auth).
 *
 * managed_enterprise carries the full trusted identity the canonical resolver
 * needs and resolves an EXISTING canonical/active binding fail-closed.
 * personal_local is an explicit profile marker with no tenant identity and is
 * NEVER produced as a managed fallback (the discriminated union makes the
 * managed branch structurally unable to reach the personal compat path).
 */

import {
  type CanonicalMemoryWorkspaceResolver,
  type Item7StageCLedgerId,
  type MemoryIndexActor,
  type MemoryIndexOwnershipGrant,
  type MemoryIndexTrustedIdentity,
  resolveMemoryIndexWorkspaceHandle,
} from "./memory-index-workspace-handle.js";
import type { MemorySearchGovernance } from "./memory-search-governance.js";
import type { MemoryWorkspaceHandle } from "./memory-workspace-handle.js";

/** Structured, auditable reasons for the identity pipeline (superset of §八). */
export type MemoryIndexAccessReason =
  | "managed_identity_required"
  | "managed_catalog_miss"
  | "managed_catalog_ambiguous"
  | "managed_tenant_mismatch"
  | "managed_grant_denied"
  | "managed_membership_missing"
  | "managed_workspace_not_indexable"
  | "managed_background_deferred";

export type MemoryIndexAccessProvenance = {
  readonly source: "call-entry" | "background" | "test";
  readonly builtAt: string;
  readonly ownerKind?: "user" | "position" | "group" | "system";
  readonly note?: string;
};

export type PersonalLocalMemoryIndexAccessContext = {
  readonly securityProfile: "personal_local";
  readonly provenance: MemoryIndexAccessProvenance;
};

export type ManagedMemoryIndexAccessContext = {
  readonly securityProfile: "managed_enterprise";
  readonly identity: MemoryIndexTrustedIdentity;
  /**
   * Canonical Resource Resolver injected by the gateway seam (a closure over
   * `resolveMemoryWorkspaceHandle`); the memory layer never imports the gateway.
   */
  readonly resolveCanonicalHandle: CanonicalMemoryWorkspaceResolver;
  readonly provenance: MemoryIndexAccessProvenance;
};

export type MemoryIndexAccessContext =
  | PersonalLocalMemoryIndexAccessContext
  | ManagedMemoryIndexAccessContext;

const brandedAccessContexts = new WeakSet<object>();

export function isMemoryIndexAccessContext(value: unknown): value is MemoryIndexAccessContext {
  return typeof value === "object" && value !== null && brandedAccessContexts.has(value);
}

function buildProvenance(
  input?: Partial<MemoryIndexAccessProvenance>,
): MemoryIndexAccessProvenance {
  return Object.freeze({
    source: input?.source ?? "call-entry",
    builtAt: input?.builtAt ?? new Date().toISOString(),
    ownerKind: input?.ownerKind,
    note: input?.note,
  });
}

function brand<T extends object>(ctx: T): T {
  const frozen = Object.freeze(ctx);
  brandedAccessContexts.add(frozen);
  return frozen;
}

/** Explicit, server-resolved personal_local profile marker (no tenant identity). */
export function personalLocalAccessContext(
  provenance?: Partial<MemoryIndexAccessProvenance>,
): PersonalLocalMemoryIndexAccessContext {
  return brand({ securityProfile: "personal_local", provenance: buildProvenance(provenance) });
}

export type BuildManagedAccessContextResult =
  | { readonly ok: true; readonly context: ManagedMemoryIndexAccessContext }
  | { readonly ok: false; readonly reasonCode: MemoryIndexAccessReason; readonly reason: string };

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Build a managed access context from explicit server-trusted identity fields.
 * Requires a non-empty tenantId + userId + an actor whose tenant matches; the
 * `resolveCanonicalHandle` port is mandatory (no resolver => fail-closed later).
 */
export function managedAccessContext(params: {
  tenantId: string;
  userId: string;
  actor?: MemoryIndexActor;
  agentAssetId?: string;
  resourceId?: string;
  ownershipGrant?: MemoryIndexOwnershipGrant;
  expectedFencingToken?: string;
  configuredCloudTenantId?: string | null;
  resolveCanonicalHandle: CanonicalMemoryWorkspaceResolver;
  provenance?: Partial<MemoryIndexAccessProvenance>;
}): BuildManagedAccessContextResult {
  const tenantId = params.tenantId?.trim();
  const userId = params.userId?.trim();
  if (!hasText(tenantId) || !hasText(userId)) {
    return {
      ok: false,
      reasonCode: "managed_identity_required",
      reason: "managed_enterprise access requires a server-trusted tenantId + userId",
    };
  }
  if (typeof params.resolveCanonicalHandle !== "function") {
    return {
      ok: false,
      reasonCode: "managed_identity_required",
      reason: "managed_enterprise access requires the canonical Resource Resolver port",
    };
  }
  const actor: MemoryIndexActor = params.actor ?? {
    userId,
    tenantId,
    grant: params.ownershipGrant ?? { userId },
  };
  if (actor.tenantId !== tenantId || actor.userId !== userId) {
    return {
      ok: false,
      reasonCode: "managed_tenant_mismatch",
      reason: "actor tenantId/userId must match the trusted identity",
    };
  }
  const identity: MemoryIndexTrustedIdentity = {
    tenantId,
    userId,
    actor,
    resourceId: params.resourceId,
    agentAssetId: params.agentAssetId,
    expectedFencingToken: params.expectedFencingToken,
    configuredCloudTenantId: params.configuredCloudTenantId,
  };
  return {
    ok: true,
    context: brand({
      securityProfile: "managed_enterprise",
      identity: Object.freeze(identity),
      resolveCanonicalHandle: params.resolveCanonicalHandle,
      provenance: buildProvenance(params.provenance),
    }),
  };
}

/**
 * Derive a managed access context from an authenticated MemorySearchGovernance.
 * user-owned proof supplies the userId directly; position/group ownership needs
 * an explicit `authenticatedUserId` (the acting user) or fails closed
 * (managed_membership_missing). A system-owned proof is refused
 * (managed_grant_denied) — it cannot drive a per-user memory index.
 */
export function deriveManagedAccessContextFromGovernance(params: {
  governance: MemorySearchGovernance;
  authenticatedUserId?: string | null;
  resourceId?: string;
  resolveCanonicalHandle: CanonicalMemoryWorkspaceResolver;
  provenance?: Partial<MemoryIndexAccessProvenance>;
}): BuildManagedAccessContextResult {
  const proof = params.governance.ownershipProof;
  if (!proof) {
    return {
      ok: false,
      reasonCode: "managed_grant_denied",
      reason: "managed_enterprise access requires an ownership proof",
    };
  }
  const scopeTenantId = proof.scope.kind === "tenant" ? proof.scope.tenantId : null;
  const tenantId = (params.governance.tenantId ?? scopeTenantId)?.trim();
  if (!hasText(tenantId)) {
    return {
      ok: false,
      reasonCode: "managed_identity_required",
      reason: "managed_enterprise access requires a tenantId",
    };
  }
  let userId: string | undefined;
  let ownerKind: MemoryIndexAccessProvenance["ownerKind"];
  if (proof.owner.kind === "user") {
    userId = proof.owner.userId;
    ownerKind = "user";
  } else if (proof.owner.kind === "position") {
    userId = params.authenticatedUserId?.trim() || undefined;
    ownerKind = "position";
  } else if (proof.owner.kind === "group") {
    userId = params.authenticatedUserId?.trim() || undefined;
    ownerKind = "group";
  } else {
    return {
      ok: false,
      reasonCode: "managed_grant_denied",
      reason: "system-owned ownership proof cannot drive a per-user memory index",
    };
  }
  if (!hasText(userId)) {
    return {
      ok: false,
      reasonCode: "managed_membership_missing",
      reason: `${ownerKind}-owned access requires an authenticated userId (membership proof)`,
    };
  }
  const grant: MemoryIndexOwnershipGrant = { userId, role: ownerKind };
  return managedAccessContext({
    tenantId,
    userId,
    actor: { userId, tenantId, grant },
    agentAssetId: proof.agentAssetId ?? undefined,
    resourceId: params.resourceId,
    ownershipGrant: grant,
    resolveCanonicalHandle: params.resolveCanonicalHandle,
    provenance: { ...params.provenance, ownerKind },
  });
}

/** Resolved index workspace for one manager construction (managed handle or personal marker). */
export type ResolvedMemoryIndexAccess =
  | { readonly profile: "personal_local" }
  | {
      readonly profile: "managed_enterprise";
      readonly handle: MemoryWorkspaceHandle;
      readonly locator: string;
      readonly namespace: string;
      readonly tenantId: string;
      readonly resourceId: string;
    };

export type ResolveMemoryIndexAccessResult =
  | { readonly ok: true; readonly access: ResolvedMemoryIndexAccess }
  | {
      readonly ok: false;
      readonly reasonCode: MemoryIndexAccessReason;
      readonly reason: string;
      readonly canonicalReasonCode?: string;
    };

function mapDenialToAccessReason(
  reasonCode: string,
  canonicalReasonCode: string | undefined,
): MemoryIndexAccessReason {
  switch (reasonCode) {
    case "managed_requires_trusted_identity":
    case "managed_requires_canonical_resolver":
      return "managed_identity_required";
    case "managed_identity_actor_tenant_mismatch":
    case "managed_cross_tenant_handle":
      return "managed_tenant_mismatch";
    case "managed_workspace_not_indexable":
      return "managed_workspace_not_indexable";
    case "managed_resolver_denied":
      switch (canonicalReasonCode) {
        case "missing_workspace_resource":
        case "missing_memory_asset":
          return "managed_catalog_miss";
        case "ambiguous_agent_asset":
          return "managed_catalog_ambiguous";
        case "tenant_mismatch":
          return "managed_tenant_mismatch";
        case "missing_binding":
          return "managed_membership_missing";
        case "stale_fencing_token":
          return "managed_workspace_not_indexable";
        default:
          return "managed_catalog_miss";
      }
    default:
      return "managed_identity_required";
  }
}

/**
 * Resolve the index workspace for a single manager construction. personal_local
 * short-circuits (the caller uses the legacy resolveAgentWorkspaceDir compat).
 * managed_enterprise resolves an EXISTING canonical/active binding fail-closed
 * via the injected resolver; any denial returns a structured reason with NO
 * side effects (no scan/read/index-write is performed here).
 */
export async function resolveMemoryIndexAccess(
  ctx: MemoryIndexAccessContext,
  site: { agentId: string; ledgerId: Item7StageCLedgerId },
): Promise<ResolveMemoryIndexAccessResult> {
  if (ctx.securityProfile === "personal_local") {
    return { ok: true, access: { profile: "personal_local" } };
  }
  const result = await resolveMemoryIndexWorkspaceHandle({
    op: "index",
    ledgerId: site.ledgerId,
    agentId: site.agentId,
    securityProfile: "managed_enterprise",
    identity: ctx.identity,
    resolveCanonicalHandle: ctx.resolveCanonicalHandle,
  });
  if (!result.ok) {
    return {
      ok: false,
      reasonCode: mapDenialToAccessReason(result.reasonCode, result.canonicalReasonCode),
      reason: result.reason,
      canonicalReasonCode: result.canonicalReasonCode,
    };
  }
  if (result.profile !== "managed_enterprise") {
    return {
      ok: false,
      reasonCode: "managed_identity_required",
      reason: "expected a managed canonical handle",
    };
  }
  return {
    ok: true,
    access: {
      profile: "managed_enterprise",
      handle: result.handle,
      locator: result.locator,
      namespace: result.namespace,
      tenantId: result.handle.tenantId,
      resourceId: result.handle.resourceId,
    },
  };
}

/**
 * Managed index-cache key component binding tenantId + resourceId + profile so a
 * same-named agent in a different tenant can never share an index instance, and
 * a resourceId change never reuses a stale instance. personal_local returns a
 * stable marker that never collides with a managed namespace.
 */
export function memoryIndexAccessCacheComponent(
  access: ResolvedMemoryIndexAccess | undefined,
): string {
  if (!access || access.profile === "personal_local") {
    return "personal_local";
  }
  return `managed:${access.tenantId}:${access.resourceId}`;
}

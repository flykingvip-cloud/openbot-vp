/**
 * Item 7 Stage C (op=index) — controlled narrow interface for the five memory
 * index workspace-locator call sites (ledger S30/S31/S32/S36/S37):
 *   C1 = S30  src/memory/backend-config.ts:417   (resolveMemoryBackendConfig, cogniweave branch)
 *   C2 = S31  src/memory/backend-config.ts:444   (resolveMemoryBackendConfig, qmd branch)
 *   C3 = S32  src/memory/cogniweave-manager.ts:554 (CogniWeaveMemoryManager constructor)
 *   C4 = S36  src/memory/manager.ts:152          (MemoryIndexManager.get cache factory)
 *   C5 = S37  src/memory/qmd-manager.ts:196       (QmdMemoryManager constructor)
 *
 * Responsibility (Stage C §五): this interface AUTHORIZES an index workspace and
 * returns a RESTRICTED locator/handle only. It NEVER:
 *   - creates directories,
 *   - writes the Data Governance Catalog,
 *   - enables schema v2 or LIVE,
 *   - falls back to `resolveAgentWorkspaceDir`, a cfg-only resolver, `process.cwd()`,
 *     an empty string, a default workspace, a guessed host path, or
 *     `createEmptyWorkspaceCatalog`.
 *
 * Trust model split (§五, §七):
 *   - personal_local     → an EXPLICIT, security-profile-gated legacy-compat locator.
 *                          Reachable ONLY when the SERVER-resolved security profile is
 *                          `personal_local`. It is never used as a `managed_enterprise`
 *                          fallback (that is the whole point of the discriminated union).
 *   - managed_enterprise → requires server-trusted identity (tenantId, userId, actor,
 *                          and the ownership-bound agentAssetId/resourceId the canonical
 *                          resolver checks) and resolves an EXISTING canonical/active
 *                          binding through the canonical Resource Resolver
 *                          (`resolveMemoryWorkspaceHandle`). To keep the memory layer free
 *                          of a gateway import, the canonical resolver is INJECTED as a
 *                          port. Any missing / ambiguous / cross-tenant / grant-mismatch /
 *                          catalog-miss / tombstoned / revoked input FAILS CLOSED with no
 *                          host fallback.
 *
 * Stage C does NOT switch the five production call sites: the shadow module
 * `item7-w5-index-last.ts` decides `keep-legacy-index` and those sites lack a trusted
 * request-level identity as they stand today (they are background/config-time/constructor
 * sites reachable from a `cfg`+`agentId`-only path). This module is the honest
 * authorization boundary proposed by the Stage C Semantic Gate CR; wiring it into
 * production requires threading call-entry identity to those sites, which is out of Stage C
 * scope and documented in the CR. Nothing here writes production state.
 */

import {
  isMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
  type MemoryWorkspaceLifecycle,
  type MemoryWorkspaceResolveResult,
} from "./memory-workspace-handle.js";

/** The five Stage C op=index ledger ids (C1..C5). S33/S34/S35 are Stage D (sync). */
export const ITEM7_STAGE_C_LEDGER_IDS = ["S30", "S31", "S32", "S36", "S37"] as const;
export type Item7StageCLedgerId = (typeof ITEM7_STAGE_C_LEDGER_IDS)[number];

/** Server-resolved security profile (never influenced by client RPC parameters). */
export type MemoryIndexSecurityProfile = "personal_local" | "managed_enterprise";

/**
 * Lifecycles for which an index may be located/read. A tombstoned/revoked/mid-move
 * workspace (`retired` | `purged` | `moving` | `recovery_required`) must NOT start or
 * continue an index (§六).
 */
const INDEXABLE_LIFECYCLES: ReadonlySet<MemoryWorkspaceLifecycle> =
  new Set<MemoryWorkspaceLifecycle>(["active", "read_only"]);

/** Opaque ownership grant; validated by the canonical resolver, not by this interface. */
export type MemoryIndexOwnershipGrant = {
  readonly grantId?: string;
  readonly role?: string;
  readonly userId?: string;
};

/** Server-trusted actor. `tenantId` must equal the identity `tenantId`. */
export type MemoryIndexActor = {
  readonly userId: string;
  readonly tenantId: string;
  readonly grant?: MemoryIndexOwnershipGrant;
};

/** Server-trusted identity required for a `managed_enterprise` index resolve. */
export type MemoryIndexTrustedIdentity = {
  readonly tenantId: string;
  readonly userId: string;
  readonly actor: MemoryIndexActor;
  readonly resourceId?: string;
  readonly agentAssetId?: string;
  readonly expectedFencingToken?: string;
  readonly configuredCloudTenantId?: string | null;
};

/**
 * The canonical Resource Resolver, injected so the memory layer never statically imports
 * the gateway. In production wiring (out of Stage C scope) this is
 * `resolveMemoryWorkspaceHandle` from `src/gateway/workspace-resolver/memory-workspace-resolve.ts`.
 */
export type CanonicalMemoryWorkspaceResolver = (params: {
  tenantId: string;
  userId: string;
  agentId: string;
  actor: MemoryIndexActor;
  resourceId?: string;
  expectedFencingToken?: string;
  configuredCloudTenantId?: string | null;
}) => Promise<MemoryWorkspaceResolveResult>;

export type ResolveMemoryIndexWorkspaceHandleParams = {
  /** Stage C is op=index only; the guard rejects anything else. */
  readonly op: "index";
  readonly ledgerId: Item7StageCLedgerId;
  readonly agentId: string;
  /** Server-resolved (`resolveSecurityProfile`); MUST NOT be derived from client RPC input. */
  readonly securityProfile: MemoryIndexSecurityProfile;
  /** Present only for `managed_enterprise`. A `personal_local` caller must not smuggle it in. */
  readonly identity?: MemoryIndexTrustedIdentity | null;
  /**
   * Explicit `personal_local` compatibility locator (the legacy workspace dir). Supplied by
   * the caller ONLY for `personal_local`; it is the security-profile-gated compat path and is
   * never consulted on the `managed_enterprise` branch.
   */
  readonly personalLocalCompatLocator?: () => string;
  /** Canonical resolver port; required for `managed_enterprise`. */
  readonly resolveCanonicalHandle?: CanonicalMemoryWorkspaceResolver;
};

export type MemoryIndexWorkspaceDenialCode =
  | "op_not_index"
  | "unknown_stage_c_site"
  | "personal_local_compat_locator_missing"
  | "personal_local_compat_locator_empty"
  | "managed_requires_trusted_identity"
  | "managed_identity_actor_tenant_mismatch"
  | "managed_requires_canonical_resolver"
  | "managed_resolver_denied"
  | "managed_cross_tenant_handle"
  | "managed_forbidden_host_fallback"
  | "managed_workspace_not_indexable";

export type ResolveMemoryIndexWorkspaceHandleResult =
  | {
      readonly ok: true;
      readonly profile: "personal_local";
      readonly mode: "legacy-compat";
      readonly ledgerId: Item7StageCLedgerId;
      readonly locator: string;
      readonly namespace: string;
      readonly handle: null;
    }
  | {
      readonly ok: true;
      readonly profile: "managed_enterprise";
      readonly mode: "canonical-handle";
      readonly ledgerId: Item7StageCLedgerId;
      readonly locator: string;
      readonly namespace: string;
      readonly handle: MemoryWorkspaceHandle;
    }
  | {
      readonly ok: false;
      readonly profile: MemoryIndexSecurityProfile;
      readonly ledgerId: Item7StageCLedgerId | null;
      readonly reasonCode: MemoryIndexWorkspaceDenialCode;
      readonly reason: string;
      /** The upstream canonical denial code when `reasonCode === "managed_resolver_denied"`. */
      readonly canonicalReasonCode?: string;
    };

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function deny(
  profile: MemoryIndexSecurityProfile,
  ledgerId: Item7StageCLedgerId | null,
  reasonCode: MemoryIndexWorkspaceDenialCode,
  reason: string,
  canonicalReasonCode?: string,
): ResolveMemoryIndexWorkspaceHandleResult {
  return { ok: false, profile, ledgerId, reasonCode, reason, canonicalReasonCode };
}

function isStageCLedgerId(value: string): value is Item7StageCLedgerId {
  return (ITEM7_STAGE_C_LEDGER_IDS as readonly string[]).includes(value);
}

/**
 * Index namespace for a managed handle. Binds `tenantId` + workspace `resourceId` so a
 * same-named agent in a different tenant can NEVER share an index root (§六). The
 * `canonicalObjectKey` is the object-store locator, not a guessable host path.
 */
export function deriveManagedMemoryIndexNamespace(handle: MemoryWorkspaceHandle): string {
  if (!isMemoryWorkspaceHandle(handle)) {
    throw new Error("index namespace can only be derived from a branded MemoryWorkspaceHandle");
  }
  return `managed:${handle.tenantId}:${handle.resourceId}`;
}

/**
 * Authorize an index workspace for one of the five Stage C op=index sites and return a
 * restricted locator/handle. Fail-closed; never creates directories or writes the Catalog.
 */
export async function resolveMemoryIndexWorkspaceHandle(
  params: ResolveMemoryIndexWorkspaceHandleParams,
): Promise<ResolveMemoryIndexWorkspaceHandleResult> {
  // Guard: Stage C only authorizes op=index.
  if (params.op !== "index") {
    return deny(
      params.securityProfile,
      null,
      "op_not_index",
      "Stage C resolver authorizes op=index only",
    );
  }
  if (!hasText(params.ledgerId) || !isStageCLedgerId(params.ledgerId)) {
    return deny(
      params.securityProfile,
      null,
      "unknown_stage_c_site",
      `ledgerId "${String(params.ledgerId)}" is not a Stage C index site (expected one of ${ITEM7_STAGE_C_LEDGER_IDS.join(", ")})`,
    );
  }
  const ledgerId = params.ledgerId;

  if (params.securityProfile === "personal_local") {
    // Explicit, profile-gated legacy compatibility path. No dir creation, no Catalog write.
    // This branch is unreachable for managed_enterprise, so it can never be a managed fallback.
    if (typeof params.personalLocalCompatLocator !== "function") {
      return deny(
        "personal_local",
        ledgerId,
        "personal_local_compat_locator_missing",
        "personal_local index resolve requires an explicit security-profile-gated compat locator provider",
      );
    }
    const locator = params.personalLocalCompatLocator();
    if (!hasText(locator)) {
      return deny(
        "personal_local",
        ledgerId,
        "personal_local_compat_locator_empty",
        "personal_local compat locator must return a non-empty path (empty/default workspace is forbidden)",
      );
    }
    return {
      ok: true,
      profile: "personal_local",
      mode: "legacy-compat",
      ledgerId,
      locator,
      namespace: `personal_local:${params.agentId}`,
      handle: null,
    };
  }

  // managed_enterprise: strict fail-closed. Never falls back to personal_local/legacy/host.
  const identity = params.identity;
  if (
    !identity ||
    !hasText(identity.tenantId) ||
    !hasText(identity.userId) ||
    !identity.actor ||
    !hasText(identity.actor.userId) ||
    !hasText(identity.actor.tenantId)
  ) {
    return deny(
      "managed_enterprise",
      ledgerId,
      "managed_requires_trusted_identity",
      "managed_enterprise index resolve requires server-trusted tenantId + userId + actor; agentId slug is not proof of ownership",
    );
  }
  if (identity.actor.tenantId !== identity.tenantId) {
    return deny(
      "managed_enterprise",
      ledgerId,
      "managed_identity_actor_tenant_mismatch",
      "actor.tenantId must equal the trusted identity tenantId (cross-tenant actor is forbidden)",
    );
  }
  if (typeof params.resolveCanonicalHandle !== "function") {
    return deny(
      "managed_enterprise",
      ledgerId,
      "managed_requires_canonical_resolver",
      "managed_enterprise index resolve requires the canonical Resource Resolver port (resolveMemoryWorkspaceHandle)",
    );
  }

  const resolved = await params.resolveCanonicalHandle({
    tenantId: identity.tenantId,
    userId: identity.userId,
    agentId: params.agentId,
    actor: identity.actor,
    resourceId: identity.resourceId,
    expectedFencingToken: identity.expectedFencingToken,
    configuredCloudTenantId: identity.configuredCloudTenantId,
  });
  if (!resolved.ok) {
    // Propagate the canonical denial verbatim. Catalog miss / ambiguous / cross-tenant /
    // grant mismatch / missing binding / stale fencing token all land here — no host fallback.
    return deny(
      "managed_enterprise",
      ledgerId,
      "managed_resolver_denied",
      `canonical resolver denied the index workspace: ${resolved.reason}`,
      resolved.reasonCode,
    );
  }

  const handle = resolved.handle;
  // Defense in depth: only a branded handle is acceptable (spread/cast cannot forge one).
  if (!isMemoryWorkspaceHandle(handle)) {
    return deny(
      "managed_enterprise",
      ledgerId,
      "managed_forbidden_host_fallback",
      "canonical resolver returned a non-branded handle; refuse to derive an index root",
    );
  }
  // Tenant binding must match the trusted identity: index existence is never authorization.
  if (handle.tenantId !== identity.tenantId) {
    return deny(
      "managed_enterprise",
      ledgerId,
      "managed_cross_tenant_handle",
      "resolved handle tenantId does not match the trusted identity tenantId",
    );
  }
  // Tombstone/revoke gate: a retired/purged/moving/recovery workspace must not start an index.
  if (!INDEXABLE_LIFECYCLES.has(handle.lifecycle)) {
    return deny(
      "managed_enterprise",
      ledgerId,
      "managed_workspace_not_indexable",
      `workspace lifecycle="${handle.lifecycle}" must not start or continue an index (tombstone/revoke halts)`,
    );
  }

  return {
    ok: true,
    profile: "managed_enterprise",
    mode: "canonical-handle",
    ledgerId,
    locator: handle.canonicalObjectKey,
    namespace: deriveManagedMemoryIndexNamespace(handle),
    handle,
  };
}

export type GuardedMemoryIndexStartContext = {
  readonly ledgerId: Item7StageCLedgerId;
  readonly locator: string;
  readonly namespace: string;
  readonly handle: MemoryWorkspaceHandle | null;
};

export type GuardedMemoryIndexStartResult<T> =
  | {
      readonly started: true;
      readonly ledgerId: Item7StageCLedgerId;
      readonly locator: string;
      readonly namespace: string;
      readonly result: T;
    }
  | {
      readonly started: false;
      readonly reasonCode: MemoryIndexWorkspaceDenialCode;
      readonly reason: string;
      readonly canonicalReasonCode?: string;
    };

/**
 * Fail-closed index-start guard. Resolves the workspace first; only if authorization
 * succeeds does it invoke `startIndex`. On any denial it returns WITHOUT calling
 * `startIndex`, guaranteeing zero scan / read / index-write on the rejected path (§六/§七).
 * A re-resolve that now returns a tombstoned/revoked handle likewise halts (running task
 * quarantine), because the resolve step re-checks lifecycle every call.
 */
export async function guardedMemoryIndexStart<T>(params: {
  resolve: () => Promise<ResolveMemoryIndexWorkspaceHandleResult>;
  startIndex: (ctx: GuardedMemoryIndexStartContext) => Promise<T> | T;
}): Promise<GuardedMemoryIndexStartResult<T>> {
  const resolved = await params.resolve();
  if (!resolved.ok) {
    return {
      started: false,
      reasonCode: resolved.reasonCode,
      reason: resolved.reason,
      canonicalReasonCode: resolved.canonicalReasonCode,
    };
  }
  const result = await params.startIndex({
    ledgerId: resolved.ledgerId,
    locator: resolved.locator,
    namespace: resolved.namespace,
    handle: resolved.profile === "managed_enterprise" ? resolved.handle : null,
  });
  return {
    started: true,
    ledgerId: resolved.ledgerId,
    locator: resolved.locator,
    namespace: resolved.namespace,
    result,
  };
}

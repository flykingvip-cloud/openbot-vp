/**
 * Item 7 Stage C C1–C5 Memory Index Cutover PREP (not a production switch).
 *
 * Reuses the landed Stage C SHADOW (`item7-stage-c-identity-shadow.ts`) and the
 * narrow index-authorization interface (`resolveMemoryIndexWorkspaceHandle` /
 * `resolveMemoryIndexAccess`). This module:
 *   - records the C1–C5 call-chain + trusted-identity source matrix,
 *   - documents the managed_enterprise switch plan (canonical Handle),
 *   - documents the personal_local compatibility plan (legacy locator retained),
 *   - derives the planned tenant/resource/epoch cache-isolation key,
 *   - classifies fail-closed batch cases used by the prep tests.
 *
 * It NEVER:
 *   - switches C1–C5 production call sites (they stay on resolveAgentWorkspaceDir),
 *   - writes the Catalog, creates directories, or removes the legacy locator,
 *   - wires src/agents/tools/memory-tool.ts,
 *   - mutates the canonical retirement scan,
 *   - lowers remaining / liveWriteWatchIndex,
 *   - sets implementationVerified, deployAuthorized, LIVE, Item 7 met, or Phase 1B.
 *
 * Production cutover is independently rollbackable and is NOT executed here.
 */

import type { MemoryIndexAccessReason } from "../memory/memory-index-access-context.js";
import {
  ITEM7_STAGE_C_LEDGER_IDS,
  type Item7StageCLedgerId,
} from "../memory/memory-index-workspace-handle.js";
import type { StageCIdentityShadowOutcome } from "./item7-stage-c-identity-shadow.js";

export const C1_C5_CUTOVER_PREP_SCHEMA = "memory-workspace-c1-c5-cutover-prep/v1" as const;

/** Literal locks: this PREP cannot express a production switch. */
export const C1_C5_CUTOVER_LOCKS = Object.freeze({
  remaining: 10 as const,
  liveWriteWatchIndex: 10 as const,
  frozenWriteWatchIndex: 38 as const,
  retiredThisChange: 0 as const,
  implementationVerified: false as const,
  deployAuthorized: false as const,
  live: "forbidden" as const,
  item7: "not-met" as const,
  productionSwitch: false as const,
  scanModified: false as const,
  phase1bExecutionBlocked: true as const,
  i3Executed: false as const,
});

export type C1C5Label = "C1" | "C2" | "C3" | "C4" | "C5";

export type C1C5Site = {
  readonly label: C1C5Label;
  readonly ledgerId: Item7StageCLedgerId;
  readonly file: string;
  readonly line: number;
  readonly op: "index";
  readonly symbol: "resolveAgentWorkspaceDir";
  readonly enclosing: string;
  readonly callers: readonly string[];
  readonly identityAtCallSite: readonly string[];
  readonly identityMissing: readonly string[];
  readonly trustedIdentityAtCallSite: false;
  readonly productionSwitch: false;
  readonly staysLegacy: true;
};

/**
 * Call-chain + trusted identity source matrix for the five watched index sites.
 * Line numbers are pinned to origin/main e6dd9c61bc (verified on this SHA).
 */
export const C1_C5_SITES: readonly C1C5Site[] = Object.freeze([
  Object.freeze({
    label: "C1" as const,
    ledgerId: "S30" as const,
    file: "src/memory/backend-config.ts",
    line: 417,
    op: "index" as const,
    symbol: "resolveAgentWorkspaceDir" as const,
    enclosing: "resolveMemoryBackendConfig (cogniweave branch)",
    callers: [
      "getMemorySearchManager (search-manager.ts) — still calls resolveMemoryBackendConfig even on the managed handle path",
      "getMemorySearchManagerFromHandle — still resolves collections via C1",
      "startGatewayMemoryBackend (server-startup-memory.ts) — background loop, cfg+agentId only",
    ],
    identityAtCallSite: ["cfg", "agentId"],
    identityMissing: [
      "tenantContext",
      "tenantId",
      "userId",
      "actor",
      "ownershipGrant",
      "resourceId",
      "agentAssetId",
      "Catalog",
      "membershipSoT",
      "fencingToken",
    ],
    trustedIdentityAtCallSite: false as const,
    productionSwitch: false as const,
    staysLegacy: true as const,
  }),
  Object.freeze({
    label: "C2" as const,
    ledgerId: "S31" as const,
    file: "src/memory/backend-config.ts",
    line: 444,
    op: "index" as const,
    symbol: "resolveAgentWorkspaceDir" as const,
    enclosing: "resolveMemoryBackendConfig (qmd branch)",
    callers: [
      "getMemorySearchManager — qmd collections assembled from the legacy workspaceDir",
      "startGatewayMemoryBackend — background qmd arming, cfg+agentId only",
    ],
    identityAtCallSite: ["cfg", "agentId"],
    identityMissing: [
      "tenantContext",
      "tenantId",
      "userId",
      "actor",
      "ownershipGrant",
      "resourceId",
      "agentAssetId",
      "Catalog",
      "membershipSoT",
      "fencingToken",
    ],
    trustedIdentityAtCallSite: false as const,
    productionSwitch: false as const,
    staysLegacy: true as const,
  }),
  Object.freeze({
    label: "C3" as const,
    ledgerId: "S32" as const,
    file: "src/memory/cogniweave-manager.ts",
    line: 554,
    op: "index" as const,
    symbol: "resolveAgentWorkspaceDir" as const,
    enclosing: "CogniWeaveMemoryManager private constructor",
    callers: [
      "CogniWeaveMemoryManager.create (personal/legacy)",
      "CogniWeaveMemoryManager.createFromHandle (managed) — STILL hits line 554; handle is stored but workspaceDir is still the legacy locator",
      "getMemorySearchManager managed path — createFromHandle after resolveMemoryIndexAccess(S32)",
    ],
    identityAtCallSite: ["cfg", "agentId", "optional governance{tenantId,ownershipProof}"],
    identityMissing: ["userId", "actor", "resourceId", "Catalog", "membershipSoT", "fencingToken"],
    trustedIdentityAtCallSite: false as const,
    productionSwitch: false as const,
    staysLegacy: true as const,
  }),
  Object.freeze({
    label: "C4" as const,
    ledgerId: "S36" as const,
    file: "src/memory/manager.ts",
    line: 152,
    op: "index" as const,
    symbol: "resolveAgentWorkspaceDir" as const,
    enclosing: "MemoryIndexManager.get (static cache factory)",
    callers: [
      "getMemorySearchManager builtin fallback",
      "QmdMemoryManager fallbackFactory → MemoryIndexManager.get",
    ],
    identityAtCallSite: ["cfg", "agentId", "purpose?"],
    identityMissing: [
      "tenantContext",
      "tenantId",
      "userId",
      "actor",
      "resourceId",
      "Catalog",
      "fencingToken",
      "governanceEpoch",
    ],
    trustedIdentityAtCallSite: false as const,
    productionSwitch: false as const,
    staysLegacy: true as const,
  }),
  Object.freeze({
    label: "C5" as const,
    ledgerId: "S37" as const,
    file: "src/memory/qmd-manager.ts",
    line: 196,
    op: "index" as const,
    symbol: "resolveAgentWorkspaceDir" as const,
    enclosing: "QmdMemoryManager private constructor",
    callers: [
      "QmdMemoryManager.create ← getMemorySearchManager qmd branch (no accessContext threaded)",
    ],
    identityAtCallSite: ["cfg", "agentId", "resolved"],
    identityMissing: [
      "tenantContext",
      "tenantId",
      "userId",
      "actor",
      "resourceId",
      "Catalog",
      "fencingToken",
    ],
    trustedIdentityAtCallSite: false as const,
    productionSwitch: false as const,
    staysLegacy: true as const,
  }),
]);

export function siteByLedgerId(ledgerId: Item7StageCLedgerId): C1C5Site {
  const site = C1_C5_SITES.find((entry) => entry.ledgerId === ledgerId);
  if (!site) {
    throw new Error(`not a C1–C5 ledgerId: ${ledgerId}`);
  }
  return site;
}

export const C1_C5_LEDGER_IDS: readonly Item7StageCLedgerId[] = ITEM7_STAGE_C_LEDGER_IDS;

/** managed_enterprise switch plan — PLAN ONLY; not executed. */
export const MANAGED_ENTERPRISE_SWITCH_PLAN = Object.freeze({
  profile: "managed_enterprise" as const,
  locatorSource: "canonical MemoryWorkspaceHandle via resolveMemoryWorkspaceHandle (injected port)",
  identitySource:
    "server-built MemorySearchGovernance (ownershipProof + tenantId) + authenticatedUserId for seat/group; never wire-derived tenantId/userId/resourceId",
  authorization: "resolveMemoryIndexAccess → resolveMemoryIndexWorkspaceHandle (fail-closed)",
  reuse: [
    "src/gateway/item7-stage-c-identity-shadow.ts (SHADOW, remains shadow — not flipped to production)",
    "src/memory/memory-index-workspace-handle.ts",
    "src/memory/memory-index-access-context.ts",
    "CogniWeaveMemoryManager.createFromHandle (already bound to Handle; still hits C3 constructor)",
  ],
  perSite: Object.freeze({
    C1: "resolveMemoryBackendConfig accepts MemoryIndexAccessContext; managed collections resolve from handle.canonicalObjectKey / namespace, never resolveAgentWorkspaceDir",
    C2: "same as C1 for the qmd branch; managed qmd collections are tenant/resource scoped or fail-closed (today managed non-cogniweave is already fail-closed at getMemorySearchManager)",
    C3: "constructor uses Handle locator/namespace when workspaceIdentity is a branded Handle; drop the unconditional resolveAgentWorkspaceDir at line 554",
    C4: "MemoryIndexManager.get cache key becomes plannedManagedIndexCacheIsolationKey (tenant+resource+epoch+fencing); workspaceDir from Handle, never host fallback",
    C5: "QmdMemoryManager constructor takes access context; managed fails closed until qmd roots are Handle-scoped (same as today's dispatch fail-closed for non-cogniweave)",
  }),
  forbiddenFallbacks: Object.freeze([
    "resolveAgentWorkspaceDir",
    "cfg-only resolver",
    "process.cwd",
    "empty-string / default workspace",
    "guessed host path",
    "createEmptyWorkspaceCatalog",
    "personal_local compat locator",
  ]),
  productionSwitch: false as const,
});

/** personal_local compatibility plan — keep today's legacy behavior. */
export const PERSONAL_LOCAL_COMPAT_PLAN = Object.freeze({
  profile: "personal_local" as const,
  mode: "legacy-compat" as const,
  locatorSource: "explicit security-profile-gated resolveAgentWorkspaceDir (today's C1–C5 path)",
  reachableOnlyWhen: "server-resolved securityProfile === personal_local",
  neverManagedFallback: true as const,
  behaviorPreserved:
    "cfg+agentId workspace dir, existing INDEX_CACHE / QMD / CogniWeave personal create() path, startGatewayMemoryBackend personal arming",
  productionSwitch: false as const,
});

/**
 * Planned C4/C1–C5 managed cache isolation key. Binds tenant + resource + fencing
 * epoch so a same-named agent in another tenant, a resource rebind, or a stale
 * fencing token can NEVER reuse an index instance. Not wired into manager.ts.
 */
export function plannedManagedIndexCacheIsolationKey(input: {
  tenantId: string;
  resourceId: string;
  fencingToken: string;
  governanceEpoch: string | number;
  agentId: string;
}): string {
  return `managed:${input.tenantId}:${input.resourceId}:epoch:${String(input.governanceEpoch)}:fence:${input.fencingToken}:${input.agentId}`;
}

export function plannedPersonalLocalCacheIsolationKey(agentId: string): string {
  return `personal_local:${agentId}`;
}

export type C1C5BatchCase =
  | "catalog_miss"
  | "tenant_mismatch"
  | "ownership_mismatch"
  | "membership_grant_missing"
  | "stale_epoch_fencing"
  | "workspace_not_indexable"
  | "background_identity_defer"
  | "personal_local_regression";

export type C1C5BatchExpectation = {
  readonly caseId: C1C5BatchCase;
  readonly shadowOutcome: StageCIdentityShadowOutcome;
  readonly reasonCode?: MemoryIndexAccessReason;
  readonly productionWrite: false;
};

/** Shared foundation: one expectation table applied independently to every C1–C5 site. */
export const C1_C5_BATCH_EXPECTATIONS: readonly C1C5BatchExpectation[] = Object.freeze([
  Object.freeze({
    caseId: "catalog_miss" as const,
    shadowOutcome: "managed_deny" as const,
    reasonCode: "managed_catalog_miss" as const,
    productionWrite: false as const,
  }),
  Object.freeze({
    caseId: "tenant_mismatch" as const,
    shadowOutcome: "managed_deny" as const,
    reasonCode: "managed_tenant_mismatch" as const,
    productionWrite: false as const,
  }),
  Object.freeze({
    caseId: "ownership_mismatch" as const,
    shadowOutcome: "managed_deny" as const,
    reasonCode: "managed_grant_denied" as const,
    productionWrite: false as const,
  }),
  Object.freeze({
    caseId: "membership_grant_missing" as const,
    shadowOutcome: "managed_defer" as const,
    reasonCode: "managed_membership_missing" as const,
    productionWrite: false as const,
  }),
  Object.freeze({
    caseId: "stale_epoch_fencing" as const,
    shadowOutcome: "managed_deny" as const,
    reasonCode: "managed_workspace_not_indexable" as const,
    productionWrite: false as const,
  }),
  Object.freeze({
    caseId: "workspace_not_indexable" as const,
    shadowOutcome: "managed_deny" as const,
    reasonCode: "managed_workspace_not_indexable" as const,
    productionWrite: false as const,
  }),
  Object.freeze({
    caseId: "background_identity_defer" as const,
    shadowOutcome: "managed_defer" as const,
    reasonCode: "managed_identity_required" as const,
    productionWrite: false as const,
  }),
  Object.freeze({
    caseId: "personal_local_regression" as const,
    shadowOutcome: "managed_success" as const,
    productionWrite: false as const,
  }),
]);

export function classifyBackgroundIdentityDefer(params: {
  hasServerBuiltGovernance: boolean;
  provenanceSource?: "call-entry" | "background" | "test";
}): MemoryIndexAccessReason {
  if (!params.hasServerBuiltGovernance) {
    return params.provenanceSource === "background"
      ? "managed_background_deferred"
      : "managed_identity_required";
  }
  return "managed_identity_required";
}

/** Per-site cutover / rollback / retirement checklist. None of these steps run in this PREP. */
export const C1_C5_PER_SITE_CHECKLIST = Object.freeze(
  C1_C5_SITES.map((site) =>
    Object.freeze({
      label: site.label,
      ledgerId: site.ledgerId,
      file: site.file,
      line: site.line,
      cutover: Object.freeze([
        "thread server-built MemoryIndexAccessContext to the enclosing function",
        "managed: resolveMemoryIndexAccess fail-closed; use Handle locator/namespace",
        "personal_local: keep explicit resolveAgentWorkspaceDir compat locator",
        "isolate cache by tenant+resource+epoch+fencing (C4 especially)",
        "do not write Catalog; do not mint bindings on the hot path",
      ]),
      rollback: Object.freeze([
        "revert the site CR; restore resolveAgentWorkspaceDir at this line",
        "leave the canonical retirement scan unchanged until the site is accepted",
        "SHADOW evaluator stays in place (independently rollbackable from the cutover)",
      ]),
      retirement: Object.freeze([
        "only after managed+personal_local production-equivalent tests pass at this site",
        "then drop the watched P1 call and update the CODEOWNERS-pinned freeze baseline",
        "draft expected scan change is recorded in evidence; the canonical scan is NOT modified by this PREP",
      ]),
      executed: false as const,
    }),
  ),
);

/**
 * DRAFT expected retirement-scan change IF a future authorized cutover retired all
 * five C1–C5 sites. MUST NOT be applied to the canonical scan in this PREP.
 */
export const RETIREMENT_SCAN_EXPECTED_CHANGE_DRAFT = Object.freeze({
  status: "draft-only" as const,
  canonicalScanPath: "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
  canonicalScanModified: false as const,
  applyForbidden: true as const,
  currentRemaining: 10 as const,
  currentLiveWriteWatchIndex: 10 as const,
  projectedIfC1C5Retired: Object.freeze({
    remaining: 5 as const,
    liveWriteWatchIndex: 5 as const,
    note: "math projection 10-5; leaves S01/S02 (personal-local residual) + S33/S34/S35 (Stage D). NOT a new accepted baseline.",
    sitesRemoved: Object.freeze([
      "src/memory/backend-config.ts:417",
      "src/memory/backend-config.ts:444",
      "src/memory/cogniweave-manager.ts:554",
      "src/memory/manager.ts:152",
      "src/memory/qmd-manager.ts:196",
    ]),
    sitesRemaining: Object.freeze([
      "src/auto-reply/reply/get-reply.ts:164",
      "src/auto-reply/reply/get-reply.ts:165",
      "src/memory/manager-sync-ops.ts:1062",
      "src/memory/manager-sync-ops.ts:1252",
      "src/memory/manager-sync-ops.ts:1343",
    ]),
  }),
});

/** Hard-false: this PREP cannot authorize or execute a production cutover. */
export function isC1C5ProductionCutoverAuthorized(): false {
  return false;
}

export function assertC1C5PrepLocks(): typeof C1_C5_CUTOVER_LOCKS {
  return C1_C5_CUTOVER_LOCKS;
}

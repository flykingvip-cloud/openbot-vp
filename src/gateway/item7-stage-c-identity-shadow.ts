import type { OpenBotConfig } from "../config/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  deriveManagedAccessContextFromGovernance,
  type MemoryIndexAccessReason,
  resolveMemoryIndexAccess,
} from "../memory/memory-index-access-context.js";
import type {
  CanonicalMemoryWorkspaceResolver,
  Item7StageCLedgerId,
} from "../memory/memory-index-workspace-handle.js";
import type { MemorySearchGovernance } from "../memory/memory-search-governance.js";
import { resolveMemoryWorkspaceHandle } from "./workspace-resolver/memory-workspace-resolve.js";

/**
 * Item 7 Stage C — production identity wiring SHADOW (Phase C preparation).
 *
 * At a trusted entrypoint (where a server-built MemorySearchGovernance is available), this
 * evaluates whether the managed_enterprise canonical-handle path (Stage C, #709) WOULD resolve
 * for the current request, and records a metric (success / deny / defer). It is SHADOW ONLY:
 *   - it never builds/switches the production memory manager,
 *   - it never creates directories, writes the Catalog, or removes the legacy locator,
 *   - it only READS an existing canonical binding via the injected canonical resolver
 *     (`resolveMemoryWorkspaceHandle`), which is the replacement (not a frozen legacy resolver
 *     and not a Catalog-synthesis symbol) — so it adds no Phase 0 watched call site.
 *
 * The C1..C5 index sites (backend-config / cogniweave-manager / manager / qmd-manager) stay on
 * the legacy path and remain in the retirement scan; switching them (threading identity into
 * those constructor/config-time sites) is the Phase E cutover, not this shadow.
 */

const STAGE_C_IDENTITY_SHADOW_ENV = [
  "OPENBOT_ITEM7_STAGE_C_IDENTITY_SHADOW",
  "OPENCLAW_ITEM7_STAGE_C_IDENTITY_SHADOW",
] as const;

const log = createSubsystemLogger("item7-stage-c-identity-shadow");

/** Default evaluation site: S32 = the CogniWeave manager construction (Stage C C3). */
const DEFAULT_STAGE_C_LEDGER_ID: Item7StageCLedgerId = "S32";

/**
 * Deny reasons that mean "no trusted request identity is threaded here yet" -> defer, not a
 * coverage gap. managed_membership_missing means a seat/group-owned governance lacked an acting
 * user (authenticatedUserId not threaded), which is a not-yet-wired condition, not a security deny.
 */
const DEFER_REASONS: ReadonlySet<MemoryIndexAccessReason> = new Set<MemoryIndexAccessReason>([
  "managed_identity_required",
  "managed_background_deferred",
  "managed_membership_missing",
]);

export type StageCIdentityShadowOutcome = "managed_success" | "managed_deny" | "managed_defer";

export type StageCIdentityShadowResult = {
  enabled: true;
  ledgerId: Item7StageCLedgerId;
  agentId: string;
  outcome: StageCIdentityShadowOutcome;
  reasonCode?: MemoryIndexAccessReason;
  canonicalReasonCode?: string;
  /** Managed canonical locator when resolved (shadow only; never used to place/write). */
  managedLocator: string | null;
  /** Optional caller-supplied legacy locator for a presence-mismatch metric (not computed here). */
  legacyLocator: string | null;
  /** True when the managed resolve presence differs from the supplied legacy locator presence. */
  mismatch: boolean;
};

export function isStageCIdentityShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  for (const key of STAGE_C_IDENTITY_SHADOW_ENV) {
    const raw = env[key];
    if (typeof raw === "string") {
      const normalized = raw.trim().toLowerCase();
      if (normalized === "1" || normalized === "true" || normalized === "yes") {
        return true;
      }
    }
  }
  return false;
}

/** Adapt the gateway canonical resolver to the injected port shape (memory layer never imports gateway). */
export function buildStageCCanonicalHandlePort(
  cfg: OpenBotConfig | undefined,
  stateDir: string | undefined,
): CanonicalMemoryWorkspaceResolver {
  return (p) =>
    resolveMemoryWorkspaceHandle({
      tenantId: p.tenantId,
      userId: p.userId,
      agentId: p.agentId,
      actor: { tenantId: p.actor.tenantId, userId: p.actor.userId },
      resourceId: p.resourceId,
      expectedFencingToken: p.expectedFencingToken,
      configuredCloudTenantId: p.configuredCloudTenantId,
      stateDir,
      cfg,
    });
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Evaluate the managed canonical-handle path for the current governance in SHADOW (read-only).
 * Returns a structured outcome; performs no manager build, no dir/catalog write, no host fallback.
 */
export async function evaluateStageCManagedIdentityShadow(params: {
  governance: MemorySearchGovernance;
  agentId: string;
  cfg?: OpenBotConfig;
  ledgerId?: Item7StageCLedgerId;
  legacyLocator?: string | null;
  /** Acting user for seat/group-owned governance (membership proof); server-trusted, never wire. */
  authenticatedUserId?: string | null;
  /** Test seam: override the canonical resolver port. */
  resolveCanonicalHandle?: CanonicalMemoryWorkspaceResolver;
}): Promise<StageCIdentityShadowResult> {
  const ledgerId = params.ledgerId ?? DEFAULT_STAGE_C_LEDGER_ID;
  const legacyLocator = params.legacyLocator ?? null;
  const port =
    params.resolveCanonicalHandle ??
    buildStageCCanonicalHandlePort(params.cfg, params.governance.stateDir);

  const base = {
    enabled: true as const,
    ledgerId,
    agentId: params.agentId,
    legacyLocator,
  };

  const built = deriveManagedAccessContextFromGovernance({
    governance: params.governance,
    authenticatedUserId: params.authenticatedUserId,
    resolveCanonicalHandle: port,
    provenance: { source: "call-entry", note: "stage-c-identity-shadow" },
  });
  if (!built.ok) {
    return {
      ...base,
      outcome: DEFER_REASONS.has(built.reasonCode) ? "managed_defer" : "managed_deny",
      reasonCode: built.reasonCode,
      managedLocator: null,
      mismatch: false,
    };
  }

  const access = await resolveMemoryIndexAccess(built.context, {
    agentId: params.agentId,
    ledgerId,
  });
  if (!access.ok) {
    return {
      ...base,
      outcome: DEFER_REASONS.has(access.reasonCode) ? "managed_defer" : "managed_deny",
      reasonCode: access.reasonCode,
      canonicalReasonCode: access.canonicalReasonCode,
      managedLocator: null,
      mismatch: false,
    };
  }

  const managedLocator =
    access.access.profile === "managed_enterprise" ? access.access.locator : null;
  return {
    ...base,
    outcome: "managed_success",
    managedLocator,
    mismatch: hasText(legacyLocator) !== hasText(managedLocator),
  };
}

/**
 * Gated shadow entrypoint. No-op (returns null) unless OPENBOT_ITEM7_STAGE_C_IDENTITY_SHADOW is on.
 * Never throws into the production path; records a redacted metric line.
 */
export async function runStageCManagedIdentityShadowIfEnabled(params: {
  governance: MemorySearchGovernance | undefined;
  agentId: string;
  cfg?: OpenBotConfig;
  ledgerId?: Item7StageCLedgerId;
  legacyLocator?: string | null;
  authenticatedUserId?: string | null;
  env?: NodeJS.ProcessEnv;
  resolveCanonicalHandle?: CanonicalMemoryWorkspaceResolver;
}): Promise<StageCIdentityShadowResult | null> {
  if (!isStageCIdentityShadowEnabled(params.env)) {
    return null;
  }
  if (!params.governance) {
    // No server-built governance at this entrypoint -> defer (observable, no manager/scan/write).
    log.info?.("stage_c_identity_shadow", {
      agentId: params.agentId,
      ledgerId: params.ledgerId ?? DEFAULT_STAGE_C_LEDGER_ID,
      outcome: "managed_defer",
      reasonCode: "managed_identity_required",
    });
    return {
      enabled: true,
      ledgerId: params.ledgerId ?? DEFAULT_STAGE_C_LEDGER_ID,
      agentId: params.agentId,
      outcome: "managed_defer",
      reasonCode: "managed_identity_required",
      managedLocator: null,
      legacyLocator: params.legacyLocator ?? null,
      mismatch: false,
    };
  }
  try {
    const result = await evaluateStageCManagedIdentityShadow({
      governance: params.governance,
      agentId: params.agentId,
      cfg: params.cfg,
      ledgerId: params.ledgerId,
      legacyLocator: params.legacyLocator,
      authenticatedUserId: params.authenticatedUserId,
      resolveCanonicalHandle: params.resolveCanonicalHandle,
    });
    // Redacted metric: no tenantId/userId/locator values (only presence + outcome).
    log.info?.("stage_c_identity_shadow", {
      agentId: result.agentId,
      ledgerId: result.ledgerId,
      outcome: result.outcome,
      reasonCode: result.reasonCode,
      canonicalReasonCode: result.canonicalReasonCode,
      managedResolved: result.managedLocator !== null,
      mismatch: result.mismatch,
    });
    return result;
  } catch (err) {
    // Shadow must never affect production; swallow and record.
    log.warn?.("stage_c_identity_shadow_error", {
      agentId: params.agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * ModelEntitlementAdapter (plan PR-P2-1).
 *
 * Pure map from an already-computed allowlist filter result (before/after candidates)
 * onto a GovernanceDecision. Does not authorize models, read entitlement stores, or
 * change the candidate set. Callers decide whether to apply the filtered set.
 *
 * decisionId is always a fresh `gd-`; `commercialAuthorizationId` is filled from the
 * commercial gate id when present.
 */

import type { ModelCandidate } from "../../../agents/model-fallback.types.js";
import { modelKey } from "../../../agents/model-selection.js";
import { resolveGovernanceDecisionIds } from "../decision-id.js";
import {
  classifyDivergence,
  createGovernanceDecision,
  createLegacySkippedDecision,
  type GovernanceDecision,
  type GovernanceMode,
  type GovernanceTraceEntry,
} from "../decision.js";

export type ModelEntitlementContext = {
  tenantId?: string;
  actorId?: string;
  requestId?: string;
  parentRunId?: string;
  /** The commercial gate's `authorizationDecisionId`; linked, never reused as decisionId. */
  commercialAuthorizationId?: string;
  /** Execution-entry id the caller already knows (`E2`, `E3`, `E10`); copied as `entry`. */
  entry?: string;
};

export const MODEL_ENTITLEMENT_TRACE_STAGE = "model.entitlement.allowlist";

/**
 * Marker for CLI-backend providers (`isCliProvider`: claude-cli, codex-cli, trae-cli,
 * configured `cliBackends`). Those run an external CLI with their own credential scope
 * (E16) and are not platform-catalog models, so the enterprise allowlist does not name
 * them. They are tagged so shadow reports can separate them from ordinary would-deny.
 */
export const CLI_BACKEND_MODEL_MARKER = "cli-backend-model";

/**
 * Pure: describes what the allowlist would do to `before`.
 *  - legacy → `skipped` + `legacy` (no enterprise scope).
 *  - shadow/enforced without an allowlist → `skipped` (enterprise scope without a
 *    resolved set; reported separately, never counted as allow).
 *  - filtered set empty → `deny` (would-deny in shadow).
 *  - otherwise → `allow`; the trace marks removed candidates as `modify`.
 */
export function adaptModelEntitlement(params: {
  mode: GovernanceMode;
  before: readonly ModelCandidate[];
  /** `undefined` when no allowlist was supplied. */
  after: readonly ModelCandidate[] | undefined;
  /**
   * Reason when `after` is undefined. Text fallback keeps the enterprise-scope
   * reason; image fallback uses the parent-set reason.
   */
  absentAllowlistReason?: string;
  /**
   * True when the run already applied the allowlist filter (P3-1 `preexisting`).
   * `shadow.existing` must then describe the filtered effect — never `allow` +
   * `not-enforced`. When filtered effect matches the shadow effect, divergence is D0.
   */
  filterApplied?: boolean;
  runId?: string;
  context?: ModelEntitlementContext;
  ts: string;
  uuid?: () => string;
  /** Classifies CLI-backend candidates; they are tagged, never filtered differently. */
  isCliBackend?: (candidate: ModelCandidate) => boolean;
}): GovernanceDecision {
  const ids = resolveGovernanceDecisionIds({
    source: "model-entitlement",
    authorizationDecisionId: params.context?.commercialAuthorizationId,
    uuid: params.uuid,
  });
  const primary = params.before[0];
  const base = {
    ...ids,
    source: "model-entitlement" as const,
    entry: params.context?.entry,
    runId: params.runId,
    requestId: params.context?.requestId,
    parentRunId: params.context?.parentRunId,
    tenantId: params.context?.tenantId,
    actorId: params.context?.actorId,
    ...(primary
      ? { subject: { kind: "model" as const, id: modelKey(primary.provider, primary.model) } }
      : {}),
    ts: params.ts,
  };
  if (params.mode === "legacy") {
    // Plan ADR-6: legacy means "no enterprise scope". When a commercial authorization
    // exists the run is enterprise-scoped and legacy came from the rollback flag; keep
    // that distinguishable so it is never read as a no-scope run (ADR-5 alert).
    const configuredLegacy = Boolean(params.context?.commercialAuthorizationId);
    return createLegacySkippedDecision({
      ...base,
      ...(configuredLegacy ? { reason: "legacy-by-configuration" } : {}),
    });
  }
  if (params.after === undefined) {
    return createGovernanceDecision({
      ...base,
      effect: "skipped",
      mode: params.mode,
      reason: params.absentAllowlistReason ?? "enterprise-scope-without-allowlist",
    });
  }
  const afterKeys = new Set(params.after.map((c) => modelKey(c.provider, c.model)));
  const removed = params.before.filter((c) => !afterKeys.has(modelKey(c.provider, c.model)));
  const effect = params.after.length === 0 ? "deny" : "allow";
  const primaryFiltered = primary
    ? !afterKeys.has(modelKey(primary.provider, primary.model))
    : false;
  const trace: GovernanceTraceEntry = {
    stage: MODEL_ENTITLEMENT_TRACE_STAGE,
    hit: removed.length > 0,
    detail: `candidates ${params.before.length}->${params.after.length}; primary ${primaryFiltered ? "filtered" : "kept"}`,
    effect: effect === "deny" ? "deny" : removed.length > 0 ? "modify" : "allow",
  };
  const isCli = params.isCliBackend ?? (() => false);
  const removedCli = removed.filter((c) => isCli(c));
  // The primary is what the run executes first; when it is a CLI backend the envelope
  // judges a different kind of object than the entitlement allowlist (plan §8.3 D4).
  const cliPrimaryFiltered = primaryFiltered && primary !== undefined && isCli(primary);
  const reason = cliPrimaryFiltered
    ? CLI_BACKEND_MODEL_MARKER
    : effect === "deny"
      ? "entitlement-empty"
      : primaryFiltered
        ? "primary-outside-allowlist"
        : removed.length > 0
          ? "fallback-outside-allowlist"
          : "within-allowlist";
  return createGovernanceDecision({
    ...base,
    effect,
    mode: params.mode,
    reason,
    matchedRules: [
      ...(removedCli.length > 0 ? [CLI_BACKEND_MODEL_MARKER] : []),
      ...removed.map(
        (c) =>
          `${isCli(c) ? CLI_BACKEND_MODEL_MARKER : "outside-allowlist"}:${modelKey(c.provider, c.model)}`,
      ),
    ],
    decisionTrace: [trace],
    ...(params.mode === "shadow"
      ? {
          shadow: params.filterApplied
            ? {
                // Preexisting hard-filter already ran: existing = filtered effect.
                existing: {
                  effect,
                  source: "model-entitlement" as const,
                  reason,
                },
                divergence: classifyDivergence({
                  existing: effect,
                  shadow: effect,
                  ...(cliPrimaryFiltered ? { sameSubject: false } : {}),
                }),
              }
            : {
                // governance-mode shadow: run keeps today's unfiltered behavior.
                existing: {
                  effect: "allow" as const,
                  source: "model-entitlement" as const,
                  reason: "not-enforced",
                },
                // A stricter shadow result here is the known agent-command bypass (B1).
                // A filtered CLI-backend primary is a different object (D4): excluded from
                // the divergence rate rather than counted as an ordinary would-deny.
                divergence: classifyDivergence({
                  existing: "allow",
                  shadow: effect,
                  stricterCause: "known-bypass",
                  ...(cliPrimaryFiltered ? { sameSubject: false } : {}),
                }),
              },
        }
      : {}),
  });
}

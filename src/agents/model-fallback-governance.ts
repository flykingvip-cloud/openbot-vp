/**
 * Model entitlement governance for `runWithModelFallback`
 * (governance closure plan v1.0 §4.3, §7.3 PR-1a; PR-P2-1 adapter wiring).
 *
 * Builds the `model-entitlement` envelope via ModelEntitlementAdapter and hands it
 * to the best-effort shadow sink. It never changes candidates itself: the caller
 * decides whether to apply the filtered set (only `enforced`). Every failure here
 * is swallowed so a shadow computation can never change a run.
 */

import {
  adaptModelEntitlement,
  CLI_BACKEND_MODEL_MARKER,
  MODEL_ENTITLEMENT_TRACE_STAGE,
  type ModelEntitlementContext,
} from "../gateway/governance/adapters/model-entitlement-adapter.js";
import { type GovernanceDecision, type GovernanceMode } from "../gateway/governance/decision.js";
import { recordShadowEvaluationFailure } from "../gateway/governance/shadow-failure.js";
import { appendGovernanceShadowDecision } from "../gateway/governance/shadow-sink.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ModelCandidate } from "./model-fallback.types.js";

const log = createSubsystemLogger("model-fallback-governance");

/** @deprecated Prefer ModelEntitlementContext; kept for existing call-site types. */
export type ModelGovernanceContext = ModelEntitlementContext;

export { CLI_BACKEND_MODEL_MARKER, MODEL_ENTITLEMENT_TRACE_STAGE };

/**
 * Pure: describes what the allowlist would do to `before`.
 * Delegates to ModelEntitlementAdapter (PR-P2-1). Envelope fields keep the same
 * effect / reason / decisionId rules as on 8fd955519.
 */
export function buildModelGovernanceDecision(params: {
  mode: GovernanceMode;
  before: readonly ModelCandidate[];
  /** `undefined` when no allowlist was supplied. */
  after: readonly ModelCandidate[] | undefined;
  /**
   * Reason when `after` is undefined. Text fallback keeps the enterprise-scope
   * reason; image fallback uses the parent-set reason.
   */
  absentAllowlistReason?: string;
  /** True when the run applied the allowlist filter (P3-1 preexisting). */
  filterApplied?: boolean;
  runId?: string;
  context?: ModelGovernanceContext;
  ts: string;
  uuid?: () => string;
  /** Classifies CLI-backend candidates; they are tagged, never filtered differently. */
  isCliBackend?: (candidate: ModelCandidate) => boolean;
}): GovernanceDecision {
  return adaptModelEntitlement(params);
}

/**
 * The live side the run keeps when the envelope could not be built. The caller decides
 * the filter on its own; an unset `filterApplied` (image fallback) filters only under
 * `enforced` with an allowlist.
 */
function liveModelEffect(params: {
  mode: GovernanceMode;
  after: readonly ModelCandidate[] | undefined;
  filterApplied?: boolean;
}): Pick<GovernanceDecision, "effect" | "source" | "reason"> {
  const filtered =
    params.filterApplied ?? (params.mode === "enforced" && params.after !== undefined);
  if (!filtered) {
    return { effect: "allow", source: "model-entitlement", reason: "not-enforced" };
  }
  return {
    effect: params.after?.length === 0 ? "deny" : "allow",
    source: "model-entitlement",
    reason: "filter-applied",
  };
}

/**
 * Builds and records the envelope. Never throws; returns the decision when built.
 * A build failure is logged and recorded as a D6 envelope; the run is unchanged.
 */
export function recordModelGovernanceDecision(
  params: Omit<Parameters<typeof buildModelGovernanceDecision>[0], "ts"> & { ts?: string },
): GovernanceDecision | undefined {
  try {
    const decision = buildModelGovernanceDecision({
      ...params,
      ts: params.ts ?? new Date().toISOString(),
    });
    void appendGovernanceShadowDecision(decision).catch(() => {});
    return decision;
  } catch (error) {
    log.warn(`model governance decision failed (D6): ${String(error)}`);
    recordShadowEvaluationFailure({
      fields: () => ({
        source: "model-entitlement",
        mode: params.mode,
        existing: liveModelEffect(params),
        entry: params.context?.entry,
        runId: params.runId,
        requestId: params.context?.requestId,
        parentRunId: params.context?.parentRunId,
        tenantId: params.context?.tenantId,
        actorId: params.context?.actorId,
        commercialAuthorizationId: params.context?.commercialAuthorizationId,
      }),
    });
    return undefined;
  }
}

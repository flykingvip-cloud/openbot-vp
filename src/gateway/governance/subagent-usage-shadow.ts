/**
 * Subagent run usage attribution, shadow only (governance closure P4-0).
 *
 * The subagent lane never acquires a commercial run or a concurrency slot, and
 * `recordAgentCommandCreditUsage` returns `skipped` / `no-commercial-gate` for it, so
 * its usage never reaches the usage outbox. This module only writes the attribution
 * that already exists on the child run's parent snapshot (`opts.spawnGovernanceSnapshot`,
 * copied by `snapshotForChildModelHandoff`) into one shadow envelope:
 *
 *  - snapshot carries `commercialAuthorizationId` → `skipped` + `subagent-usage-not-billed`
 *  - no snapshot, or no id on it                   → `skipped` + `missing-parent-authorization`
 *
 * P4-1 (`OPENBOT_SUBAGENT_CREDIT_USAGE`, default off) may bill the run instead; then no
 * `subagent-usage-not-billed` envelope is written. With the switch on but the snapshot
 * missing `creditReporting.enterpriseId` / `policyId`, the caller passes
 * `subagent-billing-context-absent`. Without a parent authorization id the reason is
 * always `missing-parent-authorization`.
 *
 * Recorded only on the subagent lane, only when the run reported non-zero token usage,
 * and never for CLI-backend providers (their usage stays on `recordCliBackendUsage`).
 * The envelope goes through `appendGovernanceShadowDecision`, so nothing is written
 * while `OPENBOT_GOVERNANCE_SHADOW_LOG` is off. It never enqueues usage, never calls
 * `recordCreditUsage`, never creates a gate, and never throws into the run.
 *
 * Both sides are `skipped` (D5). This record is not §8.4 evidence.
 */

import { hasNonzeroUsage, normalizeUsage, type UsageLike } from "../../agents/usage.js";
import { newGovernanceDecisionId } from "./decision-id.js";
import {
  classifyDivergence,
  createGovernanceDecision,
  type GovernanceDecision,
  type RunGovernanceSnapshot,
} from "./decision.js";
import { appendGovernanceShadowDecision } from "./shadow-sink.js";

export const SUBAGENT_USAGE_NOT_BILLED_REASON = "subagent-usage-not-billed";
export const MISSING_PARENT_AUTHORIZATION_REASON = "missing-parent-authorization";
/** P4-1: billing switch on, parent id present, but no enterprise / policy on the snapshot. */
export const SUBAGENT_BILLING_CONTEXT_ABSENT_REASON = "subagent-billing-context-absent";

/** Reasons a caller may request when the parent authorization id is present. */
export type SubagentUsageShadowReason =
  | typeof SUBAGENT_USAGE_NOT_BILLED_REASON
  | typeof SUBAGENT_BILLING_CONTEXT_ABSENT_REASON;

/**
 * Pure: the attribution envelope for one subagent run. Ids come only from the parent
 * snapshot, never from RPC params. The decisionId is a fresh `gd-` id: the parent's
 * `commercialAuthorizationId` is linked, not reused, so this record never shares an id
 * with the parent's commercial-run envelope.
 */
export function buildSubagentUsageAttributionDecision(params: {
  /** The child run's own id. */
  runId: string;
  snapshot?: RunGovernanceSnapshot;
  /**
   * Reason when the parent authorization id is present (default
   * `subagent-usage-not-billed`). Ignored without that id: the reason is then always
   * `missing-parent-authorization`.
   */
  reason?: SubagentUsageShadowReason;
  ts: string;
  uuid?: () => string;
}): GovernanceDecision {
  const snapshot = params.snapshot;
  const commercialAuthorizationId = snapshot?.commercialAuthorizationId?.trim() || undefined;
  const parentRunId = (snapshot?.parentRunId ?? snapshot?.runId)?.trim() || undefined;
  const parentDecisionId = snapshot?.snapshotId?.trim() || undefined;
  // The parent snapshot already carries both, and `snapshotForChildModelHandoff`
  // copies them to the child. Not forwarding them left the subagent row with a
  // parent authorization id but no tenant or actor, so it could not be grouped
  // with the parent's own rows even though they share a runId.
  const tenantId = snapshot?.tenantId?.trim() || undefined;
  const actorId = snapshot?.actorId?.trim() || undefined;
  return createGovernanceDecision({
    decisionId: newGovernanceDecisionId(params.uuid),
    source: "commercial-run",
    // Subagent lane only: the E6 family, never E2 / E3.
    entry: "E6",
    mode: "shadow",
    effect: "skipped",
    reason: commercialAuthorizationId
      ? (params.reason ?? SUBAGENT_USAGE_NOT_BILLED_REASON)
      : MISSING_PARENT_AUTHORIZATION_REASON,
    runId: params.runId,
    ...(parentRunId ? { parentRunId } : {}),
    ...(parentDecisionId ? { parentDecisionId } : {}),
    ...(commercialAuthorizationId ? { commercialAuthorizationId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(actorId ? { actorId } : {}),
    shadow: {
      existing: { effect: "skipped", source: "commercial-run", reason: "no-commercial-gate" },
      divergence: classifyDivergence({ existing: "skipped", shadow: "skipped" }),
    },
    ts: params.ts,
  });
}

/**
 * Records the envelope for a finished subagent run. Returns the decision when one was
 * built (the sink still writes nothing unless `OPENBOT_GOVERNANCE_SHADOW_LOG` is on),
 * `undefined` when this run does not qualify. Never throws.
 */
export async function recordSubagentUsageAttributionShadow(params: {
  isSubagentLane: boolean;
  /** True when the provider that produced the result is a CLI backend. */
  isCliBackend: boolean;
  /** The child run's own id. */
  runId: string;
  snapshot?: RunGovernanceSnapshot;
  usage?: UsageLike | null;
  /** See `buildSubagentUsageAttributionDecision`. */
  reason?: SubagentUsageShadowReason;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
}): Promise<GovernanceDecision | undefined> {
  if (!params.isSubagentLane || params.isCliBackend) {
    return undefined;
  }
  if (!hasNonzeroUsage(normalizeUsage(params.usage))) {
    return undefined;
  }
  try {
    const decision = buildSubagentUsageAttributionDecision({
      runId: params.runId,
      snapshot: params.snapshot,
      ...(params.reason ? { reason: params.reason } : {}),
      ts: params.now?.() ?? new Date().toISOString(),
    });
    await appendGovernanceShadowDecision(decision, { env: params.env });
    return decision;
  } catch {
    return undefined;
  }
}

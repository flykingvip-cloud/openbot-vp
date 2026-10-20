/**
 * D6: a shadow evaluation threw (plan §8.3; shadow-staging-runbook "Triage D1 through D6").
 *
 * A writer that catches an error from its own shadow evaluation records one envelope
 * here, next to its existing warning log. The envelope is `effect: "skipped"` (nothing
 * was evaluated, so never allow) with `reason: "shadow-threw"` and
 * `shadow.divergence: "D6"`. The `shadow` block is present in every mode so the class is
 * never lost. It carries only ids the writer already held before the failure.
 *
 * It never changes the live decision, the caller's return value, or any mode. The sink
 * still writes nothing unless `OPENBOT_GOVERNANCE_SHADOW_LOG` is on. Building or writing
 * this envelope never throws.
 */

import { newGovernanceDecisionId } from "./decision-id.js";
import {
  classifyDivergence,
  createGovernanceDecision,
  type GovernanceDecision,
  type GovernanceMode,
  type GovernanceSource,
  type GovernanceSubject,
} from "./decision.js";
import { appendGovernanceShadowDecision } from "./shadow-sink.js";

export const SHADOW_THREW_REASON = "shadow-threw";

export type ShadowEvaluationFailureInput = {
  source: GovernanceSource;
  mode: GovernanceMode;
  /** What the live path does without the shadow result. It is unchanged by the failure. */
  existing: Pick<GovernanceDecision, "effect" | "source" | "reason">;
  entry?: string;
  runId?: string;
  requestId?: string;
  parentRunId?: string;
  parentDecisionId?: string;
  commercialAuthorizationId?: string;
  tenantId?: string;
  actorId?: string;
  subject?: GovernanceSubject;
};

/** Pure: the D6 envelope. A fresh `gd-` id; linked ids are copied, never reused. */
export function buildShadowEvaluationFailureDecision(
  input: ShadowEvaluationFailureInput & { ts: string; uuid?: () => string },
): GovernanceDecision {
  return createGovernanceDecision({
    effect: "skipped",
    decisionId: newGovernanceDecisionId(input.uuid),
    source: input.source,
    entry: input.entry,
    mode: input.mode,
    reason: SHADOW_THREW_REASON,
    runId: input.runId,
    requestId: input.requestId,
    parentRunId: input.parentRunId,
    parentDecisionId: input.parentDecisionId,
    commercialAuthorizationId: input.commercialAuthorizationId,
    tenantId: input.tenantId,
    actorId: input.actorId,
    subject: input.subject,
    shadow: {
      existing: { ...input.existing },
      divergence: classifyDivergence({
        existing: input.existing.effect,
        shadow: "skipped",
        shadowThrew: true,
      }),
    },
    ts: input.ts,
  });
}

/**
 * Records the D6 envelope and returns it. `fields` is read inside the guard, so a
 * second failure while collecting ids is swallowed as well: this never throws.
 */
export function recordShadowEvaluationFailure(params: {
  fields: () => ShadowEvaluationFailureInput;
  env?: NodeJS.ProcessEnv;
  ts?: string;
}): GovernanceDecision | undefined {
  try {
    const decision = buildShadowEvaluationFailureDecision({
      ...params.fields(),
      ts: params.ts ?? new Date().toISOString(),
    });
    void appendGovernanceShadowDecision(decision, { env: params.env }).catch(() => {});
    return decision;
  } catch {
    return undefined;
  }
}

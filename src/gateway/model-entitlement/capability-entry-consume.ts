/**
 * Cross-entry consumption of capability-plan routing results.
 *
 * Chat / followup / cron / subagent must not `void` outcomeClaim: explanatory
 * text may still be returned, but image/music (and other unwired modalities)
 * must stay marked incomplete via CapabilityExecutionSurface.
 */

import type {
  CapabilityExecutionSurface,
  CapabilityPlanOutcomeClaim,
  CapabilityPlanFailure,
} from "./task-capability-plan.js";
import {
  resolveCapabilityExecutionSurface,
  resolveCapabilityPlanOutcomeClaim,
  type TaskCapabilityPlan,
} from "./task-capability-plan.js";

/** Structured payload suitable for TaskOutcome / runner turn recording. */
export type CapabilityOutcomeForTurn = {
  planFailureKind: string;
  allowedModality: string;
  forbiddenSuccessModalities: readonly string[];
  detail?: string;
  /** Structured surface — prefer these fields over parsing detail strings. */
  textReturnedAllowed: boolean;
  targetModalityCompleted: boolean;
  status: CapabilityExecutionSurface["status"];
  incompleteModalities: readonly string[];
};

export type ConsumedCapabilityRouting = {
  planFailure: CapabilityPlanFailure;
  outcomeClaim?: CapabilityPlanOutcomeClaim;
  executionSurface: CapabilityExecutionSurface;
  /** Always populated when a plan/claim exists; never silently dropped. */
  capabilityOutcome?: CapabilityOutcomeForTurn;
};

function surfaceToOutcome(surface: CapabilityExecutionSurface): CapabilityOutcomeForTurn {
  return {
    planFailureKind: surface.planFailureKind,
    allowedModality: surface.allowedModality,
    forbiddenSuccessModalities: surface.incompleteModalities,
    textReturnedAllowed: surface.textReturnedAllowed,
    targetModalityCompleted: surface.targetModalityCompleted,
    status: surface.status,
    incompleteModalities: surface.incompleteModalities,
    ...(surface.detail ? { detail: surface.detail } : {}),
  };
}

/**
 * Consume routing / claim into a durable structured surface.
 * Call sites must keep the returned object (assign / persist / return) —
 * never `void` the claim.
 */
export function consumeCapabilityRoutingResult(params: {
  planFailure?: CapabilityPlanFailure;
  outcomeClaim?: CapabilityPlanOutcomeClaim;
  executionSurface?: CapabilityExecutionSurface;
  capabilityPlan?: TaskCapabilityPlan;
}): ConsumedCapabilityRouting {
  const claim =
    params.outcomeClaim ??
    (params.capabilityPlan ? resolveCapabilityPlanOutcomeClaim(params.capabilityPlan) : undefined);
  const surface =
    params.executionSurface ??
    (claim
      ? resolveCapabilityExecutionSurface(claim)
      : ({
          textReturnedAllowed: true,
          targetModalityCompleted: false,
          allowedModality: "chat_model",
          incompleteModalities: [],
          planFailureKind: "none",
          status: "ok",
          detail: "routing_executable_not_completed",
        } satisfies CapabilityExecutionSurface));
  const planFailure = params.planFailure ?? claim?.planFailure ?? { kind: "none" as const };
  return {
    planFailure,
    ...(claim ? { outcomeClaim: claim } : {}),
    executionSurface: surface,
    ...(claim || surface.status !== "ok"
      ? { capabilityOutcome: surfaceToOutcome(surface) }
      : surface.planFailureKind !== "none"
        ? { capabilityOutcome: surfaceToOutcome(surface) }
        : {}),
  };
}

/** Machine-readable one-liner for verbose logs (not a success claim). */
export function formatCapabilityExecutionSurfaceLog(surface: CapabilityExecutionSurface): string {
  return [
    `capability_surface status=${surface.status}`,
    `textReturnedAllowed=${surface.textReturnedAllowed}`,
    `targetModalityCompleted=${surface.targetModalityCompleted}`,
    `allowedModality=${surface.allowedModality}`,
    surface.incompleteModalities.length > 0
      ? `incomplete=${surface.incompleteModalities.join(",")}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

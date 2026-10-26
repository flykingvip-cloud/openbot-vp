/**
 * Structured capability-modality snapshot on TaskOutcome.
 * Acceptance must consume these fields; string reasonDetail alone is not enough
 * to claim target-modality success (e.g. executor_unwired must never upgrade).
 */

export type CapabilityModalityExecutionStatus =
  | "routing_ok"
  | "executor_unwired"
  | "no_executable_candidates"
  | "unsupported"
  | "incomplete"
  | "completed";

export type CapabilityModalitySnapshot = {
  /** Intended target modality for the task (e.g. image_generation, chat_model). */
  targetModality: string;
  executionStatus: CapabilityModalityExecutionStatus;
  /** True only after real execution / artifacts / acceptance completed the target. */
  targetModalityCompleted: boolean;
  textReturnedAllowed: boolean;
  incompleteModalities: string[];
  incompleteReason?: string;
  planFailureKind: string;
  forbiddenSuccessModalities?: string[];
};

export type TargetModalityAcceptanceAssessment = {
  /** Whether the target modality may be treated as successfully completed. */
  targetModalitySucceeded: boolean;
  reason: string;
};

/**
 * Acceptance consumer for structured capability modality.
 * Persisted executor_unwired / incomplete / routing_ok-without-completion
 * must not upgrade into target-modality success.
 */
export function assessTargetModalityAcceptance(
  modality: CapabilityModalitySnapshot | null | undefined,
): TargetModalityAcceptanceAssessment {
  if (!modality) {
    return { targetModalitySucceeded: false, reason: "missing_capability_modality" };
  }
  if (
    modality.executionStatus === "executor_unwired" ||
    modality.planFailureKind === "executor_unwired"
  ) {
    return { targetModalitySucceeded: false, reason: "executor_unwired" };
  }
  if (
    modality.executionStatus === "no_executable_candidates" ||
    modality.planFailureKind === "no_executable_candidates"
  ) {
    return { targetModalitySucceeded: false, reason: "no_executable_candidates" };
  }
  if (modality.executionStatus === "unsupported" || modality.planFailureKind === "unsupported") {
    return { targetModalitySucceeded: false, reason: "unsupported" };
  }
  if (!modality.targetModalityCompleted) {
    return {
      targetModalitySucceeded: false,
      reason: modality.incompleteReason ?? "target_modality_incomplete",
    };
  }
  if (
    Array.isArray(modality.forbiddenSuccessModalities) &&
    modality.forbiddenSuccessModalities.includes(modality.targetModality)
  ) {
    return { targetModalitySucceeded: false, reason: "forbidden_success_modality" };
  }
  return { targetModalitySucceeded: true, reason: "completed" };
}

/** Map a routing / runner capability claim onto a durable structured snapshot. */
export function capabilityModalityFromClaim(claim: {
  planFailureKind: string;
  allowedModality: string;
  forbiddenSuccessModalities?: readonly string[];
  textReturnedAllowed?: boolean;
  targetModalityCompleted?: boolean;
  status?: string;
  incompleteModalities?: readonly string[];
  detail?: string;
}): CapabilityModalitySnapshot {
  const statusRaw = claim.status ?? claim.planFailureKind;
  let executionStatus: CapabilityModalityExecutionStatus;
  if (statusRaw === "ok" || statusRaw === "none") {
    executionStatus = claim.targetModalityCompleted ? "completed" : "routing_ok";
  } else if (statusRaw === "executor_unwired") {
    executionStatus = "executor_unwired";
  } else if (statusRaw === "no_executable_candidates") {
    executionStatus = "no_executable_candidates";
  } else if (statusRaw === "unsupported") {
    executionStatus = "unsupported";
  } else if (claim.targetModalityCompleted) {
    executionStatus = "completed";
  } else {
    executionStatus = "incomplete";
  }
  const incomplete =
    claim.incompleteModalities && claim.incompleteModalities.length > 0
      ? [...claim.incompleteModalities]
      : claim.forbiddenSuccessModalities && claim.forbiddenSuccessModalities.length > 0
        ? [...claim.forbiddenSuccessModalities]
        : [];
  // Prefer a concrete incomplete modality as target when chat was only the fallback.
  const targetModality =
    incomplete[0] && claim.allowedModality === "chat_model" && claim.planFailureKind !== "none"
      ? incomplete[0]
      : claim.allowedModality;
  return {
    targetModality,
    executionStatus,
    targetModalityCompleted: claim.targetModalityCompleted === true,
    textReturnedAllowed: claim.textReturnedAllowed !== false,
    incompleteModalities: incomplete,
    ...(claim.detail ? { incompleteReason: claim.detail } : {}),
    planFailureKind: claim.planFailureKind,
    ...(claim.forbiddenSuccessModalities
      ? { forbiddenSuccessModalities: [...claim.forbiddenSuccessModalities] }
      : {}),
  };
}

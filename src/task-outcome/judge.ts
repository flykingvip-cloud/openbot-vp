import type {
  AcceptanceGate,
  DeliveryGate,
  Lifecycle,
  TaskJudgement,
  TerminalJudgement,
} from "./types.js";

export type JudgeInput = {
  lifecycle: Lifecycle;
  acceptance: AcceptanceGate;
  delivery: DeliveryGate;
  cancelRequested?: boolean;
  stopRecovery?: boolean;
  prepareFailed?: boolean;
};

/**
 * Pure unique judgement. Non-closed lifecycle always projects incomplete.
 * Closed terminals: success | failure | cancelled only.
 */
export function projectTaskJudgement(input: JudgeInput): TaskJudgement {
  if (input.lifecycle !== "closed") {
    return "incomplete";
  }
  return decideTerminal(input);
}

export function decideTerminal(input: JudgeInput): TerminalJudgement {
  if (input.cancelRequested) {
    return "cancelled";
  }
  if (input.prepareFailed) {
    return "failure";
  }
  const acceptanceOk =
    input.acceptance.status === "passed" || input.acceptance.status === "not_required";
  const deliveryOk =
    input.delivery.status === "delivered" || input.delivery.status === "not_required";
  if (acceptanceOk && deliveryOk) {
    return "success";
  }
  if (input.acceptance.status === "failed" && input.stopRecovery) {
    return "failure";
  }
  if (input.delivery.status === "failed") {
    return "failure";
  }
  // Unconfirmed delivery closed with explicit reason → failure (not success).
  if (input.delivery.status === "delivery_unknown") {
    return "failure";
  }
  return "failure";
}

export function deriveLifecycle(input: {
  cancelRequested?: boolean;
  prepareFailed?: boolean;
  acceptance: AcceptanceGate;
  delivery: DeliveryGate;
  stopRecovery?: boolean;
  hasDecisiveRun?: boolean;
}): Lifecycle {
  if (input.cancelRequested) {
    return "closed";
  }
  if (input.prepareFailed) {
    return "closed";
  }
  if (input.acceptance.status === "failed") {
    return input.stopRecovery ? "closed" : "recovering";
  }
  if (input.acceptance.status === "pending") {
    return "awaiting_acceptance";
  }
  const acceptanceOk =
    input.acceptance.status === "passed" || input.acceptance.status === "not_required";
  if (acceptanceOk) {
    if (input.delivery.status === "delivered" || input.delivery.status === "not_required") {
      return "closed";
    }
    if (input.delivery.status === "failed") {
      return "closed";
    }
    // delivery_unknown stays awaiting unless explicit unconfirmed close.
    return "awaiting_delivery";
  }
  return input.hasDecisiveRun ? "active" : "active";
}

/** delivery_unknown must never be treated as success by callers. */
export function assertDeliveryUnknownNotSuccess(
  delivery: DeliveryGate,
  judgement: TaskJudgement,
): void {
  if (delivery.status === "delivery_unknown" && judgement === "success") {
    throw new Error("delivery_unknown must not project to success");
  }
}

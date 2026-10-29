/**
 * Write-side / side-effect retry gate.
 *
 * After a write or other side-effecting tool, an unclear result must stay
 * `unknown_outcome`. Automatic retry is forbidden until trusted result
 * evidence is present. Blind rematerialize / auto-retry without verification
 * is not allowed.
 */
import type { CoreToolSideEffectLevel } from "./tool-catalog.js";

export const WRITE_SIDE_OUTCOME_UNKNOWN = "unknown_outcome" as const;
export const WRITE_SIDE_RETRY_FORBIDDEN_REASON =
  "write_side_retry_forbidden_without_trusted_result_evidence" as const;

export type WriteSideOutcomeStatus =
  | "ok"
  | "failed"
  | typeof WRITE_SIDE_OUTCOME_UNKNOWN
  | "pending";

export type WriteSideRetryDecision = {
  /** Whether an automatic retry/rematerialize is allowed. */
  allowAutomaticRetry: boolean;
  /** Status to keep / surface (unknown stays unknown). */
  status: WriteSideOutcomeStatus;
  reason?: string;
};

export type WriteSideRetryGateParams = {
  /** Tool side-effect level from the catalog (none = read-only). */
  sideEffectLevel: CoreToolSideEffectLevel | "none" | "reversible" | "irreversible_external";
  /** Observed outcome after the tool call. */
  outcomeStatus: WriteSideOutcomeStatus;
  /**
   * Trusted evidence that the prior write's result is known (receipt, verified
   * digests, durable confirm). Model-only guesses do not count.
   */
  trustedResultEvidence?: boolean;
};

function isWriteSide(level: WriteSideRetryGateParams["sideEffectLevel"]): boolean {
  return level !== "none";
}

/**
 * Decide whether an automatic retry is allowed after a tool outcome.
 * Write/side-effect + unknown → keep unknown, forbid auto-retry.
 */
export function decideWriteSideRetry(params: WriteSideRetryGateParams): WriteSideRetryDecision {
  const { sideEffectLevel, outcomeStatus, trustedResultEvidence } = params;

  if (outcomeStatus === WRITE_SIDE_OUTCOME_UNKNOWN) {
    if (isWriteSide(sideEffectLevel)) {
      if (trustedResultEvidence === true) {
        // Trusted evidence can clear unknown into an explicit failed/ok path
        // decided by the caller; this gate alone never auto-retries.
        return {
          allowAutomaticRetry: false,
          status: WRITE_SIDE_OUTCOME_UNKNOWN,
          reason: WRITE_SIDE_RETRY_FORBIDDEN_REASON,
        };
      }
      return {
        allowAutomaticRetry: false,
        status: WRITE_SIDE_OUTCOME_UNKNOWN,
        reason: WRITE_SIDE_RETRY_FORBIDDEN_REASON,
      };
    }
    // Read-only unknown may still be retried by other policies; this gate does
    // not forbid it, but also does not invent success.
    return { allowAutomaticRetry: true, status: WRITE_SIDE_OUTCOME_UNKNOWN };
  }

  if (outcomeStatus === "failed" && isWriteSide(sideEffectLevel)) {
    // Failed-with-known-result may retry only when callers supply their own
    // recoverable classifier; this gate does not auto-approve rematerialize.
    return {
      allowAutomaticRetry: false,
      status: "failed",
      reason: "write_side_no_blind_rematerialize",
    };
  }

  return { allowAutomaticRetry: false, status: outcomeStatus };
}

/**
 * True when recoverable-tool-failure continue must NOT fire because a prior
 * write/side-effect left an unknown outcome without trusted evidence.
 */
export function shouldSuppressRecoverableContinueForUnknownWrite(params: {
  tools: readonly {
    toolName?: string;
    success?: boolean;
    meta?: string;
    sideEffectLevel?: WriteSideRetryGateParams["sideEffectLevel"];
    outcomeStatus?: WriteSideOutcomeStatus;
  }[];
  trustedResultEvidence?: boolean;
}): boolean {
  for (const tool of params.tools) {
    const level = tool.sideEffectLevel ?? "none";
    const status =
      tool.outcomeStatus ??
      (/\bunknown_outcome\b|result unknown|outcome unclear|timeout after write/i.test(
        tool.meta ?? "",
      )
        ? WRITE_SIDE_OUTCOME_UNKNOWN
        : undefined);
    if (!status) {
      continue;
    }
    const decision = decideWriteSideRetry({
      sideEffectLevel: level,
      outcomeStatus: status,
      trustedResultEvidence: params.trustedResultEvidence,
    });
    if (
      decision.status === WRITE_SIDE_OUTCOME_UNKNOWN &&
      !decision.allowAutomaticRetry &&
      isWriteSide(level)
    ) {
      return true;
    }
  }
  return false;
}

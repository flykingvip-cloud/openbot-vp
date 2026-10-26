import { deriveLifecycle, projectTaskJudgement } from "./judge.js";
import type {
  AcceptanceEvidence,
  AcceptanceGate,
  DeliveryGate,
  SubmitTransition,
  TaskOutcomeRecord,
  TrustedScope,
} from "./types.js";
import { JUDGEMENT_POLICY_VERSION, TASK_OUTCOME_SCHEMA_VERSION } from "./types.js";

export function scopeIdOf(scope: TrustedScope): string {
  return scope.kind === "personal" ? scope.personalDomainId : scope.enterpriseDomainId;
}

export function evidenceStillValid(
  evidence: AcceptanceEvidence[] | undefined,
  currentArtifactDigest: string | undefined,
): boolean {
  if (!evidence?.length) {
    return true;
  }
  if (!currentArtifactDigest) {
    return true;
  }
  return evidence.every((e) => e.artifactDigestOrReceiptRef === currentArtifactDigest);
}

export function applyTransition(
  current: TaskOutcomeRecord | undefined,
  taskId: string,
  transition: SubmitTransition,
  nowIso: string,
  submittedBy: string,
): { record: TaskOutcomeRecord; illegal?: string } {
  if (transition.type === "create") {
    if (current) {
      return { record: current, illegal: "task already exists" };
    }
    const acceptance: AcceptanceGate = { status: "pending" };
    const delivery: DeliveryGate = { status: "pending" };
    const lifecycle = deriveLifecycle({ acceptance, delivery });
    const record: TaskOutcomeRecord = {
      schemaVersion: TASK_OUTCOME_SCHEMA_VERSION,
      taskContractVersion: transition.taskContractVersion,
      judgementPolicyVersion: JUDGEMENT_POLICY_VERSION,
      scope: transition.scope,
      taskId,
      entrypoint: transition.entrypoint,
      lifecycle,
      decisiveRunStatus: "none",
      acceptance,
      delivery,
      attempts: [],
      runs: [],
      outcomeVersion: 1,
      submittedBy,
      taskJudgement: projectTaskJudgement({ lifecycle, acceptance, delivery }),
      decidedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    return { record };
  }

  if (!current) {
    return {
      record: null as unknown as TaskOutcomeRecord,
      illegal: "not_found",
    };
  }

  if (current.lifecycle === "closed" && transition.type !== "correction") {
    return { record: current, illegal: "terminal_protected" };
  }

  let next: TaskOutcomeRecord = { ...current, updatedAt: nowIso, submittedBy };
  let cancelRequested = false;
  let stopRecovery = false;
  let prepareFailed = false;

  switch (transition.type) {
    case "record_attempt": {
      if (current.fencingToken && transition.fencingToken !== current.fencingToken) {
        // Allow first token set; reject stale if lease epoch advanced with different token held.
        if (
          current.leaseEpoch &&
          current.leaseEpoch > 0 &&
          transition.fencingToken !== current.fencingToken
        ) {
          return { record: current, illegal: "stale_fencing" };
        }
      }
      const attempts = [
        ...current.attempts.filter((a) => a.attemptId !== transition.attempt.attemptId),
        transition.attempt,
      ];
      const runs = [
        ...current.runs.filter((r) => r.runId !== transition.run.runId),
        transition.run,
      ];
      next = {
        ...next,
        attempts,
        runs,
        decisiveRunId: transition.run.runId,
        decisiveAttemptId: transition.run.effectiveAttemptId ?? transition.attempt.attemptId,
        decisiveRunStatus: transition.run.status,
        fencingToken: transition.fencingToken,
        leaseEpoch: (current.leaseEpoch ?? 0) + (transition.run.status === "timed_out" ? 1 : 0),
      };
      // timeout revokes lease by bumping epoch; late writers with old token fail fencing check on next write
      if (transition.run.status === "timed_out") {
        next.fencingToken = `revoked:${transition.fencingToken}:${next.leaseEpoch}`;
      }
      break;
    }
    case "set_acceptance": {
      if (current.fencingToken && transition.fencingToken !== current.fencingToken) {
        return { record: current, illegal: "stale_fencing" };
      }
      stopRecovery = !transition.allowRetry && transition.acceptance.status === "failed";
      next = {
        ...next,
        acceptance: transition.acceptance,
        acceptanceEvidence: transition.evidence ?? current.acceptanceEvidence,
      };
      break;
    }
    case "set_delivery": {
      if (current.fencingToken && transition.fencingToken !== current.fencingToken) {
        return { record: current, illegal: "stale_fencing" };
      }
      next = {
        ...next,
        delivery: transition.delivery,
        deliveryId: transition.deliveryId ?? current.deliveryId,
      };
      break;
    }
    case "cancel": {
      cancelRequested = true;
      next = {
        ...next,
        reasonCode: "user_cancelled",
        reasonDetail: transition.reasonDetail,
        decisiveRunStatus:
          current.decisiveRunStatus === "none" ? "cancelled" : current.decisiveRunStatus,
      };
      break;
    }
    case "close_unconfirmed_delivery": {
      if (current.fencingToken && transition.fencingToken !== current.fencingToken) {
        return { record: current, illegal: "stale_fencing" };
      }
      if (current.delivery.status !== "delivery_unknown") {
        return { record: current, illegal: "illegal_transition" };
      }
      next = {
        ...next,
        reasonCode: "delivery_unconfirmed_close",
        reasonDetail: transition.reasonDetail,
        // force closed failure without forging delivered
        delivery: { status: "delivery_unknown" },
      };
      // mark as explicit close via stopRecovery path on unknown
      stopRecovery = true;
      break;
    }
    case "prepare_failed": {
      prepareFailed = true;
      next = {
        ...next,
        reasonCode: transition.reasonCode,
        reasonDetail: transition.reasonDetail,
        decisiveRunStatus: "none",
      };
      break;
    }
    case "correction": {
      next = {
        ...next,
        acceptance: transition.acceptance,
        delivery: transition.delivery,
        decisiveRunStatus: transition.decisiveRunStatus ?? current.decisiveRunStatus,
        previousOutcomeVersion: transition.previousOutcomeVersion,
        revisionKind: "correction",
        revisionReason: transition.revisionReason,
        reasonCode: "correction",
        submittedBy: transition.authorizedBy,
      };
      if (
        (transition.acceptance.status === "passed" ||
          transition.acceptance.status === "not_required") &&
        (transition.delivery.status === "delivered" ||
          transition.delivery.status === "not_required")
      ) {
        // reopen closed for correction then re-close
      }
      break;
    }
    default:
      return { record: current, illegal: "illegal_transition" };
  }

  if (transition.type === "close_unconfirmed_delivery") {
    next.lifecycle = "closed";
    next.taskJudgement = "failure";
    next.reasonCode = "delivery_unconfirmed_close";
  } else {
    const lifecycle = deriveLifecycle({
      cancelRequested,
      prepareFailed,
      acceptance: next.acceptance,
      delivery: next.delivery,
      stopRecovery:
        stopRecovery || (transition.type === "set_acceptance" && !transition.allowRetry),
      hasDecisiveRun: next.decisiveRunStatus !== "none",
    });
    // correction always re-derives and may close
    if (transition.type === "correction") {
      const cLifecycle = deriveLifecycle({
        acceptance: next.acceptance,
        delivery: next.delivery,
        stopRecovery: next.acceptance.status === "failed",
        hasDecisiveRun: true,
      });
      next.lifecycle = cLifecycle;
      next.taskJudgement = projectTaskJudgement({
        lifecycle: cLifecycle,
        acceptance: next.acceptance,
        delivery: next.delivery,
        stopRecovery: next.acceptance.status === "failed",
      });
      if (next.taskJudgement === "success") {
        next.reasonCode = "accepted_and_delivered";
      }
    } else {
      next.lifecycle = lifecycle;
      next.taskJudgement = projectTaskJudgement({
        lifecycle,
        acceptance: next.acceptance,
        delivery: next.delivery,
        cancelRequested,
        prepareFailed,
        stopRecovery:
          stopRecovery ||
          (transition.type === "set_acceptance" &&
            transition.acceptance.status === "failed" &&
            !transition.allowRetry),
      });
      if (next.taskJudgement === "success") {
        next.reasonCode = "accepted_and_delivered";
      }
      if (next.taskJudgement === "failure" && next.acceptance.status === "failed") {
        next.reasonCode = next.reasonCode ?? "acceptance_failed_stop";
      }
    }
  }

  next.decidedAt = nowIso;
  return { record: next };
}

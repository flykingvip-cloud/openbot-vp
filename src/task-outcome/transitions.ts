import { accumulateTaskBudgetSpend } from "./budget.js";
import { assessTargetModalityAcceptance } from "./capability-modality.js";
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
      ...(transition.parentTaskId?.trim() ? { parentTaskId: transition.parentTaskId.trim() } : {}),
      ...(transition.taskContract ? { taskContract: transition.taskContract } : {}),
      ...(transition.budget ? { budget: transition.budget } : {}),
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
      // W3: refuse invented not_required when tip carries a non-chat_turn contract.
      if (transition.acceptance.status === "not_required" && current.taskContract) {
        const kind = current.taskContract.kind;
        const hasValidators = (current.taskContract.requiredValidators ?? []).some((v) =>
          Boolean(v?.trim()),
        );
        if (kind !== "chat_turn" || hasValidators) {
          return {
            record: current,
            illegal: `invented_not_required:kind=${kind}`,
          };
        }
      }
      // Formal acceptance: refuse target success when structured modality is incomplete
      // / executor_unwired. Missing modality stays legacy-compatible (allow).
      if (
        transition.acceptance.status === "passed" ||
        transition.acceptance.status === "not_required"
      ) {
        const modality = current.capabilityModality;
        if (modality) {
          const assessed = assessTargetModalityAcceptance(modality);
          if (!assessed.targetModalitySucceeded) {
            return {
              record: current,
              illegal: `target_modality_not_accepted:${assessed.reason}`,
            };
          }
        }
      }
      stopRecovery = !transition.allowRetry && transition.acceptance.status === "failed";
      next = {
        ...next,
        acceptance: transition.acceptance,
        acceptanceEvidence: transition.evidence ?? current.acceptanceEvidence,
      };
      break;
    }
    case "mark_target_modality_completed": {
      if (current.fencingToken && transition.fencingToken !== current.fencingToken) {
        return { record: current, illegal: "stale_fencing" };
      }
      const modality = current.capabilityModality;
      if (!modality) {
        return { record: current, illegal: "missing_capability_modality" };
      }
      const digest = transition.evidence?.digestOrRef?.trim() ?? "";
      if (!digest) {
        return { record: current, illegal: "missing_execution_evidence" };
      }
      if (
        modality.executionStatus === "executor_unwired" ||
        modality.planFailureKind === "executor_unwired"
      ) {
        return { record: current, illegal: "cannot_complete_executor_unwired" };
      }
      if (
        modality.executionStatus === "no_executable_candidates" ||
        modality.planFailureKind === "no_executable_candidates"
      ) {
        return { record: current, illegal: "cannot_complete_no_executable_candidates" };
      }
      if (
        modality.executionStatus === "unsupported" ||
        modality.planFailureKind === "unsupported"
      ) {
        return { record: current, illegal: "cannot_complete_unsupported" };
      }
      const { incompleteReason: _dropIncomplete, ...modalityRest } = modality;
      next = {
        ...next,
        capabilityModality: {
          ...modalityRest,
          executionStatus: "completed",
          targetModalityCompleted: true,
        },
        reasonDetail: [
          current.reasonDetail,
          `target_modality_completed_via=${transition.evidence.kind}:${digest}`,
          transition.evidence.detail,
        ]
          .filter(Boolean)
          .join(" | "),
      };
      break;
    }
    case "set_task_contract": {
      if (current.fencingToken && transition.fencingToken !== current.fencingToken) {
        return { record: current, illegal: "stale_fencing" };
      }
      next = {
        ...next,
        taskContract: transition.taskContract,
        // Keep legacy version string aligned when identity is set.
        taskContractVersion: transition.taskContract.version || current.taskContractVersion,
      };
      break;
    }
    case "set_budget": {
      if (current.fencingToken && transition.fencingToken !== current.fencingToken) {
        return { record: current, illegal: "stale_fencing" };
      }
      next = {
        ...next,
        budget: transition.budget,
      };
      break;
    }
    case "accumulate_budget_spend": {
      if (current.fencingToken && transition.fencingToken !== current.fencingToken) {
        return { record: current, illegal: "stale_fencing" };
      }
      if (!current.budget) {
        return { record: current, illegal: "missing_budget" };
      }
      const nowMs = transition.nowMs ?? Date.parse(nowIso);
      next = {
        ...next,
        budget: accumulateTaskBudgetSpend(
          current.budget,
          { costUsd: transition.costUsd, iterations: transition.iterations },
          Number.isFinite(nowMs) ? nowMs : Date.now(),
        ),
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

    case "fail_closed": {
      if (
        current.fencingToken &&
        transition.fencingToken &&
        transition.fencingToken !== current.fencingToken
      ) {
        return { record: current, illegal: "stale_fencing" };
      }
      next = {
        ...next,
        reasonCode: transition.reasonCode,
        reasonDetail: transition.reasonDetail,
        lifecycle: "closed",
        taskJudgement: transition.reasonCode === "user_cancelled" ? "cancelled" : "failure",
      };
      // force closed below
      stopRecovery = true;
      prepareFailed =
        transition.reasonCode === "prepare_failed" ||
        transition.reasonCode === "preflight_rejected";
      cancelRequested = transition.reasonCode === "user_cancelled";
      break;
    }

    default:
      return { record: current, illegal: "illegal_transition" };
  }

  if (transition.type === "close_unconfirmed_delivery") {
    next.lifecycle = "closed";
    next.taskJudgement = "failure";
    next.reasonCode = "delivery_unconfirmed_close";
  } else if (transition.type === "fail_closed") {
    next.lifecycle = "closed";
    next.taskJudgement = transition.reasonCode === "user_cancelled" ? "cancelled" : "failure";
    next.reasonCode = transition.reasonCode;
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

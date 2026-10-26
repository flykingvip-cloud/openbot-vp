import { newFencingToken, TaskOutcomeResultService } from "../result-service.js";
import type { AcceptanceEvidence, AttemptResult, RunResult, TrustedScope } from "../types.js";

/**
 * Chat entry adapter: creates/restores taskId; never invents task-level success
 * from tool observations or placeholder messages.
 */
export class ChatTaskOutcomeAdapter {
  constructor(private readonly service: TaskOutcomeResultService) {}

  createOrRestore(params: {
    taskId: string;
    scope: TrustedScope;
    taskContractVersion: string;
    restoreIfExists?: boolean;
  }) {
    const existing = this.service.get(params.taskId);
    if (existing) {
      if (params.restoreIfExists) {
        return {
          ok: true as const,
          record: existing,
          fencingToken: existing.fencingToken ?? newFencingToken(),
        };
      }
      return {
        ok: true as const,
        record: existing,
        fencingToken: existing.fencingToken ?? newFencingToken(),
      };
    }
    const fencingToken = newFencingToken();
    const res = this.service.submit(params.taskId, {
      type: "create",
      entrypoint: "chat",
      scope: params.scope,
      taskContractVersion: params.taskContractVersion,
    });
    if (!res.ok) {
      return res;
    }
    // bind fencing on first attempt path
    return { ok: true as const, record: res.record, fencingToken };
  }

  /** preflight only inherits/validates — reject without forging run/attempt */
  rejectBeforePreflight(taskId: string, reasonDetail: string) {
    return this.service.submit(taskId, {
      type: "prepare_failed",
      reasonCode: "preflight_rejected",
      reasonDetail,
    });
  }

  recordAttempt(
    taskId: string,
    expectedVersion: number,
    fencingToken: string,
    attempt: AttemptResult,
    run: RunResult,
  ) {
    return this.service.submit(taskId, {
      type: "record_attempt",
      attempt,
      run: { ...run, fencingToken },
      expectedVersion,
      fencingToken,
    });
  }

  /** Message placeholder observations must NOT call set_delivery(delivered). */
  observePlaceholderMessage(_taskId: string, _messageId: string): void {
    // intentionally no TaskOutcome mutation
  }

  setAcceptance(
    taskId: string,
    expectedVersion: number,
    fencingToken: string,
    acceptance:
      | { status: "pending" | "passed" | "failed" }
      | { status: "not_required"; reason: string },
    opts: { allowRetry: boolean; evidence?: AcceptanceEvidence[] },
  ) {
    return this.service.submit(taskId, {
      type: "set_acceptance",
      acceptance,
      evidence: opts.evidence,
      allowRetry: opts.allowRetry,
      expectedVersion,
      fencingToken,
    });
  }

  setDelivery(
    taskId: string,
    expectedVersion: number,
    fencingToken: string,
    delivery:
      | { status: "pending" | "blocked" | "delivered" | "delivery_unknown" | "failed" }
      | { status: "not_required"; reason: string },
    deliveryId?: string,
  ) {
    return this.service.submit(taskId, {
      type: "set_delivery",
      delivery,
      deliveryId,
      expectedVersion,
      fencingToken,
    });
  }

  cancel(taskId: string, expectedVersion: number, fencingToken?: string) {
    return this.service.submit(taskId, {
      type: "cancel",
      expectedVersion,
      fencingToken,
    });
  }
}

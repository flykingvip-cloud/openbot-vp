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
    commandId?: string;
  }) {
    const existing = this.service.get(params.taskId);
    if (existing) {
      const mismatch = this.service.assertScope(params.taskId, params.scope);
      if (mismatch) {
        return mismatch;
      }
      return {
        ok: true as const,
        record: existing,
        fencingToken: existing.fencingToken ?? newFencingToken(),
      };
    }
    const fencingToken = newFencingToken();
    const res = this.service.submit(
      params.taskId,
      {
        type: "create",
        entrypoint: "chat",
        scope: params.scope,
        taskContractVersion: params.taskContractVersion,
      },
      { commandId: params.commandId, requiredScope: params.scope },
    );
    if (!res.ok) {
      return res;
    }
    return { ok: true as const, record: res.record, fencingToken };
  }

  rejectBeforePreflight(taskId: string, reasonDetail: string, scope: TrustedScope) {
    return this.service.submit(
      taskId,
      {
        type: "prepare_failed",
        reasonCode: "preflight_rejected",
        reasonDetail,
      },
      { requiredScope: scope },
    );
  }

  recordAttempt(
    taskId: string,
    expectedVersion: number,
    fencingToken: string,
    attempt: AttemptResult,
    run: RunResult,
    opts?: { scope: TrustedScope; commandId?: string },
  ) {
    if (!opts?.scope) {
      return {
        ok: false as const,
        code: "scope_mismatch" as const,
        message: "requiredScope is mandatory for existing tasks",
      };
    }
    return this.service.submit(
      taskId,
      {
        type: "record_attempt",
        attempt,
        run: { ...run, fencingToken },
        expectedVersion,
        fencingToken,
      },
      { requiredScope: opts.scope, commandId: opts.commandId },
    );
  }

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
    opts: {
      allowRetry: boolean;
      evidence?: AcceptanceEvidence[];
      scope: TrustedScope;
      commandId?: string;
    },
  ) {
    return this.service.submit(
      taskId,
      {
        type: "set_acceptance",
        acceptance,
        evidence: opts.evidence,
        allowRetry: opts.allowRetry,
        expectedVersion,
        fencingToken,
      },
      { requiredScope: opts.scope, commandId: opts.commandId },
    );
  }

  setDelivery(
    taskId: string,
    expectedVersion: number,
    fencingToken: string,
    delivery:
      | { status: "pending" | "blocked" | "delivered" | "delivery_unknown" | "failed" }
      | { status: "not_required"; reason: string },
    deliveryId?: string,
    opts?: { scope: TrustedScope; commandId?: string },
  ) {
    if (!opts?.scope) {
      return {
        ok: false as const,
        code: "scope_mismatch" as const,
        message: "requiredScope is mandatory for existing tasks",
      };
    }
    return this.service.submit(
      taskId,
      {
        type: "set_delivery",
        delivery,
        deliveryId,
        expectedVersion,
        fencingToken,
      },
      { requiredScope: opts.scope, commandId: opts.commandId },
    );
  }

  cancel(
    taskId: string,
    expectedVersion: number,
    fencingToken?: string,
    opts?: { scope: TrustedScope; commandId?: string; reasonDetail?: string },
  ) {
    if (!opts?.scope) {
      return {
        ok: false as const,
        code: "scope_mismatch" as const,
        message: "requiredScope is mandatory for existing tasks",
      };
    }
    return this.service.submit(
      taskId,
      {
        type: "cancel",
        expectedVersion,
        fencingToken,
        reasonDetail: opts.reasonDetail,
      },
      { requiredScope: opts.scope, commandId: opts.commandId },
    );
  }

  failClosed(
    taskId: string,
    expectedVersion: number,
    reasonCode:
      | "run_failed"
      | "user_cancelled"
      | "provider_fault"
      | "user_filtered"
      | "timeout"
      | "authz_denied"
      | "prepare_failed"
      | "other",
    opts?: {
      fencingToken?: string;
      reasonDetail?: string;
      scope: TrustedScope;
      commandId?: string;
    },
  ) {
    if (!opts?.scope) {
      return {
        ok: false as const,
        code: "scope_mismatch" as const,
        message: "requiredScope is mandatory for existing tasks",
      };
    }
    return this.service.submit(
      taskId,
      {
        type: "fail_closed",
        reasonCode,
        reasonDetail: opts.reasonDetail,
        expectedVersion,
        fencingToken: opts.fencingToken,
      },
      { requiredScope: opts.scope, commandId: opts.commandId },
    );
  }
}

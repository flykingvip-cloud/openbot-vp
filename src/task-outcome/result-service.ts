import { createHash, randomUUID } from "node:crypto";
import { computeEvaluationEligibility } from "./eligibility.js";
import { DurableTaskOutcomeStore } from "./store.js";
import { applyTransition, evidenceStillValid, scopeIdOf } from "./transitions.js";
import type {
  OutcomeOutboxEvent,
  OutcomeEventType,
  SubmitResult,
  SubmitTransition,
  TaskOutcomeRecord,
  TrustedScope,
} from "./types.js";

export type ResultServiceOptions = {
  store: DurableTaskOutcomeStore;
  submittedBy?: string;
  now?: () => Date;
};

function eventIdFor(taskId: string, outcomeVersion: number, eventType: OutcomeEventType): string {
  const h = createHash("sha256")
    .update(`${taskId}|${outcomeVersion}|${eventType}`)
    .digest("hex")
    .slice(0, 32);
  return `evt_${h}`;
}

function outboxEvent(record: TaskOutcomeRecord, eventType: OutcomeEventType): OutcomeOutboxEvent {
  return {
    eventId: eventIdFor(record.taskId, record.outcomeVersion, eventType),
    taskId: record.taskId,
    outcomeVersion: record.outcomeVersion,
    eventType,
    scopeKind: record.scope.kind,
    scopeId: scopeIdOf(record.scope),
    payloadRef: `task:${record.taskId}@${record.outcomeVersion}`,
    createdAt: record.updatedAt,
  };
}

export class TaskOutcomeResultService {
  private readonly store: DurableTaskOutcomeStore;
  private readonly submittedBy: string;
  private readonly now: () => Date;

  constructor(opts: ResultServiceOptions) {
    this.store = opts.store;
    this.submittedBy = opts.submittedBy ?? "task-outcome-result-service";
    this.now = opts.now ?? (() => new Date());
  }

  get(taskId: string): TaskOutcomeRecord | undefined {
    return this.store.loadTask(taskId);
  }

  /**
   * Idempotent submit: identical transition payload at same expectedVersion
   * returns the same stored record without bumping version.
   */
  submit(taskId: string, transition: SubmitTransition): SubmitResult {
    const current = this.store.loadTask(taskId);
    const nowIso = this.now().toISOString();

    if ("expectedVersion" in transition && transition.type !== "create") {
      if (!current) {
        return { ok: false, code: "not_found", message: `task ${taskId} not found` };
      }
      if (current.outcomeVersion !== transition.expectedVersion) {
        // Idempotent replay: if transition would yield same semantic state already applied
        if (
          current.outcomeVersion > transition.expectedVersion &&
          isSameEffect(current, transition)
        ) {
          return { ok: true, record: current, createdEvents: [] };
        }
        return {
          ok: false,
          code: "version_conflict",
          message: `expected ${transition.expectedVersion}, have ${current.outcomeVersion}`,
          current,
        };
      }
    }

    if (transition.type === "correction") {
      if (!transition.authorizedBy || !transition.previousOutcomeVersion) {
        return {
          ok: false,
          code: "unauthorized_correction",
          message: "correction requires authorizedBy and previousOutcomeVersion",
          current: current,
        };
      }
      if (!current || current.outcomeVersion !== transition.previousOutcomeVersion) {
        return {
          ok: false,
          code: "version_conflict",
          message: "correction previousOutcomeVersion mismatch",
          current,
        };
      }
    }

    if (
      transition.type === "set_acceptance" &&
      transition.evidence &&
      current?.acceptanceEvidence &&
      !evidenceStillValid(transition.evidence, transition.evidence[0]?.artifactDigestOrReceiptRef)
    ) {
      // no-op check placeholder
    }

    const applied = applyTransition(current, taskId, transition, nowIso, this.submittedBy);
    if (applied.illegal === "not_found") {
      return { ok: false, code: "not_found", message: `task ${taskId} not found` };
    }
    if (applied.illegal === "terminal_protected") {
      return {
        ok: false,
        code: "terminal_protected",
        message: "closed outcomes cannot be rewritten by ordinary executors",
        current,
      };
    }
    if (applied.illegal === "stale_fencing") {
      return {
        ok: false,
        code: "stale_fencing",
        message: "fencing token expired or revoked",
        current,
      };
    }
    if (applied.illegal) {
      return {
        ok: false,
        code: "illegal_transition",
        message: applied.illegal,
        current,
      };
    }

    const record = {
      ...applied.record,
      outcomeVersion: transition.type === "create" ? 1 : (current?.outcomeVersion ?? 0) + 1,
      previousOutcomeVersion: transition.type === "create" ? undefined : current?.outcomeVersion,
      revisionKind: transition.type === "correction" ? "correction" : "new_execution",
    } satisfies TaskOutcomeRecord;

    // Same-submit idempotency: hash last transition effect
    if (
      current &&
      semanticallyEqualForIdempotency(current, record) &&
      transition.type !== "create"
    ) {
      return { ok: true, record: current, createdEvents: [] };
    }

    const events: OutcomeOutboxEvent[] = [];
    const eventType: OutcomeEventType =
      transition.type === "create"
        ? "task.created"
        : transition.type === "correction"
          ? "task.corrected"
          : record.lifecycle === "closed"
            ? "task.closed"
            : "task.state_changed";
    events.push(outboxEvent(record, eventType));

    // Persist task + outbox (same logical transaction via sequential atomic writes;
    // recovery replays pending outbox).
    this.store.saveTask(record);
    for (const ev of events) {
      this.store.appendOutbox(ev);
    }

    return { ok: true, record, createdEvents: events };
  }

  assertScope(taskId: string, scope: TrustedScope): SubmitResult | null {
    const cur = this.store.loadTask(taskId);
    if (!cur) {
      return null;
    }
    if (scopeIdOf(cur.scope) !== scopeIdOf(scope) || cur.scope.kind !== scope.kind) {
      return {
        ok: false,
        code: "scope_mismatch",
        message: "trusted scope mismatch",
        current: cur,
      };
    }
    return null;
  }

  /** Invalidate acceptance when artifact digest changes. */
  invalidateAcceptanceIfArtifactChanged(
    taskId: string,
    newDigest: string,
    expectedVersion: number,
    fencingToken: string,
  ): SubmitResult {
    const cur = this.store.loadTask(taskId);
    if (!cur) {
      return { ok: false, code: "not_found", message: "missing" };
    }
    if (!evidenceStillValid(cur.acceptanceEvidence, newDigest)) {
      return this.submit(taskId, {
        type: "set_acceptance",
        acceptance: { status: "pending" },
        evidence: [],
        allowRetry: true,
        expectedVersion,
        fencingToken,
      });
    }
    return { ok: true, record: cur, createdEvents: [] };
  }

  eligibility(taskId: string) {
    const cur = this.store.loadTask(taskId);
    if (!cur) {
      return undefined;
    }
    return computeEvaluationEligibility(cur);
  }
}

function isSameEffect(current: TaskOutcomeRecord, transition: SubmitTransition): boolean {
  if (transition.type === "cancel" && current.taskJudgement === "cancelled") {
    return true;
  }
  if (
    transition.type === "set_delivery" &&
    current.delivery.status === transition.delivery.status &&
    current.deliveryId === (transition.deliveryId ?? current.deliveryId)
  ) {
    return true;
  }
  return false;
}

function semanticallyEqualForIdempotency(a: TaskOutcomeRecord, b: TaskOutcomeRecord): boolean {
  return (
    a.lifecycle === b.lifecycle &&
    a.taskJudgement === b.taskJudgement &&
    a.acceptance.status === b.acceptance.status &&
    a.delivery.status === b.delivery.status &&
    a.decisiveRunId === b.decisiveRunId &&
    a.reasonCode === b.reasonCode &&
    a.capabilityModality?.executionStatus === b.capabilityModality?.executionStatus &&
    a.capabilityModality?.targetModalityCompleted === b.capabilityModality?.targetModalityCompleted
  );
}

export function newFencingToken(): string {
  return `ft_${randomUUID()}`;
}

import { createHash, randomUUID } from "node:crypto";
import { computeEvaluationEligibility } from "./eligibility.js";
import { DurableTaskOutcomeStore } from "./store.js";
import { applyTransition, evidenceStillValid, scopeIdOf } from "./transitions.js";
import type {
  OutcomeOutboxEvent,
  OutcomeEventType,
  SubmitFailure,
  SubmitResult,
  SubmitTransition,
  TaskOutcomeRecord,
  TrustedScope,
} from "./types.js";

export type ResultServiceOptions = {
  store: DurableTaskOutcomeStore;
  submittedBy?: string;
  now?: () => Date;
  /** Trusted correction principals (subject refs). Empty = corrections rejected. */
  correctionAllowlist?: ReadonlySet<string> | readonly string[];
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
    // Point at immutable version snapshot, not mutable tip.
    payloadRef: `version:${record.taskId}@${record.outcomeVersion}`,
    createdAt: record.updatedAt,
  };
}

function digestTransition(taskId: string, transition: SubmitTransition): string {
  return createHash("sha256").update(JSON.stringify({ taskId, transition })).digest("hex");
}

function attemptFingerprint(record: TaskOutcomeRecord): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        attempts: record.attempts,
        runs: record.runs,
        acceptance: record.acceptance,
        acceptanceEvidence: record.acceptanceEvidence ?? [],
        delivery: record.delivery,
        deliveryId: record.deliveryId ?? null,
        fencingToken: record.fencingToken ?? null,
        leaseEpoch: record.leaseEpoch ?? 0,
        decisiveRunId: record.decisiveRunId ?? null,
        reasonCode: record.reasonCode ?? null,
        lifecycle: record.lifecycle,
        taskJudgement: record.taskJudgement,
        // P1: modality mark must not be treated as a no-op fingerprint.
        capabilityModalityExecutionStatus: record.capabilityModality?.executionStatus ?? null,
        capabilityModalityTargetCompleted:
          record.capabilityModality?.targetModalityCompleted ?? null,
        reasonDetail: record.reasonDetail ?? null,
        // W3: budget / taskContract must not be treated as no-op fingerprints.
        taskContractKind: record.taskContract?.kind ?? null,
        taskContractId: record.taskContract?.id ?? null,
        budgetSpent: record.budget?.spentCostUsd ?? null,
        budgetIterations: record.budget?.iterationCount ?? null,
        budgetMaxCost: record.budget?.maxCostUsd ?? null,
        budgetMaxIterations: record.budget?.maxIterations ?? null,
      }),
    )
    .digest("hex");
}

export class TaskOutcomeResultService {
  private readonly store: DurableTaskOutcomeStore;
  private readonly submittedBy: string;
  private readonly now: () => Date;
  private readonly correctionAllowlist: Set<string>;

  constructor(opts: ResultServiceOptions) {
    this.store = opts.store;
    this.submittedBy = opts.submittedBy ?? "task-outcome-result-service";
    this.now = opts.now ?? (() => new Date());
    this.correctionAllowlist = new Set(
      opts.correctionAllowlist ? [...opts.correctionAllowlist] : [],
    );
  }

  get(taskId: string): TaskOutcomeRecord | undefined {
    return this.store.loadTask(taskId);
  }

  getVersion(taskId: string, version: number): TaskOutcomeRecord | undefined {
    return this.store.loadTaskVersion(taskId, version);
  }

  /**
   * Idempotent submit under per-task exclusive lock + single commit boundary.
   * Optional commandId: same id+digest replays; same id different digest → command_conflict.
   */
  submit(
    taskId: string,
    transition: SubmitTransition,
    opts?: {
      commandId?: string;
      requiredScope?: TrustedScope;
      /** Verified caller subject; corrections must use this as authorizedBy. */
      callerSubjectRef?: string;
    },
  ): SubmitResult {
    return this.store.withTaskLock(taskId, () => this.submitLocked(taskId, transition, opts));
  }

  private submitLocked(
    taskId: string,
    transition: SubmitTransition,
    opts?: {
      commandId?: string;
      requiredScope?: TrustedScope;
      callerSubjectRef?: string;
    },
  ): SubmitResult {
    const current = this.store.loadTask(taskId);
    const nowIso = this.now().toISOString();

    if (current) {
      if (!opts?.requiredScope) {
        return {
          ok: false,
          code: "scope_mismatch",
          message: "requiredScope is mandatory for existing tasks",
          current,
        };
      }
      const mismatch = this.assertScope(taskId, opts.requiredScope);
      if (mismatch) {
        return mismatch;
      }
    }

    if (opts?.commandId) {
      const digest = digestTransition(taskId, transition);
      const prior = this.store.loadCommand(opts.commandId);
      if (prior) {
        if (prior.digest !== digest) {
          return {
            ok: false,
            code: "command_conflict",
            message: `commandId ${opts.commandId} reused with different payload`,
            current,
          };
        }
        const historical =
          this.store.loadTaskVersion(prior.taskId, prior.outcomeVersion) ??
          this.store.loadTask(prior.taskId);
        if (historical) {
          return { ok: true, record: historical, createdEvents: [] };
        }
      }
    }

    if ("expectedVersion" in transition) {
      if (!current) {
        return { ok: false, code: "not_found", message: `task ${taskId} not found` };
      }
      if (current.outcomeVersion !== transition.expectedVersion) {
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
          current,
        };
      }
      const caller = opts?.callerSubjectRef?.trim();
      if (!caller) {
        return {
          ok: false,
          code: "unauthorized_correction",
          message: "correction requires verified callerSubjectRef",
          current,
        };
      }
      if (transition.authorizedBy !== caller) {
        return {
          ok: false,
          code: "unauthorized_correction",
          message: "authorizedBy does not match verified callerSubjectRef",
          current,
        };
      }
      if (!this.correctionAllowlist.has(caller)) {
        return {
          ok: false,
          code: "unauthorized_correction",
          message: "callerSubjectRef is not in trusted correction allowlist",
          current,
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

    if (
      current &&
      transition.type !== "create" &&
      attemptFingerprint(current) === attemptFingerprint(record)
    ) {
      return { ok: true, record: current, createdEvents: [] };
    }

    const eventType: OutcomeEventType =
      transition.type === "create"
        ? "task.created"
        : transition.type === "correction"
          ? "task.corrected"
          : record.lifecycle === "closed"
            ? "task.closed"
            : "task.state_changed";
    const events: OutcomeOutboxEvent[] = [outboxEvent(record, eventType)];

    const expectedVersion = transition.type === "create" ? 0 : (current?.outcomeVersion ?? 0);
    const committed = this.store.commitBundle({
      taskId,
      expectedVersion,
      record,
      events,
      ...(opts?.commandId
        ? {
            commandLog: {
              commandId: opts.commandId,
              digest: digestTransition(taskId, transition),
              taskId,
              outcomeVersion: record.outcomeVersion,
            },
          }
        : {}),
    });
    if (!committed.ok) {
      return {
        ok: false,
        code: "version_conflict",
        message: "commit lost race under lock",
        current: committed.current,
      };
    }

    return { ok: true, record, createdEvents: events };
  }

  assertScope(taskId: string, scope: TrustedScope): SubmitFailure | null {
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
    if (cur.scope.subjectRef !== scope.subjectRef) {
      return {
        ok: false,
        code: "scope_mismatch",
        message: "trusted subject mismatch",
        current: cur,
      };
    }
    return null;
  }

  invalidateAcceptanceIfArtifactChanged(
    taskId: string,
    newDigest: string,
    expectedVersion: number,
    fencingToken: string,
    opts?: { requiredScope?: TrustedScope; commandId?: string },
  ): SubmitResult {
    const cur = this.store.loadTask(taskId);
    if (!cur) {
      return { ok: false, code: "not_found", message: "missing" };
    }
    if (!evidenceStillValid(cur.acceptanceEvidence, newDigest)) {
      return this.submit(
        taskId,
        {
          type: "set_acceptance",
          acceptance: { status: "pending" },
          evidence: [],
          allowRetry: true,
          expectedVersion,
          fencingToken,
        },
        opts,
      );
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

export function newFencingToken(): string {
  return `ft_${randomUUID()}`;
}

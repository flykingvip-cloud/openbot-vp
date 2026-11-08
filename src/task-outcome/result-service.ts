import { createHash, randomUUID } from "node:crypto";
import { snapshotIdentityFingerprint } from "../executor-evidence/identity.js";
import { computeEvaluationEligibility } from "./eligibility.js";
import { DurableTaskOutcomeStore } from "./store.js";
import { applyTransition, evidenceStillValid, scopeIdOf } from "./transitions.js";
import type {
  BudgetCallBinding,
  CommandEvidenceGap,
  CommandReceipt,
  CommittedSpend,
  OutcomeOutboxEvent,
  OutcomeEventType,
  SubmitFailure,
  SubmitResult,
  SubmitTransition,
  TaskOutcomeRecord,
  TrustedScope,
} from "./types.js";

function sameCommittedSpend(left: CommittedSpend | null, right: CommittedSpend | null): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.iterations === right.iterations &&
    left.costUsd === right.costUsd &&
    left.costEvidence === right.costEvidence
  );
}

function sameCallBinding(left: BudgetCallBinding | null, right: BudgetCallBinding | null): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.callId === right.callId &&
    left.evidenceId === right.evidenceId &&
    left.usageFingerprint === right.usageFingerprint
  );
}

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

/** Idempotency digest. The same transition with a different call binding is not a replay. */
function digestCommand(transitionDigest: string, callBinding?: BudgetCallBinding | null): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        transitionDigest,
        callBinding: callBinding
          ? {
              callId: callBinding.callId,
              evidenceId: callBinding.evidenceId,
              usageFingerprint: callBinding.usageFingerprint,
            }
          : null,
      }),
    )
    .digest("hex");
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
        budgetUnknownCostCharges: record.budget?.unknownCostCharges ?? null,
        budgetKnownZeroCostCharges: record.budget?.knownZeroCostCharges ?? null,
        budgetChildAttributedCostUsd: record.budget?.childAttributedCostUsd ?? null,
        budgetChildAttributedIterations: record.budget?.childAttributedIterations ?? null,
        // W4: experience exposure attach must not be treated as a no-op fingerprint.
        experienceExposureScopes: (record.experienceExposure?.scopes ?? []).map((scope) => ({
          scopeId: scope.scopeId,
          botId: scope.botId,
          assetIds: [...scope.assetIds].toSorted(),
        })),
        // Residual: explicit adopted changes must bump tip (verified contribution is off-tip).
        experienceAdoptedAssetIds: [
          ...(record.experienceExposure?.adoptedAssetIds ?? []),
        ].toSorted(),
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
      /** Present only for a model-call budget charge. Included in the idempotency digest. */
      callBinding?: BudgetCallBinding;
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
      callBinding?: BudgetCallBinding;
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

    const commandId = opts?.commandId;
    const transitionDigest = commandId ? digestTransition(taskId, transition) : undefined;
    const requestDigest =
      commandId && transitionDigest
        ? digestCommand(transitionDigest, opts?.callBinding ?? null)
        : undefined;
    if (commandId && requestDigest && transitionDigest) {
      const prior = this.store.loadCommand(commandId);
      if (prior) {
        const legacySamePayload =
          !prior.transitionDigest &&
          !prior.callBinding &&
          !opts?.callBinding &&
          prior.digest === transitionDigest;
        if (prior.digest !== requestDigest && !legacySamePayload) {
          const sameTransition = prior.transitionDigest
            ? prior.transitionDigest === transitionDigest
            : prior.digest === transitionDigest;
          const bindingConflict =
            sameTransition && !sameCallBinding(prior.callBinding, opts?.callBinding ?? null);
          return {
            ok: false,
            code: "command_conflict",
            message: bindingConflict
              ? "call_binding_conflict"
              : `commandId ${commandId} reused with different payload`,
            current,
            commandConflict: {
              commandId,
              taskId: prior.taskId,
              storedDigest: prior.digest,
              requestDigest,
              storedOutcomeVersion: prior.outcomeVersion,
              storedCommitId: prior.commitId,
              storedSpend: prior.committedSpend,
              reason: bindingConflict ? "call_binding_conflict" : "payload_conflict",
              storedCallBinding: prior.callBinding,
            },
          };
        }
        // Exact replay uses the command's own version. Never substitute the tip.
        const historical = this.store.loadTaskVersion(prior.taskId, prior.outcomeVersion);
        const refused = this.refuseInconsistentReplay(commandId, prior, historical, current);
        if (refused) {
          return refused;
        }
        return {
          ok: true,
          record: historical!,
          createdEvents: [],
          committedSpend: prior.committedSpend,
          commandReceipt: this.buildCommandReceipt({
            commandId,
            taskId: prior.taskId,
            outcomeVersion: prior.outcomeVersion,
            requestDigest: prior.digest,
            disposition: "replayed",
            commitId: prior.commitId,
          }),
        };
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
          return this.noEffect(current, commandId, requestDigest);
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
      return this.noEffect(current, commandId, requestDigest);
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
              digest: requestDigest,
              transitionDigest,
              taskId,
              outcomeVersion: record.outcomeVersion,
              snapshotFingerprint: snapshotIdentityFingerprint(record),
              commandDisposition: "applied" as const,
              ...(opts?.callBinding ? { callBinding: opts.callBinding } : {}),
              ...(transition.type === "accumulate_budget_spend"
                ? {
                    committedSpend: {
                      iterations:
                        typeof transition.iterations === "number" && transition.iterations > 0
                          ? Math.floor(transition.iterations)
                          : 0,
                      costUsd:
                        typeof transition.costUsd === "number" &&
                        Number.isFinite(transition.costUsd)
                          ? transition.costUsd
                          : null,
                      costEvidence: transition.costEvidence ?? null,
                    } satisfies CommittedSpend,
                  }
                : {}),
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

    return {
      ok: true,
      record,
      createdEvents: events,
      ...(commandId && requestDigest
        ? {
            committedSpend:
              transition.type === "accumulate_budget_spend"
                ? {
                    iterations:
                      typeof transition.iterations === "number" && transition.iterations > 0
                        ? Math.floor(transition.iterations)
                        : 0,
                    costUsd:
                      typeof transition.costUsd === "number" && Number.isFinite(transition.costUsd)
                        ? transition.costUsd
                        : null,
                    costEvidence: transition.costEvidence ?? null,
                  }
                : null,
            commandReceipt: this.buildCommandReceipt({
              commandId,
              taskId,
              outcomeVersion: record.outcomeVersion,
              requestDigest,
              disposition: "applied",
              commitId: committed.commitId,
            }),
          }
        : {}),
    };
  }

  /** Refuse a replay whose log, snapshot body, and commit bundle disagree. */
  private refuseInconsistentReplay(
    commandId: string,
    prior: {
      digest: string;
      taskId: string;
      outcomeVersion: number;
      commitId: string | null;
      snapshotFingerprint: string | null;
      committedSpend: CommittedSpend | null;
      callBinding: BudgetCallBinding | null;
    },
    historical: TaskOutcomeRecord | undefined,
    current: TaskOutcomeRecord | undefined,
  ): SubmitResult | null {
    const gap = (reason: CommandEvidenceGap["reason"], message: string): SubmitResult => ({
      ok: false,
      code: "evidence_missing",
      message,
      current,
      evidenceGap: {
        schemaVersion: 1,
        commandId,
        taskId: prior.taskId,
        outcomeVersion: prior.outcomeVersion,
        requestDigest: prior.digest,
        reason,
      },
    });
    if (!historical) {
      return gap(
        "version_snapshot_missing",
        `command ${commandId} version ${prior.outcomeVersion} snapshot is missing`,
      );
    }
    if (!prior.snapshotFingerprint) {
      return gap(
        "snapshot_fingerprint_absent",
        `command ${commandId} has no snapshot fingerprint and cannot be an exact replay`,
      );
    }
    if (
      historical.taskId !== prior.taskId ||
      historical.outcomeVersion !== prior.outcomeVersion ||
      snapshotIdentityFingerprint(historical) !== prior.snapshotFingerprint
    ) {
      return gap(
        "snapshot_identity_mismatch",
        `command ${commandId} snapshot body does not match the committed identity`,
      );
    }
    if (prior.commitId) {
      const bundle = this.store.loadCommitBundle(prior.commitId);
      const logged = bundle?.commandLog;
      if (
        !bundle ||
        bundle.commitId !== prior.commitId ||
        bundle.taskId !== prior.taskId ||
        bundle.record.taskId !== prior.taskId ||
        bundle.record.outcomeVersion !== prior.outcomeVersion ||
        logged?.commandId !== commandId ||
        logged?.digest !== prior.digest ||
        snapshotIdentityFingerprint(bundle.record) !== prior.snapshotFingerprint ||
        !sameCommittedSpend(logged?.committedSpend ?? null, prior.committedSpend) ||
        !sameCallBinding(logged?.callBinding ?? null, prior.callBinding)
      ) {
        return gap(
          "commit_identity_mismatch",
          `command ${commandId} commit ${prior.commitId} does not match the log`,
        );
      }
    }
    return null;
  }

  private buildCommandReceipt(args: {
    commandId: string;
    taskId: string;
    outcomeVersion: number;
    requestDigest: string;
    disposition: CommandReceipt["disposition"];
    commitId: string | null;
  }): CommandReceipt {
    return { schemaVersion: 1, ...args };
  }

  /** Same observable effect, no new commit and no forged command log. */
  private noEffect(
    current: TaskOutcomeRecord,
    commandId: string | undefined,
    requestDigest: string | undefined,
  ): SubmitResult {
    if (!commandId || !requestDigest) {
      return { ok: true, record: current, createdEvents: [] };
    }
    return {
      ok: true,
      record: current,
      createdEvents: [],
      commandReceipt: this.buildCommandReceipt({
        commandId,
        taskId: current.taskId,
        outcomeVersion: current.outcomeVersion,
        requestDigest,
        disposition: "no_effect",
        commitId: null,
      }),
    };
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
    const unchanged = {
      type: "set_acceptance" as const,
      acceptance: { status: "pending" as const },
      evidence: [],
      allowRetry: true,
      expectedVersion,
      fencingToken,
    };
    return this.noEffect(cur, opts?.commandId, digestTransition(taskId, unchanged));
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

import fs from "node:fs";
import path from "node:path";
import { computeEvaluationEligibility } from "./eligibility.js";
import type { DurableTaskOutcomeStore, DurableProjection } from "./store.js";
import { scopeIdOf } from "./transitions.js";
import type { OutcomeOutboxEvent, TaskOutcomeRecord } from "./types.js";

export type ContributionProjection = DurableProjection;

export type ConsumerHandler = {
  consumerId: string;
  /** May be async; drain awaits and only markConsumed after resolve (failure ⇒ retry). */
  onEvent: (event: OutcomeOutboxEvent, record: TaskOutcomeRecord) => void | Promise<void>;
};

export const GROWTH_EVOLUTION_CONSUMER_ID = "growth-evolution";
export const SKILL_CONSUMER_ID = "skill-quality";
export const MODE_CONSUMER_ID = "mode-quality";

export type ContributionRecord = {
  outcomeVersion: number;
  judgement: string;
  eligibilityAttribution: string;
  taskId: string;
  /** Actual projection deltas applied at consume time (survives rebuild). */
  countedSuccess: boolean;
  countedFailure: boolean;
  countedCancelled: boolean;
};

/**
 * Reliable consume with durable projection.
 * Dedupe by consumerId+eventId; handlers ack independently of the main consumer.
 * Projection is always rebuilt from contributions on boot (closes dual-write gap).
 */
export class OutcomeConsumerRuntime {
  private readonly store: DurableTaskOutcomeStore;
  private readonly consumerId: string;
  private readonly handlers: ConsumerHandler[];
  private projection: ContributionProjection;

  constructor(
    store: DurableTaskOutcomeStore,
    opts?: { consumerId?: string; handlers?: ConsumerHandler[] },
  ) {
    this.store = store;
    this.consumerId = opts?.consumerId ?? GROWTH_EVOLUTION_CONSUMER_ID;
    this.handlers = opts?.handlers ?? [];
    // Always rebuild from contributions so crash between contribution and projection cannot leak.
    this.projection = this.rebuildProjectionFromContributions();
  }

  getProjection(): ContributionProjection {
    return { ...this.projection, applied: [...this.projection.applied] };
  }

  /** Rebuild exact counts from durable contribution files using recorded count flags. */
  rebuildProjectionFromContributions(): ContributionProjection {
    const next: ContributionProjection = {
      successCount: 0,
      failureCount: 0,
      cancelledCount: 0,
      applied: [],
    };
    const contribDir = path.join(this.store.rootDir, "contributions");
    if (fs.existsSync(contribDir)) {
      for (const name of fs.readdirSync(contribDir)) {
        if (!name.endsWith(".json")) {
          continue;
        }
        const raw = JSON.parse(
          fs.readFileSync(path.join(contribDir, name), "utf8"),
        ) as Partial<ContributionRecord> & {
          outcomeVersion: number;
          judgement: string;
          eligibilityAttribution?: string;
          taskId?: string;
        };
        const taskId =
          raw.taskId ??
          decodeURIComponent(
            name
              .replace(/\.json$/, "")
              .split("__")
              .slice(1)
              .join("__"),
          );
        // Prefer recorded count flags; legacy files fall back to judgement without eligibility (conservative: no success/failure count unless flags present).
        const countedSuccess = raw.countedSuccess === true;
        const countedFailure = raw.countedFailure === true;
        const countedCancelled =
          raw.countedCancelled === true ||
          (raw.countedSuccess === undefined &&
            raw.countedFailure === undefined &&
            raw.judgement === "cancelled");
        if (countedSuccess) {
          next.successCount += 1;
        }
        if (countedFailure) {
          next.failureCount += 1;
        }
        if (countedCancelled) {
          next.cancelledCount += 1;
        }
        next.applied.push({
          taskId,
          outcomeVersion: raw.outcomeVersion,
          judgement: raw.judgement,
        });
      }
    }
    this.projection = next;
    this.store.saveProjection(this.consumerId, next);
    return this.getProjection();
  }

  async drain(loadRecord: (taskId: string) => TaskOutcomeRecord | undefined): Promise<{
    processed: number;
    skippedDup: number;
    deferred: number;
  }> {
    let processed = 0;
    let skippedDup = 0;
    let deferred = 0;
    for (const event of this.store.listPendingOutbox()) {
      const record =
        this.store.loadTaskVersion(event.taskId, event.outcomeVersion) ?? loadRecord(event.taskId);
      if (!record) {
        continue;
      }
      const versioned = this.store.loadTaskVersion(event.taskId, event.outcomeVersion) ?? record;

      // Contribution / main projection consumer
      if (!this.store.hasConsumed(this.consumerId, event.eventId)) {
        this.applyContribution(this.consumerId, event, versioned);
      }

      let handlersComplete = true;
      for (const h of this.handlers) {
        if (this.store.hasConsumed(h.consumerId, event.eventId)) {
          continue;
        }
        try {
          await Promise.resolve(h.onEvent(event, versioned));
          this.store.markConsumed(h.consumerId, event.eventId, {
            outcomeVersion: event.outcomeVersion,
          });
        } catch {
          handlersComplete = false;
          deferred += 1;
          break;
        }
      }

      // Main consumer ack only after contribution applied; outbox done only when ALL handlers acked.
      if (!this.store.hasConsumed(this.consumerId, event.eventId)) {
        this.store.markConsumed(this.consumerId, event.eventId, {
          outcomeVersion: event.outcomeVersion,
        });
      }

      const allHandlersAcked = this.handlers.every((h) =>
        this.store.hasConsumed(h.consumerId, event.eventId),
      );
      if (handlersComplete && allHandlersAcked) {
        this.store.markOutboxDone(event.eventId);
        processed += 1;
      } else if (this.store.hasConsumed(this.consumerId, event.eventId) && !allHandlersAcked) {
        // Main ack without handler ack must NOT close outbox.
        skippedDup += 0;
        deferred += 1;
      }
    }
    this.store.saveProjection(this.consumerId, this.projection);
    return { processed, skippedDup, deferred };
  }

  applyContribution(
    consumerId: string,
    event: OutcomeOutboxEvent,
    record: TaskOutcomeRecord,
  ): void {
    if (this.store.hasConsumed(consumerId, event.eventId)) {
      return;
    }
    if (event.eventType !== "task.closed" && event.eventType !== "task.corrected") {
      this.store.markConsumed(consumerId, event.eventId, { ignored: "non_terminal_event" });
      return;
    }
    if (event.outcomeVersion !== record.outcomeVersion) {
      this.store.markConsumed(consumerId, event.eventId, { ignored: "version_mismatch_vs_tip" });
      return;
    }
    if (record.lifecycle !== "closed") {
      this.store.markConsumed(consumerId, event.eventId, { ignored: "not_closed" });
      return;
    }

    const eligibility = computeEvaluationEligibility(record);
    const sid = scopeIdOf(record.scope);
    const prev = this.store.loadContribution(sid, record.taskId) as ContributionRecord | undefined;

    if (prev && prev.outcomeVersion > event.outcomeVersion) {
      this.store.markConsumed(consumerId, event.eventId, { ignored: "stale_version" });
      return;
    }

    if (prev && prev.outcomeVersion === event.outcomeVersion) {
      this.store.markConsumed(consumerId, event.eventId, { ignored: "already_applied" });
      return;
    }

    if (prev && prev.outcomeVersion < event.outcomeVersion) {
      this.revokeCounted(prev);
    }

    const countedCancelled = record.taskJudgement === "cancelled";
    const countedSuccess = record.taskJudgement === "success" && eligibility.countsSkillSuccessRate;
    const countedFailure = record.taskJudgement === "failure" && eligibility.countsGrowthNegative;

    if (countedCancelled) {
      this.projection.cancelledCount += 1;
    }
    if (countedSuccess) {
      this.projection.successCount += 1;
    }
    if (countedFailure) {
      this.projection.failureCount += 1;
    }

    const contribution: ContributionRecord = {
      outcomeVersion: record.outcomeVersion,
      judgement: record.taskJudgement,
      eligibilityAttribution: eligibility.attribution,
      taskId: record.taskId,
      countedSuccess,
      countedFailure,
      countedCancelled,
    };
    // Persist contribution before projection; boot always rebuilds projection from contributions.
    this.store.saveContribution(sid, record.taskId, contribution);
    this.projection.applied = this.projection.applied.filter((a) => a.taskId !== record.taskId);
    this.projection.applied.push({
      taskId: record.taskId,
      outcomeVersion: record.outcomeVersion,
      judgement: record.taskJudgement,
    });
    this.store.saveProjection(this.consumerId, this.projection);
  }

  private revokeCounted(prev: ContributionRecord): void {
    if (prev.countedSuccess && this.projection.successCount > 0) {
      this.projection.successCount -= 1;
    }
    if (prev.countedFailure && this.projection.failureCount > 0) {
      this.projection.failureCount -= 1;
    }
    if (prev.countedCancelled && this.projection.cancelledCount > 0) {
      this.projection.cancelledCount -= 1;
    }
    // Legacy revoke without flags: best-effort by judgement only when flags absent
    if (
      prev.countedSuccess === undefined &&
      prev.countedFailure === undefined &&
      prev.countedCancelled === undefined
    ) {
      this.revoke(prev.judgement);
    }
  }

  private revoke(prevJudgement: string): void {
    if (prevJudgement === "success" && this.projection.successCount > 0) {
      this.projection.successCount -= 1;
    }
    if (prevJudgement === "failure" && this.projection.failureCount > 0) {
      this.projection.failureCount -= 1;
    }
    if (prevJudgement === "cancelled" && this.projection.cancelledCount > 0) {
      this.projection.cancelledCount -= 1;
    }
  }
}

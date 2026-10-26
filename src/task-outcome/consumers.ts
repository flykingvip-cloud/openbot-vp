import { computeEvaluationEligibility } from "./eligibility.js";
import type { DurableTaskOutcomeStore } from "./store.js";
import { scopeIdOf } from "./transitions.js";
import type { OutcomeOutboxEvent, TaskOutcomeRecord } from "./types.js";

export type ContributionProjection = {
  successCount: number;
  failureCount: number;
  cancelledCount: number;
  /** Latest applied contribution keys for debugging */
  applied: Array<{ taskId: string; outcomeVersion: number; judgement: string }>;
};

export type ConsumerHandler = {
  consumerId: string;
  onEvent: (event: OutcomeOutboxEvent, record: TaskOutcomeRecord) => void;
};

/**
 * Reliable consume: dedupe by consumerId+eventId; on version bump revoke old contribution
 * and apply new. Business update + consume ack are sequenced with ack last; crash before ack
 * replays but contribution upsert is idempotent by outcomeVersion.
 */
export class OutcomeConsumerRuntime {
  private readonly store: DurableTaskOutcomeStore;
  private projection: ContributionProjection = {
    successCount: 0,
    failureCount: 0,
    cancelledCount: 0,
    applied: [],
  };

  constructor(store: DurableTaskOutcomeStore) {
    this.store = store;
  }

  getProjection(): ContributionProjection {
    return { ...this.projection, applied: [...this.projection.applied] };
  }

  /** Boot recovery + runtime drain. */
  drain(loadRecord: (taskId: string) => TaskOutcomeRecord | undefined): {
    processed: number;
    skippedDup: number;
  } {
    let processed = 0;
    let skippedDup = 0;
    for (const event of this.store.listPendingOutbox()) {
      const consumerId = "growth-skill-mode-evolution";
      if (this.store.hasConsumed(consumerId, event.eventId)) {
        this.store.markOutboxDone(event.eventId);
        skippedDup += 1;
        continue;
      }
      const record = loadRecord(event.taskId);
      if (!record) {
        continue;
      }
      this.applyContribution(consumerId, event, record);
      // ack after business update
      this.store.markConsumed(consumerId, event.eventId, {
        outcomeVersion: event.outcomeVersion,
      });
      this.store.markOutboxDone(event.eventId);
      processed += 1;
    }
    return { processed, skippedDup };
  }

  applyContribution(
    consumerId: string,
    event: OutcomeOutboxEvent,
    record: TaskOutcomeRecord,
  ): void {
    if (this.store.hasConsumed(consumerId, event.eventId)) {
      return;
    }
    // Non-terminal / non-correction events are ack-only (no score).
    if (event.eventType !== "task.closed" && event.eventType !== "task.corrected") {
      this.store.markConsumed(consumerId, event.eventId, { ignored: "non_terminal_event" });
      return;
    }
    // Event carries its version; ignore if a newer contribution already applied
    // or if this event is not the tip (avoids replaying old outbox against tip record).
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
    const prev = this.store.loadContribution(sid, record.taskId);

    if (prev && prev.outcomeVersion > event.outcomeVersion) {
      this.store.markConsumed(consumerId, event.eventId, { ignored: "stale_version" });
      return;
    }

    if (prev && prev.outcomeVersion === event.outcomeVersion) {
      // identical contribution already applied (crash replay)
      this.store.markConsumed(consumerId, event.eventId, { ignored: "already_applied" });
      return;
    }

    if (prev && prev.outcomeVersion < event.outcomeVersion) {
      this.revoke(prev.judgement);
    }

    if (record.taskJudgement === "cancelled") {
      this.projection.cancelledCount += 1;
    } else if (record.taskJudgement === "success" && eligibility.countsSkillSuccessRate) {
      this.projection.successCount += 1;
    } else if (record.taskJudgement === "failure" && eligibility.countsGrowthNegative) {
      this.projection.failureCount += 1;
    }

    this.store.saveContribution(sid, record.taskId, {
      outcomeVersion: record.outcomeVersion,
      judgement: record.taskJudgement,
      eligibilityAttribution: eligibility.attribution,
    });
    this.projection.applied = this.projection.applied.filter((a) => a.taskId !== record.taskId);
    this.projection.applied.push({
      taskId: record.taskId,
      outcomeVersion: record.outcomeVersion,
      judgement: record.taskJudgement,
    });
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

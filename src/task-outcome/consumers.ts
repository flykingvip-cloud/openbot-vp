import fs from "node:fs";
import path from "node:path";
import { computeEvaluationEligibility } from "./eligibility.js";
import type { DurableTaskOutcomeStore, DurableProjection } from "./store.js";
import { scopeIdOf } from "./transitions.js";
import type { OutcomeOutboxEvent, TaskOutcomeRecord } from "./types.js";

export type ContributionProjection = DurableProjection;

export type ConsumerHandler = {
  consumerId: string;
  onEvent: (event: OutcomeOutboxEvent, record: TaskOutcomeRecord) => void;
};

export const GROWTH_EVOLUTION_CONSUMER_ID = "growth-evolution";
export const SKILL_CONSUMER_ID = "skill-quality";
export const MODE_CONSUMER_ID = "mode-quality";

/**
 * Reliable consume with durable projection.
 * Dedupe by consumerId+eventId; version bump revokes old contribution then applies new.
 * Projection is persisted and rebuilt from contributions on boot when file missing.
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
    this.projection = store.loadProjection(this.consumerId);
    if (
      this.projection.successCount === 0 &&
      this.projection.failureCount === 0 &&
      this.projection.cancelledCount === 0 &&
      this.projection.applied.length === 0
    ) {
      this.rebuildProjectionFromContributions();
    }
  }

  getProjection(): ContributionProjection {
    return { ...this.projection, applied: [...this.projection.applied] };
  }

  /** Rebuild exact counts from durable contribution files. */
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
        const raw = JSON.parse(fs.readFileSync(path.join(contribDir, name), "utf8")) as {
          outcomeVersion: number;
          judgement: string;
          eligibilityAttribution: string;
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
        if (raw.judgement === "success") {
          next.successCount += 1;
        } else if (raw.judgement === "failure") {
          next.failureCount += 1;
        } else if (raw.judgement === "cancelled") {
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

  drain(loadRecord: (taskId: string) => TaskOutcomeRecord | undefined): {
    processed: number;
    skippedDup: number;
  } {
    let processed = 0;
    let skippedDup = 0;
    for (const event of this.store.listPendingOutbox()) {
      if (this.store.hasConsumed(this.consumerId, event.eventId)) {
        this.store.markOutboxDone(event.eventId);
        skippedDup += 1;
        continue;
      }
      const record =
        this.store.loadTaskVersion(event.taskId, event.outcomeVersion) ?? loadRecord(event.taskId);
      if (!record) {
        continue;
      }
      // Prefer immutable version snapshot matching the event.
      const versioned = this.store.loadTaskVersion(event.taskId, event.outcomeVersion) ?? record;
      this.applyContribution(this.consumerId, event, versioned);
      for (const h of this.handlers) {
        if (!this.store.hasConsumed(h.consumerId, event.eventId)) {
          h.onEvent(event, versioned);
          this.store.markConsumed(h.consumerId, event.eventId, {
            outcomeVersion: event.outcomeVersion,
          });
        }
      }
      this.store.markConsumed(this.consumerId, event.eventId, {
        outcomeVersion: event.outcomeVersion,
      });
      this.store.markOutboxDone(event.eventId);
      processed += 1;
    }
    this.store.saveProjection(this.consumerId, this.projection);
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
    const prev = this.store.loadContribution(sid, record.taskId);

    if (prev && prev.outcomeVersion > event.outcomeVersion) {
      this.store.markConsumed(consumerId, event.eventId, { ignored: "stale_version" });
      return;
    }

    if (prev && prev.outcomeVersion === event.outcomeVersion) {
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
      taskId: record.taskId,
    });
    this.projection.applied = this.projection.applied.filter((a) => a.taskId !== record.taskId);
    this.projection.applied.push({
      taskId: record.taskId,
      outcomeVersion: record.outcomeVersion,
      judgement: record.taskJudgement,
    });
    this.store.saveProjection(this.consumerId, this.projection);
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

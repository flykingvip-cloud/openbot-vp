/**
 * W2: skill-quality / mode-quality handlers — consume closed tip + eligibility only.
 * Never treat run terminal state alone as skill/mode success.
 */
import fs from "node:fs";
import path from "node:path";
import { backfillAttemptSamplesFromTaskOutcome } from "./attempt-backfill.js";
import {
  MODE_CONSUMER_ID,
  SKILL_CONSUMER_ID,
  type ConsumerHandler,
  type ContributionRecord,
} from "./consumers.js";
import { computeEvaluationEligibility } from "./eligibility.js";
import type { DurableProjection, DurableTaskOutcomeStore } from "./store.js";
import { scopeIdOf } from "./transitions.js";
import type { OutcomeOutboxEvent, TaskOutcomeRecord } from "./types.js";

export type QualityHandlerOptions = {
  agentId?: string;
  /** Optional skill-invocation CONFIG_DIR override for tests. */
  skillConfigDir?: string;
  /** When false, skip attempt pattern/skill backfill (projection-only). Default true. */
  backfillAttempt?: boolean;
};

function qualityContributionDir(store: DurableTaskOutcomeStore, consumerId: string): string {
  return path.join(store.rootDir, "contributions", encodeURIComponent(consumerId));
}

function qualityContributionPath(
  store: DurableTaskOutcomeStore,
  consumerId: string,
  scopeId: string,
  taskId: string,
): string {
  return path.join(
    qualityContributionDir(store, consumerId),
    `${encodeURIComponent(scopeId)}__${encodeURIComponent(taskId)}.json`,
  );
}

function loadQualityContribution(
  store: DurableTaskOutcomeStore,
  consumerId: string,
  scopeId: string,
  taskId: string,
): ContributionRecord | undefined {
  const filePath = qualityContributionPath(store, consumerId, scopeId, taskId);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ContributionRecord;
  } catch {
    return undefined;
  }
}

function saveQualityContribution(
  store: DurableTaskOutcomeStore,
  consumerId: string,
  scopeId: string,
  taskId: string,
  value: ContributionRecord,
): void {
  const filePath = qualityContributionPath(store, consumerId, scopeId, taskId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function emptyProjection(): DurableProjection {
  return { successCount: 0, failureCount: 0, cancelledCount: 0, applied: [] };
}

/** Rebuild skill/mode projection from durable quality contributions (crash-safe). */
export function rebuildQualityProjectionFromContributions(
  store: DurableTaskOutcomeStore,
  consumerId: string,
): DurableProjection {
  const next = emptyProjection();
  const dir = qualityContributionDir(store, consumerId);
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      try {
        const raw = JSON.parse(
          fs.readFileSync(path.join(dir, name), "utf8"),
        ) as Partial<ContributionRecord> & { outcomeVersion: number; judgement: string };
        const taskId =
          raw.taskId ??
          decodeURIComponent(
            name
              .replace(/\.json$/, "")
              .split("__")
              .slice(1)
              .join("__"),
          );
        if (raw.countedSuccess === true) {
          next.successCount += 1;
        }
        if (raw.countedFailure === true) {
          next.failureCount += 1;
        }
        if (raw.countedCancelled === true) {
          next.cancelledCount += 1;
        }
        next.applied.push({
          taskId,
          outcomeVersion: raw.outcomeVersion,
          judgement: raw.judgement,
        });
      } catch {
        // skip corrupt
      }
    }
  }
  store.saveProjection(consumerId, next);
  return { ...next, applied: [...next.applied] };
}

function revokeFlags(proj: DurableProjection, prev: ContributionRecord): void {
  if (prev.countedSuccess && proj.successCount > 0) {
    proj.successCount -= 1;
  }
  if (prev.countedFailure && proj.failureCount > 0) {
    proj.failureCount -= 1;
  }
  if (prev.countedCancelled && proj.cancelledCount > 0) {
    proj.cancelledCount -= 1;
  }
}

function resolveSkillCounts(record: TaskOutcomeRecord): {
  countedSuccess: boolean;
  countedFailure: boolean;
  countedCancelled: boolean;
  attribution: string;
} {
  const eligibility = computeEvaluationEligibility(record);
  const countedCancelled = record.taskJudgement === "cancelled";
  const countedSuccess = record.taskJudgement === "success" && eligibility.countsSkillSuccessRate;
  // cancelled must never inflate skill failure; only tip failure + skill eligibility.
  const countedFailure = record.taskJudgement === "failure" && eligibility.countsSkillSuccessRate;
  return {
    countedSuccess,
    countedFailure,
    countedCancelled,
    attribution: eligibility.attribution,
  };
}

function resolveModeCounts(record: TaskOutcomeRecord): {
  countedSuccess: boolean;
  countedFailure: boolean;
  countedCancelled: boolean;
  attribution: string;
} {
  const eligibility = computeEvaluationEligibility(record);
  const countedCancelled = record.taskJudgement === "cancelled";
  const countedSuccess = record.taskJudgement === "success" && eligibility.countsSkillSuccessRate;
  // Mode stability samples (e.g. provider_fault) count as mode failure without growth negative.
  // Capability mode failures use growth-negative / skill-rate eligibility.
  // cancelled never counts as mode failure.
  const countedFailure =
    !countedCancelled &&
    ((record.taskJudgement === "failure" && eligibility.countsGrowthNegative) ||
      eligibility.countsModelStability);
  return {
    countedSuccess,
    countedFailure,
    countedCancelled,
    attribution: eligibility.attribution,
  };
}

function applyQualityEvent(params: {
  store: DurableTaskOutcomeStore;
  consumerId: string;
  event: OutcomeOutboxEvent;
  record: TaskOutcomeRecord;
  resolveCounts: (record: TaskOutcomeRecord) => {
    countedSuccess: boolean;
    countedFailure: boolean;
    countedCancelled: boolean;
    attribution: string;
  };
}): void {
  const { store, consumerId, event, record, resolveCounts } = params;
  if (event.eventType !== "task.closed" && event.eventType !== "task.corrected") {
    return;
  }
  if (event.outcomeVersion !== record.outcomeVersion) {
    return;
  }
  if (record.lifecycle !== "closed") {
    return;
  }

  const sid = scopeIdOf(record.scope);
  const prev = loadQualityContribution(store, consumerId, sid, record.taskId);
  if (prev && prev.outcomeVersion > event.outcomeVersion) {
    return;
  }
  if (prev && prev.outcomeVersion === event.outcomeVersion) {
    return;
  }

  const proj = store.loadProjection(consumerId);
  if (prev && prev.outcomeVersion < event.outcomeVersion) {
    revokeFlags(proj, prev);
  }

  const counts = resolveCounts(record);
  if (counts.countedCancelled) {
    proj.cancelledCount += 1;
  }
  if (counts.countedSuccess) {
    proj.successCount += 1;
  }
  if (counts.countedFailure) {
    proj.failureCount += 1;
  }

  const contribution: ContributionRecord = {
    outcomeVersion: record.outcomeVersion,
    judgement: record.taskJudgement,
    eligibilityAttribution: counts.attribution,
    taskId: record.taskId,
    countedSuccess: counts.countedSuccess,
    countedFailure: counts.countedFailure,
    countedCancelled: counts.countedCancelled,
  };
  saveQualityContribution(store, consumerId, sid, record.taskId, contribution);
  proj.applied = proj.applied.filter((a) => a.taskId !== record.taskId);
  proj.applied.push({
    taskId: record.taskId,
    outcomeVersion: record.outcomeVersion,
    judgement: record.taskJudgement,
  });
  store.saveProjection(consumerId, proj);
}

/**
 * skill-quality: tip + countsSkillSuccessRate only; cancelled → cancelledCount, never failure.
 * Also triggers attempt positive/negative backfill when eligible.
 */
export function createSkillQualityHandler(
  store: DurableTaskOutcomeStore,
  opts?: QualityHandlerOptions,
): ConsumerHandler {
  rebuildQualityProjectionFromContributions(store, SKILL_CONSUMER_ID);
  return {
    consumerId: SKILL_CONSUMER_ID,
    onEvent: (event, record) => {
      applyQualityEvent({
        store,
        consumerId: SKILL_CONSUMER_ID,
        event,
        record,
        resolveCounts: resolveSkillCounts,
      });
      if (opts?.backfillAttempt !== false) {
        backfillAttemptSamplesFromTaskOutcome(record, {
          agentId: opts?.agentId,
          configDir: opts?.skillConfigDir,
        });
      }
    },
  };
}

/**
 * mode-quality: tip + eligibility (incl. model stability); cancelled never mode failure.
 */
export function createModeQualityHandler(
  store: DurableTaskOutcomeStore,
  _opts?: QualityHandlerOptions,
): ConsumerHandler {
  rebuildQualityProjectionFromContributions(store, MODE_CONSUMER_ID);
  return {
    consumerId: MODE_CONSUMER_ID,
    onEvent: (event, record) => {
      applyQualityEvent({
        store,
        consumerId: MODE_CONSUMER_ID,
        event,
        record,
        resolveCounts: resolveModeCounts,
      });
    },
  };
}

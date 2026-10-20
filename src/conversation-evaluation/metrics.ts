import type { ConversationEntrypoint, ConversationEvaluationRecord } from "./types.js";
import { ENTRYPOINTS, isTerminalAssessment } from "./types.js";

export type EntrypointMetrics = {
  denominator: number;
  withRecord: number;
  processingComplete: number;
  effectiveComplete: number;
  observableCoverage: number | null;
  processingCompletion: number | null;
  effectiveAssessment: number | null;
};

export type ConversationEvaluationMetrics = {
  byEntrypoint: Record<ConversationEntrypoint, EntrypointMetrics>;
  highTrust: EntrypointMetrics;
  weakSamples: number;
  pendingCount: number;
  pendingOverdue: number;
  pendingTimeoutRate: number | null;
};

export type DenominatorMark = {
  runId: string;
  tenantId: string;
  entrypoint: ConversationEntrypoint;
  linkQuality: "strong" | "weak";
  eventId: string;
  observedAt: string;
};

function emptyEntrypoint(): EntrypointMetrics {
  return {
    denominator: 0,
    withRecord: 0,
    processingComplete: 0,
    effectiveComplete: 0,
    observableCoverage: null,
    processingCompletion: null,
    effectiveAssessment: null,
  };
}

function finish(row: EntrypointMetrics): EntrypointMetrics {
  if (row.denominator === 0) {
    return row;
  }
  return {
    ...row,
    observableCoverage: row.withRecord / row.denominator,
    processingCompletion: row.processingComplete / row.denominator,
    effectiveAssessment: row.effectiveComplete / row.denominator,
  };
}

function add(into: EntrypointMetrics, extra: EntrypointMetrics): void {
  into.denominator += extra.denominator;
  into.withRecord += extra.withRecord;
  into.processingComplete += extra.processingComplete;
  into.effectiveComplete += extra.effectiveComplete;
}

/**
 * Denominator is the caller-supplied lifecycle/terminal set, not the eval row count.
 * Weak marks are excluded from high-trust coverage.
 * failed_to_assess counts in processing completion and not in effective completion.
 */
export function computeMetrics(input: {
  denominator: DenominatorMark[];
  records: ConversationEvaluationRecord[];
  nowMs: number;
  pendingSloMs: number;
}): ConversationEvaluationMetrics {
  const byEntrypoint = Object.fromEntries(
    ENTRYPOINTS.map((entrypoint) => [entrypoint, emptyEntrypoint()]),
  ) as Record<ConversationEntrypoint, EntrypointMetrics>;

  const strongRuns = new Set<string>();
  let weakSamples = 0;
  for (const mark of input.denominator) {
    if (mark.linkQuality === "weak") {
      weakSamples += 1;
      continue;
    }
    const row = byEntrypoint[mark.entrypoint];
    row.denominator += 1;
    strongRuns.add(`${mark.tenantId}\0${mark.runId}`);
  }

  const currentByRun = new Map<string, ConversationEvaluationRecord>();
  for (const record of input.records) {
    if (record.linkQuality === "weak") {
      continue;
    }
    const key = `${record.tenantId}\0${record.runId}`;
    const existing = currentByRun.get(key);
    if (!existing || ruleRank(record) >= ruleRank(existing)) {
      currentByRun.set(key, record);
    }
  }

  let pendingCount = 0;
  let pendingOverdue = 0;
  for (const [key, record] of currentByRun) {
    if (!strongRuns.has(key)) {
      if (record.assessmentStatus === "pending") {
        pendingCount += 1;
        const observed = Date.parse(record.observedAt);
        if (Number.isFinite(observed) && input.nowMs - observed > input.pendingSloMs) {
          pendingOverdue += 1;
        }
      }
      continue;
    }
    const row = byEntrypoint[record.entrypoint];
    row.withRecord += 1;
    if (isTerminalAssessment(record.assessmentStatus)) {
      row.processingComplete += 1;
    }
    if (record.assessmentStatus === "assessed" || record.assessmentStatus === "unassessed") {
      row.effectiveComplete += 1;
    }
    if (record.assessmentStatus === "pending") {
      pendingCount += 1;
      const observed = Date.parse(record.observedAt);
      if (Number.isFinite(observed) && input.nowMs - observed > input.pendingSloMs) {
        pendingOverdue += 1;
      }
    }
  }

  const highTrust = emptyEntrypoint();
  for (const entrypoint of ENTRYPOINTS) {
    byEntrypoint[entrypoint] = finish(byEntrypoint[entrypoint]);
    add(highTrust, byEntrypoint[entrypoint]);
  }

  return {
    byEntrypoint,
    highTrust: finish(highTrust),
    weakSamples,
    pendingCount,
    pendingOverdue,
    pendingTimeoutRate: pendingCount === 0 ? null : pendingOverdue / pendingCount,
  };
}

function ruleRank(record: ConversationEvaluationRecord): number {
  const match = /(\d+)\.(\d+)$/.exec(record.ruleVersion);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 1000 + Number(match[2]);
}

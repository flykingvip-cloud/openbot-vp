/** Internal read-only query. RPC adapters must authenticate caller before invocation. */
import type { OpenBotConfig } from "../config/config.js";
import { getExecutionEvidenceStore } from "./execution-evidence-store.js";
import {
  getExecutionJournalRuntime,
  type createExecutionJournalRuntime,
} from "./execution-journal-runtime.js";
import { projectExecutionEvidence, type ExecutionSource } from "./execution-projection.js";
import { OBSERVATION_METRIC_DICT, OBSERVATION_METRIC_DICT_VERSION } from "./metric-dict.js";
import { readOutcomeMetadata } from "./outcome-reader.js";
import {
  outcomeMetadataFingerprint,
  getOutcomeSourceStore,
  type createOutcomeSourceStore,
} from "./outcome-source.js";
import { assembleObservationSamples } from "./sample-assembler.js";

export function queryObservation(input: {
  cfg: OpenBotConfig;
  caller: { subjectRef: string; tenantId?: string | null };
  agentId: string;
  taskId: string;
  outcomeVersion: number;
  from: number;
  to: number;
  projectedAt: number;
  executionStore?: ExecutionSource;
  outcomeSourceStore?: Pick<ReturnType<typeof createOutcomeSourceStore>, "query">;
  evidenceLookupWindow?: { from: number; to: number };
}) {
  if (
    ![input.from, input.to, input.projectedAt].every(Number.isFinite) ||
    input.from >= input.to ||
    input.to - input.from > 30 * 86_400_000 ||
    input.to > input.projectedAt
  ) {
    return { ok: false as const, code: "invalid_window" as const };
  }
  const lookup = input.evidenceLookupWindow ?? { from: input.from, to: input.to };
  if (
    ![lookup.from, lookup.to].every(Number.isFinite) ||
    lookup.from > input.from ||
    lookup.to < input.to ||
    lookup.from >= lookup.to ||
    lookup.to - lookup.from > 30 * 86_400_000 ||
    lookup.to > input.projectedAt
  ) {
    return { ok: false as const, code: "invalid_evidence_lookup_window" as const };
  }
  const result = readOutcomeMetadata({
    cfg: input.cfg,
    agentId: input.agentId,
    taskId: input.taskId,
    outcomeVersion: input.outcomeVersion,
    callerSubjectRef: input.caller.subjectRef,
    callerTenantId: input.caller.tenantId,
  });
  if (!result.ok) {
    return result;
  }
  const { isCurrentTip, ...record } = result.outcome;
  const outcomeSource = (input.outcomeSourceStore ?? getOutcomeSourceStore()).query(
    input.agentId,
    record,
  );
  const execution = projectExecutionEvidence({
    snapshot: (input.executionStore ?? getExecutionEvidenceStore()).query(record.scope),
    scope: record.scope,
    taskId: record.taskId,
    outcomeVersion: record.outcomeVersion,
  });
  const projection = assembleObservationSamples({
    scope: record.scope,
    from: input.from,
    to: input.to,
    projectedAt: input.projectedAt,
    sourceWatermark: null,
    evidenceLookupWindow: lookup,
    outcomes: [
      {
        record,
        sourceId: "task-outcome-version",
        provenance: outcomeSource.provenance,
        isCurrentTip,
      },
    ],
    executions: execution.executions,
  });
  return {
    ok: true as const,
    ...projection,
    executionSource: execution.executionSource,
    outcomeSource,
    metricDictVersion: OBSERVATION_METRIC_DICT_VERSION,
    metrics: [
      {
        metricId: OBSERVATION_METRIC_DICT.lifecycleCompletion.metricId,
        value: null,
        reasons: ["connection_execution_source_unavailable"],
      },
      {
        metricId: OBSERVATION_METRIC_DICT.businessClosedSuccess.metricId,
        value: null,
        reasons: [
          ...(outcomeSource.provenance === "unknown"
            ? ["provenance_unknown"]
            : ["submission_source_not_business_metric_eligibility"]),
          ...(!isCurrentTip ? ["historical_version_excluded"] : []),
          ...(!projection.samples.length ? ["no_eligible_current_tips"] : []),
        ],
      },
      {
        metricId: OBSERVATION_METRIC_DICT.linkCoverage.metricId,
        value: projection.coverage.link,
        reasons: projection.coverage.reasons,
      },
    ],
    sourceReasons: [
      ...execution.executionSource.reasons,
      ...outcomeSource.reasons,
      "source_watermark_unavailable",
    ],
  };
}

/** Optional durable read; never restores execution or improvement authority. */
export async function queryObservationWithJournal(
  input: Parameters<typeof queryObservation>[0],
  journal: ReturnType<typeof createExecutionJournalRuntime> = getExecutionJournalRuntime(),
) {
  const base = queryObservation(input);
  if (!base.ok) {
    return base;
  }
  if (!journal.isEnabled()) {
    return {
      ...base,
      executionJournal: { state: "unknown" as const, reasons: ["journal_disabled"] },
    };
  }
  const authorize = () =>
    readOutcomeMetadata({
      cfg: input.cfg,
      agentId: input.agentId,
      taskId: input.taskId,
      outcomeVersion: input.outcomeVersion,
      callerSubjectRef: input.caller.subjectRef,
      callerTenantId: input.caller.tenantId,
    });
  const auth = authorize();
  if (!auth.ok) {
    return auth;
  }
  const durable = await journal.query({ agentId: input.agentId, scope: auth.outcome.scope });
  const fresh = authorize();
  if (!fresh.ok) {
    return fresh;
  }
  if (outcomeMetadataFingerprint(auth.outcome) !== outcomeMetadataFingerprint(fresh.outcome)) {
    return { ok: false as const, code: "scope_or_version_changed" as const };
  }
  if (!durable.ok) {
    return {
      ...base,
      executionJournal: { state: "unknown" as const, reasons: [durable.reason] },
      sourceReasons: [...base.sourceReasons, durable.reason],
    };
  }
  const { isCurrentTip, ...record } = fresh.outcome;
  const memory = (input.executionStore ?? getExecutionEvidenceStore()).query(record.scope);
  const memoryProjection = projectExecutionEvidence({
    snapshot: memory,
    scope: record.scope,
    taskId: record.taskId,
    outcomeVersion: record.outcomeVersion,
  });
  const diskProjection = projectExecutionEvidence({
    snapshot: {
      ...memory,
      processId: memory.processId,
      epoch: memory.epoch,
      facts: durable.facts.map((fact) => ({ ...fact, source: fact.source })),
      links: durable.links,
      reasons: durable.reasons,
    },
    scope: record.scope,
    taskId: record.taskId,
    outcomeVersion: record.outcomeVersion,
  });
  const executions = [
    ...memoryProjection.executions,
    ...diskProjection.executions.map((event) => ({
      ...event,
      sourceId: JSON.stringify(["durable_execution_journal", durable.epoch]),
    })),
  ];
  // Distinct epochs retain identity. A shared event id with contradictory payload is invalid,
  // rather than being silently selected from memory or disk.
  const byId = new Map<string, typeof executions>();
  for (const event of executions) {
    const rows = byId.get(event.eventId) ?? [];
    rows.push(event);
    byId.set(event.eventId, rows);
  }
  const conflictingIds = new Set<string>();
  for (const rows of byId.values()) {
    const payload = (event: (typeof executions)[number]) =>
      JSON.stringify([
        event.occurredAt,
        event.runId,
        event.taskId,
        event.outcomeVersion,
        event.attemptId,
        event.provenance,
        event.collector,
      ]);
    if (new Set(rows.map(payload)).size > 1) {
      conflictingIds.add(rows[0].eventId);
    }
  }
  const mergedExecutions = executions.filter((event, index, all) => {
    // Only a shared stable UUID plus identical payload proves the same persisted event.
    // Non-UUID or different epoch identities remain separate when equivalence is unproven.
    if (
      conflictingIds.has(event.eventId) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(event.eventId)
    ) {
      return true;
    }
    const payload = (entry: typeof event) =>
      JSON.stringify([
        entry.eventId,
        entry.occurredAt,
        entry.runId,
        entry.taskId,
        entry.outcomeVersion,
        entry.attemptId,
        entry.provenance,
        entry.collector,
      ]);
    return !all.slice(0, index).some((prior) => payload(prior) === payload(event));
  });
  const assembled = assembleObservationSamples({
    scope: record.scope,
    from: input.from,
    to: input.to,
    projectedAt: input.projectedAt,
    evidenceLookupWindow: input.evidenceLookupWindow,
    sourceWatermark: JSON.stringify([durable.epoch, durable.watermark]),
    outcomes: [
      {
        record,
        isCurrentTip,
        sourceId: "task-outcome-version",
        provenance: base.outcomeSource.provenance,
      },
    ],
    executions: mergedExecutions.map((event) =>
      conflictingIds.has(event.eventId)
        ? { ...event, sourceId: "conflicting_execution_identity" }
        : event,
    ),
  });
  return {
    ...base,
    ...assembled,
    executionJournal: {
      state: "retained" as const,
      retention: durable.retention,
      epoch: durable.epoch,
      capacity: durable.capacity,
      ttlMs: durable.ttlMs,
      watermark: durable.watermark,
      truncated: durable.truncated,
      reasons: durable.reasons,
    },
    metrics: base.metrics.map((metric) =>
      metric.metricId === OBSERVATION_METRIC_DICT.linkCoverage.metricId
        ? { ...metric, value: assembled.coverage.link, reasons: assembled.coverage.reasons }
        : metric,
    ),
    sourceReasons: [...base.sourceReasons, ...durable.reasons],
  };
}

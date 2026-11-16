/** Internal read-only query. RPC adapters must authenticate caller before invocation. */
import type { OpenBotConfig } from "../config/config.js";
import { readExecutorEvidence } from "../executor-evidence/read-port.js";
import { resolveConfiguredTaskOutcomeRoot } from "../task-outcome/reject-result.js";
import { projectDurableExecutorExecutions } from "./durable-execution-projection.js";
import { getExecutionEvidenceStore } from "./execution-evidence-store.js";
import {
  getExecutionJournalRuntime,
  type createExecutionJournalRuntime,
} from "./execution-journal-runtime.js";
import { projectExecutionEvidence, type ExecutionSource } from "./execution-projection.js";
import { readExecutorTechnicalEvidence } from "./executor-technical-evidence.js";
import { OBSERVATION_METRIC_DICT, OBSERVATION_METRIC_DICT_VERSION } from "./metric-dict.js";
import { readOutcomeMetadata } from "./outcome-reader.js";
import {
  outcomeMetadataFingerprint,
  getOutcomeSourceStore,
  type createOutcomeSourceStore,
} from "./outcome-source.js";
import { assembleObservationSamples } from "./sample-assembler.js";

function readDurableExecutions(input: {
  cfg: Parameters<typeof queryObservation>[0]["cfg"];
  agentId: string;
  scope: import("../task-outcome/types.js").TrustedScope;
  taskId: string;
  outcomeVersion: number;
  from: number;
  to: number;
}) {
  const located = resolveConfiguredTaskOutcomeRoot(input.cfg, input.agentId);
  if (!located.ok) {
    return [];
  }
  try {
    return projectDurableExecutorExecutions({
      view: readExecutorEvidence({
        agentId: input.agentId,
        scope: input.scope,
        taskId: input.taskId,
        outcomeVersion: input.outcomeVersion,
        storeRoot: located.root,
      }),
      taskId: input.taskId,
      outcomeVersion: input.outcomeVersion,
      from: input.from,
      to: input.to,
    });
  } catch {
    return [];
  }
}

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
  const durable = readDurableExecutions({
    cfg: input.cfg,
    agentId: input.agentId,
    scope: record.scope,
    taskId: record.taskId,
    outcomeVersion: record.outcomeVersion,
    from: lookup.from,
    to: lookup.to,
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
    executions: [...execution.executions, ...durable],
  });
  const technical = readExecutorTechnicalEvidence(input);
  if (!technical.ok) {
    return technical;
  }
  return {
    ok: true as const,
    executorTechnicalEvidence: technical.technicalEvidence,
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
  const memoryPort = input.executionStore;
  const sourcePort = input.outcomeSourceStore;
  input = {
    cfg: structuredClone(input.cfg),
    caller: { subjectRef: input.caller.subjectRef, tenantId: input.caller.tenantId },
    agentId: input.agentId,
    taskId: input.taskId,
    outcomeVersion: input.outcomeVersion,
    from: input.from,
    to: input.to,
    projectedAt: input.projectedAt,
    evidenceLookupWindow: input.evidenceLookupWindow
      ? { from: input.evidenceLookupWindow.from, to: input.evidenceLookupWindow.to }
      : undefined,
    executionStore: memoryPort ? { query: memoryPort.query.bind(memoryPort) } : undefined,
    outcomeSourceStore: sourcePort ? { query: sourcePort.query.bind(sourcePort) } : undefined,
  };
  const journalQuery = journal.query.bind(journal);
  const journalEnabled = journal.isEnabled.bind(journal);
  let base = queryObservation(input);
  if (!base.ok) {
    return base;
  }
  if (!journalEnabled()) {
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
  const durable = await journalQuery({ agentId: input.agentId, scope: auth.outcome.scope });
  const fresh = authorize();
  if (!fresh.ok) {
    return fresh;
  }
  if (
    auth.outcome.isCurrentTip !== fresh.outcome.isCurrentTip ||
    outcomeMetadataFingerprint(auth.outcome) !== outcomeMetadataFingerprint(fresh.outcome)
  ) {
    return { ok: false as const, code: "scope_or_version_changed" as const };
  }
  base = queryObservation(input);
  if (!base.ok) {
    return base;
  }
  const final = authorize();
  if (!final.ok) {
    return final;
  }
  if (
    final.outcome.isCurrentTip !== auth.outcome.isCurrentTip ||
    outcomeMetadataFingerprint(final.outcome) !== outcomeMetadataFingerprint(auth.outcome)
  ) {
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
  // Preserve distinct source/epoch identities without an explicit common-origin proof.
  const lookup = input.evidenceLookupWindow ?? { from: input.from, to: input.to };
  const durableExecutions = readDurableExecutions({
    cfg: input.cfg,
    agentId: input.agentId,
    scope: record.scope,
    taskId: record.taskId,
    outcomeVersion: record.outcomeVersion,
    from: lookup.from,
    to: lookup.to,
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
    executions: [...executions, ...durableExecutions],
  });
  const samples = assembled.samples.map((sample) =>
    sample.executionRefs.some((ref) => conflictingIds.has(ref.eventId))
      ? {
          ...sample,
          qualification: "invalid" as const,
          reasons: [
            ...new Set([
              ...sample.reasons,
              "duplicate_conflict",
              "external_source_identity_conflict",
            ]),
          ].toSorted(),
          evidence: { ...sample.evidence, execution: "partial" as const },
        }
      : sample,
  );
  const fullyLinkedCount = samples.filter(
    (sample) => sample.qualification === "fully_linked",
  ).length;
  const coverage = {
    ...assembled.coverage,
    fullyLinkedCount,
    invalidCount: samples.filter((sample) => sample.qualification === "invalid").length,
    link: samples.length ? fullyLinkedCount / samples.length : null,
  };
  return {
    ...base,
    ...assembled,
    samples,
    coverage,
    executionConflicts: [...conflictingIds].toSorted().map((eventId) => ({
      eventId,
      refs: (byId.get(eventId) ?? []).map((event) => ({
        sourceId: event.sourceId,
        eventId: event.eventId,
      })),
    })),
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
        ? { ...metric, value: coverage.link, reasons: coverage.reasons }
        : metric,
    ),
    sourceReasons: [...base.sourceReasons, ...durable.reasons],
  };
}

/** Internal read-only query. RPC adapters must authenticate caller before invocation. */
import type { OpenBotConfig } from "../config/config.js";
import { getExecutionEvidenceStore } from "./execution-evidence-store.js";
import { projectExecutionEvidence, type ExecutionSource } from "./execution-projection.js";
import { OBSERVATION_METRIC_DICT, OBSERVATION_METRIC_DICT_VERSION } from "./metric-dict.js";
import { readOutcomeMetadata } from "./outcome-reader.js";
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
    outcomes: [{ record, sourceId: "task-outcome-version", provenance: "unknown", isCurrentTip }],
    executions: execution.executions,
  });
  return {
    ok: true as const,
    ...projection,
    executionSource: execution.executionSource,
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
          "provenance_unknown",
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
      "provenance_unknown",
      "source_watermark_unavailable",
    ],
  };
}

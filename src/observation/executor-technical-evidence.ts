/** Independent L2 projection. Candidate callbacks are not task execution or business acceptance. */
import type { OpenBotConfig } from "../config/config.js";
import { readExecutorEvidence } from "../executor-evidence/read-port.js";
import { resolveConfiguredTaskOutcomeRoot } from "../task-outcome/reject-result.js";
import { readOutcomeMetadata } from "./outcome-reader.js";
import { outcomeMetadataFingerprint } from "./outcome-source.js";
export function readExecutorTechnicalEvidence(
  input: {
    cfg: OpenBotConfig;
    caller: { subjectRef: string; tenantId?: string | null };
    agentId: string;
    taskId: string;
    outcomeVersion: number;
    from?: number;
    to?: number;
  },
  read: typeof readExecutorEvidence = readExecutorEvidence,
) {
  const authorize = () =>
    readOutcomeMetadata({
      cfg: input.cfg,
      agentId: input.agentId,
      taskId: input.taskId,
      outcomeVersion: input.outcomeVersion,
      callerSubjectRef: input.caller.subjectRef,
      callerTenantId: input.caller.tenantId,
    });
  const before = authorize();
  if (!before.ok) {
    return before;
  }
  const located = resolveConfiguredTaskOutcomeRoot(input.cfg, input.agentId);
  if (!located.ok) {
    return located;
  }
  const unknown = (reason: string) => ({
    ok: true as const,
    technicalEvidence: {
      schemaVersion: 1 as const,
      layer: "technical" as const,
      state: "unknown" as const,
      reasons: [reason],
      calls: [],
      associations: [],
      runTotalCost: null,
      improvementEligible: false as const,
    },
  });
  let view: ReturnType<typeof readExecutorEvidence>;
  try {
    view = read({
      agentId: input.agentId,
      scope: before.outcome.scope,
      taskId: input.taskId,
      outcomeVersion: input.outcomeVersion,
      storeRoot: located.root,
    });
  } catch {
    const fresh = authorize();
    if (!fresh.ok) {
      return fresh;
    }
    if (
      outcomeMetadataFingerprint(before.outcome) !== outcomeMetadataFingerprint(fresh.outcome) ||
      before.outcome.isCurrentTip !== fresh.outcome.isCurrentTip
    ) {
      return { ok: false as const, code: "scope_or_version_changed" };
    }
    return unknown("executor_read_failed");
  }
  const after = authorize();
  if (!after.ok) {
    return after;
  }
  if (
    outcomeMetadataFingerprint(before.outcome) !== outcomeMetadataFingerprint(after.outcome) ||
    before.outcome.isCurrentTip !== after.outcome.isCurrentTip
  ) {
    return { ok: false as const, code: "scope_or_version_changed" };
  }
  if (view.completeness === "mismatch") {
    return unknown("executor_identity_mismatch");
  }
  const exactAssociations = view.associations.filter(
    (row) => row.finalOutcomeVersion === input.outcomeVersion,
  );
  const exactIds = new Set(exactAssociations.map((row) => row.callId));
  const calls = view.calls.filter(
    (call) =>
      exactIds.has(call.callId) &&
      (input.from === undefined || call.startedAt >= input.from) &&
      (input.to === undefined || call.startedAt < input.to),
  );
  const ids = new Set(calls.map((call) => call.callId));
  const associations = exactAssociations.filter(
    (row) => row.callId !== null && ids.has(row.callId),
  );
  return {
    ok: true as const,
    technicalEvidence: {
      schemaVersion: 1 as const,
      layer: "technical" as const,
      state: calls.length ? ("partial" as const) : ("unknown" as const),
      retention: {
        ...view.retention,
        durableAcrossRestart: view.durableAcrossRestart,
        completeHistory: view.completeHistory,
      },
      completeness: calls.length ? ("partial" as const) : ("unknown" as const),
      sourceCompleteness: {
        overall: view.completeness,
        callChain: view.callChainCompleteness,
        costAttribution: view.costAttributionCompleteness,
      },
      sourceWatermark: view.capacity.watermark,
      attributionGaps: exactAssociations
        .filter((row) => !row.callId)
        .map((row) => ({
          runId: row.runId,
          taskAttemptId: row.taskAttemptId,
          finalOutcomeVersion: row.finalOutcomeVersion,
          budgetDisposition: row.disposition,
          reasons: [...(row.budgetChargeReasons ?? []), ...row.missing],
        })),
      reasons: [
        ...view.gaps,
        ...(calls.length !== view.calls.length ? ["window_filtered"] : []),
        "source_watermark_is_not_window_coverage",
        "candidate_calls_are_not_task_outcomes",
        "run_cost_denominator_unavailable",
      ],
      calls: calls.map((call) => ({
        callId: call.callId,
        evidenceId: call.evidenceId,
        runId: call.runId,
        candidateAttemptId: call.attemptId,
        attemptKind: call.attemptKind,
        provider: call.provider,
        model: call.model,
        status: call.status,
        startedAt: call.startedAt,
        completedAt: call.completedAt,
        observedAt: call.observedAt,
        provenance: call.provenance,
        collector: call.collector,
        usage: { ...call.usage },
        usageAggregation: call.usageAggregation,
      })),
      associations: associations.map((row) => ({
        callId: row.callId,
        callEvidenceId: row.callEvidenceId,
        runId: row.runId,
        candidateAttemptId: row.candidateAttemptId,
        taskAttemptId: row.taskAttemptId,
        finalOutcomeVersion: row.finalOutcomeVersion,
        chargeOutcomeVersion: row.chargeOutcomeVersion,
        completeness: row.completeness,
        budgetDisposition: row.disposition,
        budgetChargeReasons: [...(row.budgetChargeReasons ?? [])],
        committedAttribution: { ...row.committedAttribution },
        callEstimate: row.callEstimate
          ? {
              amount: row.callEstimate.estimatedUsd.amount,
              status: row.callEstimate.estimatedUsd.status,
            }
          : null,
      })),
      runTotalCost: null,
      improvementEligible: false as const,
    },
  };
}

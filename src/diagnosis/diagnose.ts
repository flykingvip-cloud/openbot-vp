/**
 * Vertical-slice diagnose() — Session → Agent → Skill → Tool.
 * Completion comes from runner stopWhen + collected Evidence.
 * Never copies fixture completion / verification / case / findings.
 */
import type { DiagnosisEvidenceAdapter } from "./adapters.js";
import {
  buildCompositeDiagnosisReportFromDiagnoseOutput,
  persistCompositeDiagnosisProjectionSnapshot,
} from "./report-query-projection-snapshot.js";
import { replayDiagnosticRunGraph, stripRunCompletion, type ReplayResult } from "./runner.js";
import type { DiagnosisStorePaths } from "./store-readers.js";
import {
  validateDiagnoserResult,
  type DiagnoserContext,
  type DiagnoserResult,
  type DiagnosticEvidence,
  type DiagnosticObservation,
  type DiagnosticRun,
  type DiagnosticVerification,
  type EvidenceRequirement,
  type TrustedTenantContext,
} from "./types.js";
import type { GovernanceReceiptRef } from "./verification.js";

export type DiagnoseInput = {
  schemaVersion: 1;
  run: DiagnosticRun;
  evidences: readonly DiagnosticEvidence[];
  trusted: TrustedTenantContext;
  stores?: DiagnosisStorePaths;
  governanceReceipt?: GovernanceReceiptRef;
  adapters?: readonly DiagnosisEvidenceAdapter[];
};

export type DiagnoseOutput = {
  schemaVersion: 1;
  run: DiagnosticRun;
  result: DiagnoserResult;
  collected: DiagnosticEvidence[];
  missing: EvidenceRequirement[];
  verification: DiagnosticVerification | null;
};

export async function diagnose(input: DiagnoseInput): Promise<DiagnoseOutput> {
  const replayed = await replayDiagnosticRunGraph({
    graph: {
      schemaVersion: 1,
      graphKind: "DiagnosticRunGraph",
      run: stripRunCompletion(input.run),
      evidences: [...input.evidences],
      verification: null,
    },
    trusted: input.trusted,
    stores: input.stores,
    governanceReceipt: input.governanceReceipt,
    adapters: input.adapters,
  });
  const output: DiagnoseOutput = {
    schemaVersion: 1,
    run: replayed.run,
    result: resultFromReplay(replayed, input.trusted),
    collected: replayed.collected,
    missing: replayed.missing,
    verification: replayed.verification,
  };
  try {
    const report = buildCompositeDiagnosisReportFromDiagnoseOutput(output, input.trusted);
    persistCompositeDiagnosisProjectionSnapshot(report, input.trusted);
  } catch {
    // Snapshot persist must not break diagnose replay.
  }
  return output;
}

export async function diagnoseFromContext(context: DiagnoserContext): Promise<DiagnoserResult> {
  const output = await diagnose({
    schemaVersion: 1,
    run: context.run,
    evidences: context.evidence,
    trusted: context.trusted,
  });
  return output.result;
}

function resultFromReplay(replayed: ReplayResult, trusted: TrustedTenantContext): DiagnoserResult {
  const observations = replayed.collected.map((evidence, index) =>
    observationFromEvidence(evidence, index),
  );
  const derived = replayed.run.completion ?? "INCONCLUSIVE";
  const assessmentId = `assess-${replayed.run.runId}`;
  return validateDiagnoserResult(
    {
      schemaVersion: 1,
      observations,
      assessments: [
        {
          schemaVersion: 1,
          assessmentId,
          observationIds: observations.map((row) => row.observationId),
          code: `completion.${derived}`,
          verdict: derived === "CONFIRMED" || derived === "PROBABLE" ? "anomalous" : "unknown",
          ruleId: "rule.stop_when.v1",
        },
      ],
      attributions: [],
      hypotheses: [
        {
          schemaVersion: 1,
          hypothesisId: `hyp-${replayed.run.runId}`,
          code: derived,
          state:
            derived === "CONFIRMED"
              ? "confirmed"
              : derived === "PROBABLE"
                ? "supported"
                : derived === "INCONCLUSIVE"
                  ? "unknown"
                  : "candidate",
          confidence: { evidence: 0.5, assessment: 0.5, rootCause: 0, impact: 0 },
          supportingEvidenceIds: replayed.collected.map((evidence) => evidence.evidenceId),
          contradictingEvidenceIds: [],
          missingEvidence: replayed.missing.map((req) => req.source),
          scoringMethod: "rule_v1",
        },
      ],
      findingDrafts: [],
      relationCandidates: [],
      nextEvidenceRequests: replayed.missing,
    },
    trusted,
  );
}

function observationFromEvidence(
  evidence: DiagnosticEvidence,
  index: number,
): DiagnosticObservation {
  const predicate = predicateForSource(evidence);
  const raw = evidence.summary[predicate];
  const value =
    typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" || raw === null
      ? raw
      : null;
  return {
    schemaVersion: 1,
    observationId: `obs-${evidence.evidenceId || index}`,
    target: evidence.target,
    predicate,
    value,
    evidenceIds: [evidence.evidenceId],
    observedAt: evidence.observedAt,
  };
}

function predicateForSource(evidence: DiagnosticEvidence): string {
  switch (evidence.source) {
    case "session_store":
      return "messageReceived";
    case "agent_runner":
      return "agentStarted";
    case "skill_invocation":
      return "skillStarted";
    case "tool_runtime":
      return "timeout";
    case "agent_runtime_health":
      return "health";
    case "channel_health":
      return "healthy";
    case "doctor_check":
      return "verdict";
    default:
      return "observed";
  }
}

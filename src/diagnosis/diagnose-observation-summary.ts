/**
 * Honest observation summary for diagnose() → composite report conversion.
 *
 * diagnose() emits assessments/hypotheses and collected evidence, not
 * findingDrafts. The composite report historically dropped the runner
 * CONFIRMED tool-timeout observation because it only copied findings, which
 * stayed empty. This module composes display meaning from collected evidence,
 * missing evidence, accepted root causes, and hypothesis root-cause
 * confidence. It does not invent findings or raise root-cause confidence.
 */
import type { DiagnoseOutput } from "./diagnose.js";
import type { DiagnosisCompletion, DiagnosticHypothesis } from "./types.js";

export const TOOL_TIMEOUT_UNCONFIRMED_ROOT_CAUSE_MISSING_ROUTE_TEXT =
  "已观察到工具超时；根因尚未确认；路由证据缺失。" as const;

export type DiagnoseObservationSummary = {
  text: string;
  observedToolTimeout: boolean;
  rootCauseConfirmed: boolean;
  routeResolutionMissing: boolean;
  runnerCompletion: string | null;
  reportCompletion: DiagnosisCompletion | null;
};

type EvidenceLike = {
  source?: string;
  summary?: Record<string, unknown> | undefined;
};

type MissingLike = { source?: string };

export function isToolTimeoutEvidence(evidence: EvidenceLike): boolean {
  if (evidence.source !== "tool_runtime") {
    return false;
  }
  const summary = evidence.summary ?? {};
  if (summary.timeout === true) {
    return true;
  }
  const errorClass = typeof summary.errorClass === "string" ? summary.errorClass.toLowerCase() : "";
  return errorClass === "timeout" || errorClass === "tool_timeout";
}

export function hasConfirmedRootCause(params: {
  acceptedRootCauses?: readonly unknown[] | undefined;
  hypotheses?: readonly DiagnosticHypothesis[] | undefined;
}): boolean {
  if ((params.acceptedRootCauses?.length ?? 0) > 0) {
    return true;
  }
  return (params.hypotheses ?? []).some((hypothesis) => {
    const rootCause = hypothesis.confidence?.rootCause ?? 0;
    return rootCause > 0 && (hypothesis.state === "confirmed" || hypothesis.state === "supported");
  });
}

export function composeDiagnoseObservationText(params: {
  observedToolTimeout: boolean;
  rootCauseConfirmed: boolean;
  routeResolutionMissing: boolean;
}): string | null {
  const parts: string[] = [];
  if (params.observedToolTimeout) {
    parts.push("已观察到工具超时");
  }
  if (!params.rootCauseConfirmed) {
    parts.push("根因尚未确认");
  }
  if (params.routeResolutionMissing) {
    parts.push("路由证据缺失");
  }
  if (parts.length === 0) {
    return null;
  }
  return `${parts.join("；")}。`;
}

export function deriveDiagnoseObservationSummary(params: {
  collected?: readonly EvidenceLike[] | undefined;
  missing?: readonly MissingLike[] | undefined;
  acceptedRootCauses?: readonly unknown[] | undefined;
  hypotheses?: readonly DiagnosticHypothesis[] | undefined;
  runnerCompletion?: string | null;
  reportCompletion?: DiagnosisCompletion | null;
}): DiagnoseObservationSummary | null {
  const observedToolTimeout = (params.collected ?? []).some((item) => isToolTimeoutEvidence(item));
  const routeResolutionMissing = (params.missing ?? []).some(
    (item) => item.source === "route_resolution",
  );
  const rootCauseConfirmed = hasConfirmedRootCause({
    acceptedRootCauses: params.acceptedRootCauses,
    hypotheses: params.hypotheses,
  });
  const text = composeDiagnoseObservationText({
    observedToolTimeout,
    rootCauseConfirmed,
    routeResolutionMissing,
  });
  if (!text) {
    return null;
  }
  return {
    text,
    observedToolTimeout,
    rootCauseConfirmed,
    routeResolutionMissing,
    runnerCompletion: params.runnerCompletion ?? null,
    reportCompletion: params.reportCompletion ?? null,
  };
}

export function deriveDiagnoseObservationSummaryFromOutput(
  output: DiagnoseOutput,
  reportCompletion?: DiagnosisCompletion | null,
): DiagnoseObservationSummary | null {
  return deriveDiagnoseObservationSummary({
    collected: output.collected,
    missing: output.missing,
    hypotheses: output.result.hypotheses,
    runnerCompletion: output.run.completion ?? null,
    reportCompletion: reportCompletion ?? null,
  });
}

export function mergeDiagnoseObservationSummaries(
  rows: readonly (DiagnoseObservationSummary | null | undefined)[],
): DiagnoseObservationSummary | null {
  const present = rows.filter((row): row is DiagnoseObservationSummary => Boolean(row));
  if (present.length === 0) {
    return null;
  }
  return deriveDiagnoseObservationSummary({
    collected: present.some((row) => row.observedToolTimeout)
      ? [{ source: "tool_runtime", summary: { timeout: true } }]
      : [],
    missing: present.some((row) => row.routeResolutionMissing)
      ? [{ source: "route_resolution" }]
      : [],
    acceptedRootCauses: present.every((row) => row.rootCauseConfirmed) ? [{}] : [],
    runnerCompletion: present.map((row) => row.runnerCompletion).find(Boolean) ?? null,
    reportCompletion: present.map((row) => row.reportCompletion).find(Boolean) ?? null,
  });
}

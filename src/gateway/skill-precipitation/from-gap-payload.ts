/**
 * Adapt capability-gap candidate payloads into TaskTrajectorySummary when rich
 * trajectory fields are present; otherwise produce a partial summary.
 */

import type { TaskTrajectorySummary } from "./types.js";

export type CapabilityGapTrajectoryFields = {
  reason?: string | null;
  detail?: string | null;
  userLanguageSummary?: string | null;
  sourceEvidenceRefs?: string[] | null;
  occurrenceCount?: number | null;
  explicitMarker?: boolean | null;
  /** Optional rich trajectory attached by sensors / future ingest. */
  trajectory?: TaskTrajectorySummary | null;
  /** Optional ordered steps (alias). */
  steps?: TaskTrajectorySummary["steps"];
  redLines?: string[] | null;
  acceptance?: string[] | null;
  failureModes?: string[] | null;
  toolsUsed?: string[] | null;
  userCorrections?: string[] | null;
  succeeded?: boolean | null;
  evidenceId?: string | null;
};

/**
 * Build a trajectory summary from a capability-gap payload.
 * Prefer payload.trajectory; otherwise lift flat fields + reason/detail.
 */
export function trajectoryFromCapabilityGapPayload(
  payload: CapabilityGapTrajectoryFields,
  opts?: { proposalId?: string | null; fallbackEvidenceId?: string | null },
): TaskTrajectorySummary {
  if (payload.trajectory && typeof payload.trajectory === "object") {
    const base = payload.trajectory;
    const refs = [
      ...(base.sourceEvidenceRefs ?? []),
      ...(payload.sourceEvidenceRefs ?? []),
      opts?.fallbackEvidenceId,
      opts?.proposalId ? `proposal:${opts.proposalId}` : null,
    ].filter((x): x is string => typeof x === "string" && Boolean(x.trim()));
    return {
      ...base,
      sourceEvidenceRefs: refs,
      whenToUse:
        base.whenToUse ?? payload.userLanguageSummary ?? payload.detail ?? payload.reason ?? null,
      detail: base.detail ?? payload.detail ?? payload.reason ?? null,
    };
  }

  const refs = [
    ...(payload.sourceEvidenceRefs ?? []),
    payload.evidenceId,
    opts?.fallbackEvidenceId,
    opts?.proposalId ? `proposal:${opts.proposalId}` : null,
  ].filter((x): x is string => typeof x === "string" && Boolean(x.trim()));

  return {
    whenToUse: payload.userLanguageSummary ?? payload.detail ?? payload.reason ?? null,
    nameHint: payload.userLanguageSummary ?? payload.detail ?? payload.reason ?? null,
    steps: payload.steps ?? null,
    redLines: payload.redLines ?? null,
    acceptance: payload.acceptance ?? null,
    failureModes: payload.failureModes ?? null,
    toolsUsed: payload.toolsUsed ?? null,
    userCorrections: payload.userCorrections ?? null,
    succeeded: payload.succeeded ?? (payload.explicitMarker ? true : null),
    sourceEvidenceRefs: refs,
    detail: payload.detail ?? payload.reason ?? null,
  };
}

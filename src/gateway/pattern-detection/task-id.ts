/**
 * Resolve a stable pattern independence task id from run context.
 * Never returns sessionKey (would collapse a long session into one sample).
 */

export type PatternTaskIdSources = {
  runId: string;
  sessionKey?: string | null;
  /** Cron / inter-session provenance on the followup run. */
  inputProvenance?: {
    kind?: string;
    cronJobId?: string;
    cronRunId?: string;
    originSessionId?: string;
    sourceSessionKey?: string;
  } | null;
  /** Explicit collaboration / fabric task id when present. */
  collaborationTaskId?: string | null;
  /** Knowledge / deliverable lineage id when the run is tied to a generation lineage. */
  lineageId?: string | null;
  /** Optional deliverable id after capture. */
  deliverableId?: string | null;
};

/**
 * Prefer durable multi-run identities over single turns.
 * Returns null → independence falls back to runId in the store.
 */
export function resolvePatternTaskId(sources: PatternTaskIdSources): string | null {
  const collab = sources.collaborationTaskId?.trim();
  if (collab && collab !== sources.sessionKey?.trim()) {
    return `collab:${collab}`;
  }
  const deliverable = sources.deliverableId?.trim();
  if (deliverable) {
    return `deliverable:${deliverable}`;
  }
  const lineage = sources.lineageId?.trim();
  if (lineage) {
    return `lineage:${lineage}`;
  }
  const prov = sources.inputProvenance;
  if (prov?.kind === "cron" && prov.cronJobId?.trim()) {
    const job = prov.cronJobId.trim();
    const cronRun = prov.cronRunId?.trim() || sources.runId;
    return `cron:${job}:${cronRun}`;
  }
  if (prov?.kind === "inter_session" && prov.originSessionId?.trim()) {
    return `inter:${prov.originSessionId.trim()}:${sources.runId}`;
  }
  return null;
}

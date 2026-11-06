/** Read-only metadata projection. Never interprets a run terminal as task acceptance. */
export type RuntimeObservation = {
  eventId: string;
  runId: string;
  sourceRunId: string | null;
  sequence: number;
  occurredAt: number;
  receivedAt: number;
  stream: string;
  phase: string | null;
  capabilityCallId: string | null;
  coverage: "execution_only";
  missing: readonly string[];
};
export type RuntimeObservationSnapshot = {
  events: readonly RuntimeObservation[];
  partial: boolean;
  reasons: readonly string[];
};
const observations = new WeakMap<
  object,
  { events: RuntimeObservation[]; reasons: Set<string>; sessionKey: string }
>();
/** Per-host bounded projection. Unknown session events are never associated by guessing. */
export function recordRuntimeObservation(
  host: object,
  sessionKey: string,
  value: unknown,
  receivedAt: number,
): void {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { sessionKey?: unknown }).sessionKey !== sessionKey ||
    !sessionKey
  ) {
    return;
  }
  const event = projectRuntimeObservation(value, receivedAt);
  if (!event) {
    return;
  }
  let state = observations.get(host);
  if (!state || state.sessionKey !== sessionKey) {
    state = {
      events: [],
      reasons: new Set(["no_durable_replay", "identity_links_missing"]),
      sessionKey,
    };
    observations.set(host, state);
  }
  if (state.events.some((row) => row.eventId === event.eventId)) {
    return;
  }
  const previous = state.events
    .filter((row) => row.runId === event.runId && row.sourceRunId === event.sourceRunId)
    .at(-1);
  if (previous && event.sequence !== previous.sequence + 1) {
    state.reasons.add("sequence_gap_or_reorder");
  }
  if (!previous && event.sequence > 1) {
    state.reasons.add("incomplete_run_prefix");
  }
  state.events.push(event);
  if (state.events.length > 200) {
    state.events.splice(0, state.events.length - 200);
    state.reasons.add("retention_limit");
  }
}
export function readRuntimeObservations(
  host: object,
  sessionKey: string,
): RuntimeObservationSnapshot {
  const state = observations.get(host);
  if (!state || state.sessionKey !== sessionKey) {
    return { events: [], partial: true, reasons: ["not_observed"] };
  }
  return {
    events: state.events.map((event) => ({ ...event, missing: [...event.missing] })),
    partial: true,
    reasons: [...state.reasons],
  };
}
export function clearRuntimeObservations(host: object): void {
  observations.delete(host);
}
export function projectRuntimeObservation(
  value: unknown,
  receivedAt: number,
): RuntimeObservation | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.runId !== "string" ||
    !row.runId.trim() ||
    typeof row.seq !== "number" ||
    !Number.isSafeInteger(row.seq) ||
    row.seq < 0 ||
    typeof row.ts !== "number" ||
    !Number.isFinite(row.ts) ||
    typeof row.stream !== "string" ||
    !Number.isFinite(receivedAt)
  ) {
    return null;
  }
  const data =
    row.data && typeof row.data === "object" ? (row.data as Record<string, unknown>) : {};
  return {
    eventId: JSON.stringify([
      row.runId,
      typeof row.sourceRunId === "string" ? row.sourceRunId : null,
      row.seq,
    ]),
    runId: row.runId,
    sourceRunId:
      typeof row.sourceRunId === "string" && row.sourceRunId.trim() ? row.sourceRunId : null,
    sequence: row.seq,
    occurredAt: row.ts,
    receivedAt,
    stream: row.stream,
    phase: typeof data.phase === "string" ? data.phase : null,
    capabilityCallId: typeof data.toolCallId === "string" ? data.toolCallId : null,
    coverage: "execution_only",
    missing: ["scenario_task_ref", "admitted_work_id", "outcome_revision", "source_provenance"],
  };
}

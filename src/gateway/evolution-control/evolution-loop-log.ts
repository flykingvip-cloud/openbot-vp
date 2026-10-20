/**
 * Structured evolution-loop logs. Never emit secrets, tokens, cookies, or raw credentials.
 */
export const EVOLUTION_LOOP_EVENTS = [
  "evolution.outcome.written",
  "evolution.outcome.write_failed",
  "evolution.attribution.accepted",
  "evolution.attribution.rejected",
  "evolution.observation.created",
  "evolution.observation.idempotent",
  "evolution.observation.unavailable",
  "evolution.effect_verification.created",
  "evolution.effect_verification.unavailable",
  "evolution.promotion.accepted",
  "evolution.promotion.rejected",
  "evolution.capability.gap_recorded",
] as const;

export type EvolutionLoopEvent = (typeof EVOLUTION_LOOP_EVENTS)[number];

export type EvolutionLoopLogFields = {
  runId?: string | null;
  agentId?: string | null;
  tenantId?: string | null;
  surfaceId?: string | null;
  taskId?: string | null;
  reason: string;
};

export type EvolutionLoopLogRecord = EvolutionLoopLogFields & {
  event: EvolutionLoopEvent;
};

const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|token|accessToken|refreshToken|idToken|password|passwd|secret|privateKey|private_key|apiKey|api_key|credential|credentials|ownershipProof)$/i;

const captured: EvolutionLoopLogRecord[] = [];
let sink: ((record: EvolutionLoopLogRecord) => void) | undefined;

function redactValue(value: unknown): unknown {
  if (typeof value === "string" && /^(evop1\.|Bearer\s|sk-|-----BEGIN)/.test(value)) {
    return "[redacted]";
  }
  return value;
}

export function sanitizeEvolutionLoopFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) {
      continue;
    }
    out[key] = redactValue(value);
  }
  return out;
}

export function logEvolutionLoop(event: EvolutionLoopEvent, fields: EvolutionLoopLogFields): void {
  const record: EvolutionLoopLogRecord = {
    event,
    runId: fields.runId?.trim() || null,
    agentId: fields.agentId?.trim() || null,
    tenantId: fields.tenantId?.trim() || null,
    surfaceId: fields.surfaceId?.trim() || null,
    ...(fields.taskId !== undefined ? { taskId: fields.taskId?.trim() || null } : {}),
    reason: fields.reason.trim() || "unspecified",
  };
  captured.push(record);
  sink?.(record);
  const payload = sanitizeEvolutionLoopFields({ ...record });
  console.info(JSON.stringify(payload));
}

export function resetEvolutionLoopLogsForTests(): void {
  captured.length = 0;
}

export function listEvolutionLoopLogsForTests(): EvolutionLoopLogRecord[] {
  return [...captured];
}

export function setEvolutionLoopLogSinkForTests(
  next?: (record: EvolutionLoopLogRecord) => void,
): void {
  sink = next;
}

export function reportEvolutionOutcomeWriteFailure(fields: {
  runId?: string | null;
  agentId?: string | null;
  tenantId?: string | null;
  taskId?: string | null;
  reason: string;
}): void {
  logEvolutionLoop("evolution.outcome.write_failed", {
    runId: fields.runId ?? null,
    agentId: fields.agentId ?? null,
    tenantId: fields.tenantId ?? null,
    taskId: fields.taskId ?? null,
    surfaceId: "task.execution",
    reason: fields.reason,
  });
}

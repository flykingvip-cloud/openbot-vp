import type { RuntimeOutboxEvent } from "./outbox-consumer.js";

export type RuntimeProjectionPorts = {
  /** Each port must commit event receipt together with its projection mutation. */
  growthCapture?: (eventId: string, executionId: string, agentId: string) => Promise<void>;
  growthOperational?: (
    eventId: string,
    agentId: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  growth: (eventId: string, executionId: string, agentId: string) => Promise<void>;
  statistics: (eventId: string, executionId: string, agentId: string) => Promise<void>;
  statisticsOutcome?: (
    eventId: string,
    executionId: string,
    agentId: string,
    success: boolean,
  ) => Promise<void>;
  aor: (eventId: string, executionId: string, feedback: Record<string, unknown>) => Promise<void>;
  /** Recovery must continue recorded work, never blindly regenerate external writes. */
  recovery: (eventId: string, executionId: string, reason: string) => Promise<void>;
};

/** No default handler: unknown events must never be acknowledged as processed. */
export function resolveRuntimeEventHandler(
  ports: RuntimeProjectionPorts,
  event: RuntimeOutboxEvent,
) {
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    return undefined;
  }
  const payload = event.payload as Record<string, unknown>;
  if (
    payload.type === "growth.capture" &&
    typeof payload.agentId === "string" &&
    payload.agentId.trim() &&
    ports.growthCapture
  ) {
    const capture = ports.growthCapture;
    return async () => capture(event.event_id, event.execution_id, payload.agentId as string);
  }
  if (
    payload.type === "growth.operational" &&
    typeof payload.agentId === "string" &&
    payload.agentId.trim() &&
    ports.growthOperational
  ) {
    const consume = ports.growthOperational;
    return async () => consume(event.event_id, payload.agentId as string, payload);
  }
  if (
    payload.type === "statistics.outcome" &&
    typeof payload.agentId === "string" &&
    payload.agentId.trim() &&
    typeof payload.success === "boolean" &&
    ports.statisticsOutcome
  ) {
    const handler = ports.statisticsOutcome;
    return async () =>
      handler(
        event.event_id,
        event.execution_id,
        payload.agentId as string,
        payload.success as boolean,
      );
  }
  if (payload.state === "waiting" && typeof payload.reason === "string" && payload.reason.trim()) {
    return async () => ports.recovery(event.event_id, event.execution_id, payload.reason as string);
  }
  if (
    (payload.type === "growth.refresh" || payload.type === "statistics.refresh") &&
    typeof payload.agentId === "string" &&
    payload.agentId.trim()
  ) {
    const port = payload.type === "growth.refresh" ? ports.growth : ports.statistics;
    return async () => port(event.event_id, event.execution_id, payload.agentId as string);
  }
  if (
    payload.type === "aor.feedback" &&
    payload.feedback &&
    typeof payload.feedback === "object" &&
    !Array.isArray(payload.feedback)
  ) {
    return async () =>
      ports.aor(event.event_id, event.execution_id, payload.feedback as Record<string, unknown>);
  }
  return undefined;
}

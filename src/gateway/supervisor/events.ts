/**
 * supervisor/events.ts — gateway WS event sink for supervised task progress.
 *
 * Reporter persists events to JSONL; this module fans out live updates to
 * subscribed WS connections (`supervisor.task.subscribe`).
 */

export type SupervisorTaskEventType = "task_started" | "milestone" | "progress" | "final_report";

export type SupervisorTaskEventPayload = {
  taskId: string;
  type: SupervisorTaskEventType;
  at: string;
  state?: string;
  goal?: string;
  summary?: string;
  /** Authoritative dispatch/run id for correlation (P0-3). */
  runId?: string;
  progress?: Record<string, unknown>;
};

export type SupervisorTaskEventSink = (payload: SupervisorTaskEventPayload) => void;

type RecipientEntry = {
  connIds: Set<string>;
  updatedAt: number;
};

const RECIPIENT_TTL_MS = 10 * 60 * 1000;

let eventSink: SupervisorTaskEventSink | null = null;
const recipients = new Map<string, RecipientEntry>();

function pruneRecipients(): void {
  if (recipients.size === 0) {
    return;
  }
  const now = Date.now();
  for (const [taskId, entry] of recipients) {
    if (now - entry.updatedAt >= RECIPIENT_TTL_MS) {
      recipients.delete(taskId);
    }
  }
}

export function setSupervisorTaskEventSink(sink: SupervisorTaskEventSink | null): void {
  eventSink = sink;
}

export function registerSupervisorTaskEventRecipient(taskId: string, connId: string): void {
  const normalizedTaskId = taskId.trim();
  const normalizedConnId = connId.trim();
  if (!normalizedTaskId || !normalizedConnId) {
    return;
  }
  const now = Date.now();
  const existing = recipients.get(normalizedTaskId);
  if (existing) {
    existing.connIds.add(normalizedConnId);
    existing.updatedAt = now;
  } else {
    recipients.set(normalizedTaskId, {
      connIds: new Set([normalizedConnId]),
      updatedAt: now,
    });
  }
  pruneRecipients();
}

export function getSupervisorTaskEventRecipients(taskId: string): ReadonlySet<string> | undefined {
  const entry = recipients.get(taskId.trim());
  if (!entry) {
    return undefined;
  }
  entry.updatedAt = Date.now();
  pruneRecipients();
  return entry.connIds;
}

export function emitSupervisorTaskEvent(payload: SupervisorTaskEventPayload): void {
  eventSink?.(payload);
}

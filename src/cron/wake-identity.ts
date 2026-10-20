/**
 * Cron wake identity (EA-B4 / EA-I5).
 *
 * A job id is a wake key, not ConversationTask identity.
 * Only an explicit `conversationTaskId` may be treated as a task reference.
 * This module never creates ConversationTask rows.
 */

export type CronWakeRef =
  | { kind: "conversation_task"; taskId: string }
  | { kind: "wake_key"; wakeKey: string; jobId: string };

export type CronWakeIdentityJob = {
  id: string;
  conversationTaskId?: string | null;
};

function looksLikeSessionOrJobKey(value: string): boolean {
  return /^(agent|session|cron):/i.test(value);
}

export function normalizeConversationTaskIdRef(raw: unknown): string | null {
  if (raw === null) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128 || looksLikeSessionOrJobKey(trimmed)) {
    return null;
  }
  return trimmed;
}

export function resolveCronWakeRef(job: CronWakeIdentityJob): CronWakeRef {
  const taskId = normalizeConversationTaskIdRef(job.conversationTaskId ?? undefined);
  if (taskId) {
    return { kind: "conversation_task", taskId };
  }
  const jobId = job.id.trim();
  return { kind: "wake_key", wakeKey: `cron:${jobId}`, jobId };
}

/** Slot key for Focus Policy. Bound jobs share the ConversationTask id. */
export function cronWakeIncomingTaskId(job: CronWakeIdentityJob): string {
  const ref = resolveCronWakeRef(job);
  return ref.kind === "conversation_task" ? ref.taskId : ref.wakeKey;
}

/** Ledger file key. Unbound jobs keep the existing job.id path. */
export function resolveCronLedgerTaskId(job: CronWakeIdentityJob): string {
  const ref = resolveCronWakeRef(job);
  return ref.kind === "conversation_task" ? ref.taskId : job.id;
}

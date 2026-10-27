/**
 * W4 wrap-up: in-process pending ledger linking prompt injection → tip attach.
 *
 * Keyed by **runId / taskId** only (`run:<runId>` / `task:<taskId>`).
 * Never keyed by agentId — concurrent turns for the same agent must not clobber.
 * Prefer tip-durable `experienceExposure` once attached; without a reliable key, skip
 * remember entirely (verification will no-op without tip exposure).
 */

export type PendingLearningInjectionScope = {
  scopeId: string;
  botId: string;
  assetIds: string[];
};

export type PendingLearningInjection = {
  key: string;
  scopes: PendingLearningInjectionScope[];
  rememberedAtMs: number;
};

const pendingByKey = new Map<string, PendingLearningInjection>();

/** Stable pending key from runId. Empty runId → undefined (do not remember). */
export function learningExperienceRunKey(runId: string | null | undefined): string | undefined {
  const id = runId?.trim();
  return id ? `run:${id}` : undefined;
}

/** Stable pending key from taskId. Empty taskId → undefined. */
export function learningExperienceTaskKey(taskId: string | null | undefined): string | undefined {
  const id = taskId?.trim();
  return id ? `task:${id}` : undefined;
}

/** True when key looks like a task-bound key (run:/task:), not a bare agentId. */
export function isTaskBoundLearningExposureKey(key: string): boolean {
  const k = key.trim();
  return k.startsWith("run:") || k.startsWith("task:");
}

export function rememberPendingLearningInjection(params: {
  key: string;
  scopes: PendingLearningInjectionScope[];
  atMs?: number;
}): void {
  const key = params.key.trim();
  // Refuse agentId / bare keys — concurrent tasks would clobber.
  if (!key || !isTaskBoundLearningExposureKey(key) || params.scopes.length === 0) {
    return;
  }
  const scopes = params.scopes
    .map((scope) => ({
      scopeId: scope.scopeId.trim(),
      botId: scope.botId.trim(),
      assetIds: [...new Set(scope.assetIds.map((id) => id.trim()).filter(Boolean))],
    }))
    .filter((scope) => scope.scopeId && scope.botId && scope.assetIds.length > 0);
  if (scopes.length === 0) {
    return;
  }
  pendingByKey.set(key, {
    key,
    scopes,
    rememberedAtMs: params.atMs ?? Date.now(),
  });
}

/** Peek without consuming (tests). */
export function peekPendingLearningInjection(key: string): PendingLearningInjection | undefined {
  return pendingByKey.get(key.trim());
}

/** Take and clear pending injection for key. */
export function takePendingLearningInjection(key: string): PendingLearningInjection | undefined {
  const normalized = key.trim();
  const pending = pendingByKey.get(normalized);
  if (pending) {
    pendingByKey.delete(normalized);
  }
  return pending;
}

/** Test helper. */
export function clearPendingLearningInjectionsForTests(): void {
  pendingByKey.clear();
}

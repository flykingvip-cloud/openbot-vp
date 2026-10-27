/**
 * W4: in-process pending ledger linking prompt injection → later tip verification.
 *
 * Reuses nothing durable: a crash before tip close loses the link (honest gap).
 * Keyed by agentId (exposureKey). Concurrent turns for the same agent can clobber;
 * tip-durable experienceExposure (set when available) is preferred when present.
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

export function rememberPendingLearningInjection(params: {
  key: string;
  scopes: PendingLearningInjectionScope[];
  atMs?: number;
}): void {
  const key = params.key.trim();
  if (!key || params.scopes.length === 0) {
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

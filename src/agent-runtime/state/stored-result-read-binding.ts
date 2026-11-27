/**
 * Host-only stored-result read binding.
 *
 * This is not write, membership, or outbound-send authority. The binding is
 * derived from the trusted tool-factory invocation identity and must never be
 * taken from model-supplied tool parameters.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type StoredResultHostReadBindingInput = {
  sessionKey?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  taskId?: string | null;
  executionAttempt?: string | null;
};

type StoredResultReadScope = {
  currentBinding: string;
  storedBinding?: string;
};

const storedResultReadScope = new AsyncLocalStorage<StoredResultReadScope>();

/** Canonical v1 binding. Requires a session or run identifier; task fields are optional narrowing. */
export function computeStoredResultHostReadBinding(
  input: StoredResultHostReadBindingInput,
): string | undefined {
  const fields: Record<string, string> = {};
  const assign = (key: string, value?: string | null) => {
    const trimmed = value?.trim();
    if (trimmed) {
      fields[key] = trimmed;
    }
  };
  assign("sessionKey", input.sessionKey);
  assign("sessionId", input.sessionId);
  assign("runId", input.runId);
  assign("taskId", input.taskId);
  assign("executionAttempt", input.executionAttempt);
  if (!fields.sessionKey && !fields.sessionId && !fields.runId) {
    return undefined;
  }
  return `stored-result-read:v1:${JSON.stringify(fields)}`;
}

export function withStoredResultReadContext<T>(
  currentBinding: string,
  run: () => Promise<T>,
): Promise<T> {
  const binding = currentBinding.trim();
  if (!binding) {
    return run();
  }
  return storedResultReadScope.run({ currentBinding: binding }, run);
}

export function peekCurrentStoredResultReadBinding(): string | undefined {
  const current = storedResultReadScope.getStore()?.currentBinding?.trim();
  return current || undefined;
}

export function peekExposedStoredResultReadBinding(): string | undefined {
  const stored = storedResultReadScope.getStore()?.storedBinding?.trim();
  return stored || undefined;
}

/**
 * On first successful persist, stamp the current host binding when the journal
 * has none. Never invent a binding for an unstamped historical receipt.
 */
export function stampHostReadBindingOnSuccess(existing?: string): string | undefined {
  const prior = existing?.trim();
  if (prior) {
    return prior;
  }
  return peekCurrentStoredResultReadBinding();
}

/**
 * Expose a previously stamped binding to the read-ACL provider for this
 * invocation. An absent stamp stays absent (fail closed).
 */
export function exposeStoredHostReadBinding(stored?: string): void {
  const scope = storedResultReadScope.getStore();
  if (!scope) {
    return;
  }
  const trimmed = stored?.trim();
  scope.storedBinding = trimmed || undefined;
}

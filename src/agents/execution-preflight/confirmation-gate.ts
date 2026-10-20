/**
 * Confirmation-gate enforcement for skills that declare `required-confirmations`.
 * Completion claims stay blocked until each gate id is noted as passed.
 * Model text cannot mark a gate passed.
 */

export type ConfirmationGateStatus = {
  required: string[];
  passed: string[];
  pending: string[];
  allPassed: boolean;
};

const passedByAttempt = new Map<string, Set<string>>();

function attemptKey(taskId: string, attemptNumber: number): string {
  return `${taskId}:${attemptNumber}`;
}

export function resetConfirmationGatesForTest(): void {
  passedByAttempt.clear();
}

/** Host / UI / approve paths call this. Model text cannot. */
export function noteConfirmationPassed(
  taskId: string,
  attemptNumber: number,
  confirmationId: string,
): void {
  const id = confirmationId.trim();
  if (!id || !taskId.trim()) {
    return;
  }
  const key = attemptKey(taskId, attemptNumber);
  const set = passedByAttempt.get(key) ?? new Set<string>();
  set.add(id);
  passedByAttempt.set(key, set);
}

export function readPassedConfirmations(taskId: string, attemptNumber: number): string[] {
  const set = passedByAttempt.get(attemptKey(taskId, attemptNumber));
  return set ? [...set] : [];
}

export function evaluateConfirmationGate(params: {
  taskId: string;
  attemptNumber: number;
  requiredConfirmations: readonly string[];
}): ConfirmationGateStatus {
  const required = params.requiredConfirmations
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const passed = readPassedConfirmations(params.taskId, params.attemptNumber);
  const passedSet = new Set(passed);
  const pending = required.filter((id) => !passedSet.has(id));
  return {
    required,
    passed: required.filter((id) => passedSet.has(id)),
    pending,
    allPassed: pending.length === 0,
  };
}

/** True when the skill declares at least one confirmation gate. */
export function confirmationGateRequired(
  requiredConfirmations: readonly string[] | undefined,
): boolean {
  return (requiredConfirmations ?? []).some((item) => item.trim().length > 0);
}

/**
 * Production-usable validator: reject "done" when any required confirmation
 * is still pending. Returns unresolved risk strings for delivery evidence.
 */
export function confirmationGateUnresolvedRisks(params: {
  taskId: string;
  attemptNumber: number;
  requiredConfirmations: readonly string[];
}): string[] {
  const status = evaluateConfirmationGate(params);
  if (status.required.length === 0 || status.allPassed) {
    return [];
  }
  return status.pending.map((id) => `confirmation_gate_pending:${id}`);
}

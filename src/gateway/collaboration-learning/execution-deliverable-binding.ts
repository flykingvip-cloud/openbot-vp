/**
 * Execution-round deliverable binding (product wiring R2).
 *
 * Formal team delivery must bind the task/board/plan from the live execution
 * bag / wake request — never guess via group-wide claimant scan.
 * Wake/dispatch remembers the binding; chat final consumes it.
 */
export type ExecutionDeliverableBinding = Readonly<{
  taskId: string;
  boardItemId: string;
  todolistId?: string | null;
  planVersion?: number | null;
  stepId?: string | null;
  source: "wake_dispatch" | "execution_bag" | "explicit_run";
}>;

const bindings = new Map<string, ExecutionDeliverableBinding>();

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function executionDeliverableBindingKey(groupId: string, agentId: string): string {
  return `${compact(groupId).toLowerCase()}::${compact(agentId).toLowerCase()}`;
}

/** Remember binding for the member that is about to run. */
export function rememberExecutionDeliverableBinding(
  groupId: string,
  agentId: string,
  binding: ExecutionDeliverableBinding,
): void {
  const key = executionDeliverableBindingKey(groupId, agentId);
  if (!key.startsWith("::") && !key.endsWith("::")) {
    bindings.set(key, binding);
  }
}

/** Peek without clearing (tests / diagnostics). */
export function peekExecutionDeliverableBinding(
  groupId: string,
  agentId: string,
): ExecutionDeliverableBinding | null {
  return bindings.get(executionDeliverableBindingKey(groupId, agentId)) ?? null;
}

/** Consume binding for formal deliverable submit (one-shot). */
export function consumeExecutionDeliverableBinding(
  groupId: string,
  agentId: string,
): ExecutionDeliverableBinding | null {
  const key = executionDeliverableBindingKey(groupId, agentId);
  const value = bindings.get(key) ?? null;
  if (value) {
    bindings.delete(key);
  }
  return value;
}

/** Test helper. */
export function clearExecutionDeliverableBindings(): void {
  bindings.clear();
}

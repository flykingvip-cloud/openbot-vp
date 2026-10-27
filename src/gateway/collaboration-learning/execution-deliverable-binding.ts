/**
 * Execution-round deliverable binding (product wiring R3/R5).
 *
 * Formal team delivery must carry an unconfusable run binding from the real
 * dispatcher into the member run / final — never a process Map keyed by
 * groupId+agentId (that races across tasks and tenants).
 *
 * Missing binding → refuse formal submit. No "latest member binding" fallback.
 * wake_dispatch requires todolistId + planVersion + stepId + attemptId + opKey
 * from the durable wake-op / execution attempt (not freshly minted UUIDs that
 * stand in for existing execution identity).
 */
export type ExecutionDeliverableBinding = Readonly<{
  /** Trusted tenant id when known (disambiguates same local groupId). */
  tenantId?: string | null;
  groupId: string;
  taskId: string;
  boardItemId: string;
  todolistId?: string | null;
  planVersion?: number | null;
  stepId?: string | null;
  /**
   * Run identity tied to the durable wake-op + attempt (e.g. wake_run:op:attempt).
   * Must not be an unrelated random UUID that merely "looks unique".
   */
  runId: string;
  /** Wake-op executionAttemptId (or equivalent durable attempt identity). */
  attemptId?: string | null;
  /** Wake-op idempotency key that owns the attempt. */
  opKey?: string | null;
  /** Executing bot / member this binding authorizes (scope check). */
  agentId?: string | null;
  source: "wake_dispatch" | "execution_bag" | "explicit_run";
}>;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Validate required fields; returns null when incomplete.
 * Production wake_dispatch bindings must carry plan + step + op/attempt identity —
 * omitting them must not skip submit gates.
 */
export function normalizeExecutionDeliverableBinding(
  raw: Partial<ExecutionDeliverableBinding> | null | undefined,
): ExecutionDeliverableBinding | null {
  if (!raw) {
    return null;
  }
  const groupId = compact(raw.groupId);
  const taskId = compact(raw.taskId);
  const boardItemId = compact(raw.boardItemId);
  const runId = compact(raw.runId);
  if (!groupId || !taskId || !boardItemId || !runId) {
    return null;
  }
  const source = raw.source;
  if (source !== "wake_dispatch" && source !== "execution_bag" && source !== "explicit_run") {
    return null;
  }
  const todolistId = compact(raw.todolistId) || null;
  const planVersion =
    typeof raw.planVersion === "number" && Number.isFinite(raw.planVersion)
      ? raw.planVersion
      : null;
  const stepId = compact(raw.stepId) || null;
  const attemptId = compact(raw.attemptId) || null;
  const opKey = compact(raw.opKey) || null;
  const agentId = compact(raw.agentId) || null;
  const tenantId = compact(raw.tenantId) || null;

  // Production wake path: refuse incomplete plan/attempt/op so callers cannot
  // skip confirmed-plan gates or invent unbound execution identity by omission.
  if (source === "wake_dispatch") {
    if (!todolistId || planVersion === null || !stepId || !attemptId || !opKey) {
      return null;
    }
  }

  return {
    tenantId,
    groupId,
    taskId,
    boardItemId,
    todolistId,
    planVersion,
    stepId,
    runId,
    attemptId,
    opKey,
    agentId,
    source,
  };
}

/** Build binding for a wake / bag dispatch (caller supplies durable run/attempt ids). */
export function buildExecutionDeliverableBinding(params: {
  tenantId?: string | null;
  groupId: string;
  taskId: string;
  boardItemId: string;
  todolistId?: string | null;
  planVersion?: number | null;
  stepId?: string | null;
  runId: string;
  attemptId?: string | null;
  opKey?: string | null;
  agentId?: string | null;
  source?: ExecutionDeliverableBinding["source"];
}): ExecutionDeliverableBinding | null {
  return normalizeExecutionDeliverableBinding({
    ...params,
    source: params.source ?? "wake_dispatch",
  });
}

/**
 * Derive a stable run id from durable wake-op + attempt identities.
 * Do not mint an independent UUID that pretends to be the execution record.
 */
export function runIdFromWakeOpAttempt(params: { opKey: string; attemptId: string }): string {
  const opKey = compact(params.opKey);
  const attemptId = compact(params.attemptId);
  return `wake_run:${opKey}:${attemptId}`;
}

/** Compare request / bag / binding scope fields; empty sides are skipped. */
export function executionBindingScopeMismatch(params: {
  binding: ExecutionDeliverableBinding;
  tenantId?: string | null;
  groupId?: string | null;
  taskId?: string | null;
  boardItemId?: string | null;
  todolistId?: string | null;
  planVersion?: number | null;
  stepId?: string | null;
  agentId?: string | null;
  attemptId?: string | null;
  opKey?: string | null;
  runId?: string | null;
}): string | null {
  const b = params.binding;
  const cmp = (left: string, right: string, label: string): string | null => {
    if (!left || !right) {
      return null;
    }
    if (left.toLowerCase() !== right.toLowerCase()) {
      return `${label}_mismatch`;
    }
    return null;
  };
  const checks: Array<string | null> = [
    cmp(compact(params.tenantId), compact(b.tenantId), "tenant"),
    cmp(compact(params.groupId), compact(b.groupId), "group"),
    cmp(compact(params.taskId), compact(b.taskId), "task"),
    cmp(compact(params.boardItemId), compact(b.boardItemId), "board"),
    cmp(compact(params.todolistId), compact(b.todolistId), "todolist"),
    cmp(compact(params.stepId), compact(b.stepId), "step"),
    cmp(compact(params.agentId), compact(b.agentId), "agent"),
    cmp(compact(params.attemptId), compact(b.attemptId), "attempt"),
    cmp(compact(params.opKey), compact(b.opKey), "op"),
    cmp(compact(params.runId), compact(b.runId), "run"),
  ];
  if (
    typeof params.planVersion === "number" &&
    Number.isFinite(params.planVersion) &&
    typeof b.planVersion === "number" &&
    Number.isFinite(b.planVersion) &&
    params.planVersion !== b.planVersion
  ) {
    return "plan_version_mismatch";
  }
  return checks.find((entry) => entry !== null) ?? null;
}

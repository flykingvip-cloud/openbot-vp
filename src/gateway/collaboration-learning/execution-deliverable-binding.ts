/**
 * Execution-round deliverable binding (product wiring R3/R5).
 *
 * Formal team delivery must carry an unconfusable run binding from the real
 * dispatcher into the member run / final — never a process Map keyed by
 * groupId+agentId (that races across tasks and tenants).
 *
 * Missing binding → refuse formal submit. No "latest member binding" fallback.
 * wake_dispatch requires todolistId + planVersion + stepId + attemptId + opKey
 * + agentId from the durable wake-op / execution attempt (not freshly minted
 * UUIDs that stand in for existing execution identity).
 * Production receipt uses productionWakeDeliverableContractFailure: request plan
 * binding, injected op/attempt, and executing agent are required (empty sides
 * are not skipped). runId must exactly equal runIdFromWakeOpAttempt(injected).
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

  // Production wake path: refuse incomplete plan/attempt/op/agent so callers
  // cannot skip confirmed-plan gates or invent unbound execution identity by omission.
  if (source === "wake_dispatch") {
    if (!todolistId || planVersion === null || !stepId || !attemptId || !opKey || !agentId) {
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

/**
 * Loose field compare. Empty sides are skipped — do not use this for the
 * production wake deliverable path (see productionWakeDeliverableContractFailure).
 */
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

function requireSameText(
  expected: string | null | undefined,
  actual: string | null | undefined,
  label: string,
): string | null {
  const left = compact(expected);
  const right = compact(actual);
  if (!left || !right) {
    return `${label}_required`;
  }
  if (left.toLowerCase() !== right.toLowerCase()) {
    return `${label}_mismatch`;
  }
  return null;
}

/**
 * Production wake deliverable receipt contract.
 *
 * Required sides that are missing reject. This does not reuse the loose
 * "skip when either side is empty" compare. runId is recomputed from the
 * injected durable op/attempt and must match exactly (case-sensitive).
 * When requireTenant is set (managed boot), a missing tenant rejects too.
 */
export function productionWakeDeliverableContractFailure(params: {
  binding: ExecutionDeliverableBinding;
  /** Managed background path: tenant must be present on request and binding. */
  requireTenant: boolean;
  tenantId?: string | null;
  groupId?: string | null;
  taskId?: string | null;
  boardItemId?: string | null;
  /** Executing agent (lead / member). Required. */
  agentId?: string | null;
  /** Injected durable wake-op key (claim). Required. Not read from the binding. */
  opKey?: string | null;
  /** Injected durable attempt id (claim). Required. Not read from the binding. */
  attemptId?: string | null;
  /** Request plan-confirm binding. The object and its fields are required. */
  planConfirmBinding?: {
    todolistId?: string | null;
    confirmedVersion?: number | null;
    stepId?: string | null;
  } | null;
}): string | null {
  const binding = params.binding;
  if (binding.source !== "wake_dispatch") {
    return "wake_dispatch_required";
  }

  const agentFail = requireSameText(params.agentId, binding.agentId, "agent");
  if (agentFail) {
    return agentFail;
  }

  const injectedOp = compact(params.opKey);
  const injectedAttempt = compact(params.attemptId);
  const opFail = requireSameText(injectedOp, binding.opKey, "op");
  if (opFail) {
    return opFail;
  }
  const attemptFail = requireSameText(injectedAttempt, binding.attemptId, "attempt");
  if (attemptFail) {
    return attemptFail;
  }

  // Exact derivation from the injected claim — not the sender's runId string,
  // and not a case-folded compare.
  const expectedRunId = runIdFromWakeOpAttempt({
    opKey: injectedOp,
    attemptId: injectedAttempt,
  });
  if (compact(binding.runId) !== expectedRunId) {
    return "run_mismatch";
  }

  const plan = params.planConfirmBinding;
  if (!plan) {
    return "plan_binding_required";
  }
  const todolistFail = requireSameText(plan.todolistId, binding.todolistId, "todolist");
  if (todolistFail) {
    return todolistFail;
  }
  if (typeof plan.confirmedVersion !== "number" || !Number.isFinite(plan.confirmedVersion)) {
    return "plan_version_required";
  }
  if (typeof binding.planVersion !== "number" || !Number.isFinite(binding.planVersion)) {
    return "plan_version_required";
  }
  if (plan.confirmedVersion !== binding.planVersion) {
    return "plan_version_mismatch";
  }
  const stepFail = requireSameText(plan.stepId, binding.stepId, "step");
  if (stepFail) {
    return stepFail;
  }

  if (params.requireTenant) {
    const tenantFail = requireSameText(params.tenantId, binding.tenantId, "tenant");
    if (tenantFail) {
      return tenantFail;
    }
  } else {
    const requestTenant = compact(params.tenantId);
    const bindingTenant = compact(binding.tenantId);
    if (
      requestTenant &&
      bindingTenant &&
      requestTenant.toLowerCase() !== bindingTenant.toLowerCase()
    ) {
      return "tenant_mismatch";
    }
  }

  const groupFail = requireSameText(params.groupId, binding.groupId, "group");
  if (groupFail) {
    return groupFail;
  }
  const taskFail = requireSameText(params.taskId, binding.taskId, "task");
  if (taskFail) {
    return taskFail;
  }
  const boardFail = requireSameText(params.boardItemId, binding.boardItemId, "board");
  if (boardFail) {
    return boardFail;
  }
  return null;
}

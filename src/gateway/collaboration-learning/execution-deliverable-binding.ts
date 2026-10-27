/**
 * Execution-round deliverable binding (product wiring R3).
 *
 * Formal team delivery must carry an unconfusable run binding from the real
 * dispatcher into the member run / final — never a process Map keyed by
 * groupId+agentId (that races across tasks and tenants).
 *
 * Missing binding → refuse formal submit. No "latest member binding" fallback.
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
  /** Unconfusable run / attempt id for this member turn. */
  runId: string;
  attemptId?: string | null;
  source: "wake_dispatch" | "execution_bag" | "explicit_run";
}>;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Validate required fields; returns null when incomplete. */
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
  return {
    tenantId: compact(raw.tenantId) || null,
    groupId,
    taskId,
    boardItemId,
    todolistId: compact(raw.todolistId) || null,
    planVersion:
      typeof raw.planVersion === "number" && Number.isFinite(raw.planVersion)
        ? raw.planVersion
        : null,
    stepId: compact(raw.stepId) || null,
    runId,
    attemptId: compact(raw.attemptId) || null,
    source,
  };
}

/** Build binding for a wake / bag dispatch (caller supplies unique runId). */
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
  source?: ExecutionDeliverableBinding["source"];
}): ExecutionDeliverableBinding | null {
  return normalizeExecutionDeliverableBinding({
    ...params,
    source: params.source ?? "wake_dispatch",
  });
}

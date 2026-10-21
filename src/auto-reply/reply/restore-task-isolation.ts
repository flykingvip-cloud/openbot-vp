/**
 * Restore must not mix historical tasks into the current task main line.
 *
 * Checkpoint `open_tasks` and ledger rows that are not the session's bound
 * active task stay pending review. A workspace file being present is not a
 * close signal — this module never writes a ledger.
 */

export const RESTORE_TASK_ISOLATION_FIELD = "openclawRestoreTaskIsolation";

export const RESTORE_OPEN_TASKS_FENCE_START = "[RESTORE_OPEN_TASKS_PENDING_REVIEW]";
export const RESTORE_OPEN_TASKS_FENCE_END = "[/RESTORE_OPEN_TASKS_PENDING_REVIEW]";

const FENCE_BLOCK = new RegExp(
  `${escapeRegExp(RESTORE_OPEN_TASKS_FENCE_START)}[\\s\\S]*?${escapeRegExp(RESTORE_OPEN_TASKS_FENCE_END)}\\n?`,
  "g",
);

export type RestorePendingReviewKind =
  | "checkpoint_open_task"
  | "missing_relationship"
  | "unbound_ledger";

export type RestorePendingReviewItem = {
  kind: RestorePendingReviewKind;
  label: string;
  taskId?: string;
  /** True when a workspace file for this artifact was observed. Never a close. */
  filePresent?: boolean;
  /** Where a non-mainline row was injected from. */
  source?: "ledger" | "restore" | "heartbeat";
};

export type RestoreTaskLedgerRow = {
  id: string;
  status: string;
  title: string;
  artifacts?: readonly string[];
  /** Batch 7 keep-only. Never produced by file-exists reconciliation. */
  surface_disposition?: "cancelled";
};

export type RestoreArtifactLedgerRow = {
  id: string;
  title: string;
  task_id?: string;
  state?: string;
};

export type RestoreTaskReconciliation = {
  /** Session-bound active ledger row. Absent when the session is unbound. */
  currentTaskId?: string;
  /** Historical rows that must not be injected as the current task. */
  pendingReview: RestorePendingReviewItem[];
  /**
   * Always empty. File existence is recorded on pending items and must not
   * close a ledger row.
   */
  autoClosedTaskIds: readonly string[];
  /** Active ledger ids left untouched, including rows whose files exist. */
  preservedActiveTaskIds: readonly string[];
};

export type RestoreTaskIsolationStamp = {
  mainline: false;
  disposition: "pending_review";
  openTasks: string[];
};

export type RestoreTaskIsolationPayload = {
  currentTaskId: string | null;
  pendingReviewCount: number;
  autoClosedTaskIds: readonly string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveBoundActiveTaskId(params: {
  taskContextId?: string | null;
  taskLedger: readonly RestoreTaskLedgerRow[];
}): string | undefined {
  const taskId = params.taskContextId?.trim();
  if (!taskId) {
    return undefined;
  }
  const match = params.taskLedger.find((task) => task.id === taskId && task.status === "active");
  return match?.id;
}

function artifactFilePresent(
  artifact: RestoreArtifactLedgerRow,
  fileExistsByArtifactKey: Readonly<Record<string, boolean>> | undefined,
): boolean {
  if (!fileExistsByArtifactKey) {
    return false;
  }
  return fileExistsByArtifactKey[artifact.id] || fileExistsByArtifactKey[artifact.title];
}

/**
 * Read-only reconciliation of checkpoint open tasks against the task ledger.
 * Does not close rows. Callers must not persist `autoClosedTaskIds`.
 */
export function reconcileRestoreTaskPointersReadOnly(params: {
  taskContextId?: string | null;
  taskLedger: readonly RestoreTaskLedgerRow[];
  artifactLedger: readonly RestoreArtifactLedgerRow[];
  checkpointOpenTasks: readonly string[];
  fileExistsByArtifactKey?: Readonly<Record<string, boolean>>;
}): RestoreTaskReconciliation {
  const currentTaskId = resolveBoundActiveTaskId({
    taskContextId: params.taskContextId,
    taskLedger: params.taskLedger,
  });
  const tasksById = new Map(params.taskLedger.map((task) => [task.id, task]));
  const pendingReview: RestorePendingReviewItem[] = [];

  for (const raw of params.checkpointOpenTasks) {
    const label = raw.trim();
    if (!label) {
      continue;
    }
    pendingReview.push({ kind: "checkpoint_open_task", label, source: "restore" });
  }

  for (const task of params.taskLedger) {
    if (task.surface_disposition === "cancelled") {
      continue;
    }
    if (task.status !== "active" || task.id === currentTaskId) {
      continue;
    }
    pendingReview.push({
      kind: "unbound_ledger",
      label: task.title.trim() || task.id,
      taskId: task.id,
      source: "ledger",
    });
  }

  for (const artifact of params.artifactLedger) {
    const taskId = artifact.task_id?.trim();
    const filePresent = artifactFilePresent(artifact, params.fileExistsByArtifactKey);
    const task = taskId ? tasksById.get(taskId) : undefined;
    const linkedToCurrent =
      Boolean(taskId) && taskId === currentTaskId && task?.status === "active";
    if (linkedToCurrent) {
      continue;
    }
    const label = artifact.title.trim() || artifact.id;
    pendingReview.push({
      kind: "missing_relationship",
      label,
      source: "restore",
      ...(taskId ? { taskId } : {}),
      ...(filePresent ? { filePresent: true } : {}),
    });
  }

  return {
    ...(currentTaskId ? { currentTaskId } : {}),
    pendingReview,
    autoClosedTaskIds: [],
    preservedActiveTaskIds: params.taskLedger
      .filter((task) => task.status === "active")
      .map((task) => task.id),
  };
}

export function emptyRestoreTaskReconciliation(): RestoreTaskReconciliation {
  return {
    pendingReview: [],
    autoClosedTaskIds: [],
    preservedActiveTaskIds: [],
  };
}

export function toRestoreTaskIsolationPayload(
  reconciliation: RestoreTaskReconciliation,
): RestoreTaskIsolationPayload {
  return {
    currentTaskId: reconciliation.currentTaskId ?? null,
    pendingReviewCount: reconciliation.pendingReview.length,
    autoClosedTaskIds: reconciliation.autoClosedTaskIds,
  };
}

/** Keep compatibility text, but fence open tasks so mainline scanners skip them. */
export function isolateLegacyRestoreTranscriptText(restoreText: string): string {
  if (restoreText.includes(RESTORE_OPEN_TASKS_FENCE_START)) {
    return restoreText;
  }
  return restoreText.replace(/^(Open tasks\b.*)$/m, (line) => {
    const labeled = /\bsource=restore\b/.test(line) ? line : `${line} source=restore`;
    return `${RESTORE_OPEN_TASKS_FENCE_START}\n${labeled}\n${RESTORE_OPEN_TASKS_FENCE_END}`;
  });
}

export function stripRestorePendingReviewFences(text: string): string {
  return text.replace(FENCE_BLOCK, "");
}

export function restoreTaskIsolationStamp(openTasks: readonly string[]): RestoreTaskIsolationStamp {
  return {
    mainline: false,
    disposition: "pending_review",
    openTasks: openTasks
      .map((task) => task.trim())
      .filter(Boolean)
      .slice(0, 5),
  };
}

function messageText(record: Record<string, unknown>): string {
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (!Array.isArray(record.content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of record.content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string") {
      parts.push(text);
    }
  }
  return parts.join("\n");
}

function recordIsIsolated(record: unknown): boolean {
  if (!record || typeof record !== "object") {
    return false;
  }
  const entry = record as Record<string, unknown>;
  const stamp = entry[RESTORE_TASK_ISOLATION_FIELD];
  if (stamp && typeof stamp === "object" && (stamp as { mainline?: unknown }).mainline === false) {
    return true;
  }
  return messageText(entry).includes(RESTORE_OPEN_TASKS_FENCE_START);
}

/** True when a transcript / history row must not join the current task main line. */
export function isRestoreTaskIsolationMessage(message: unknown): boolean {
  if (recordIsIsolated(message)) {
    return true;
  }
  if (!message || typeof message !== "object") {
    return false;
  }
  return recordIsIsolated((message as { message?: unknown }).message);
}

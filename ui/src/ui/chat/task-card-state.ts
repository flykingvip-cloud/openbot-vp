export type TaskCardState = {
  task: {
    taskId: string;
    runId: string;
    title: string;
    status: string;
    currentFocusLabel?: string | null;
    progressCount?: number | null;
    updatedAt?: number | null;
  };
  narrative: {
    sections: Array<{ type: string; lines: string[] }>;
  };
  author: string;
};

const TASK_CARD_STATES = new Map<string, TaskCardState>();

export function clearAllTaskCardStates(): void {
  TASK_CARD_STATES.clear();
}

export function getTaskCardState(runId: string): TaskCardState | null {
  return TASK_CARD_STATES.get(runId) ?? null;
}

export function initTaskCardState(
  task: TaskCardState["task"],
  narrative: TaskCardState["narrative"],
  author: string,
): void {
  TASK_CARD_STATES.set(task.runId, { task, narrative, author });
}

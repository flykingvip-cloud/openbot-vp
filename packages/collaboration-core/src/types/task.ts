export type TaskStatus =
  | "draft"
  | "ready"
  | "in_progress"
  | "blocked"
  | "review"
  | "completed"
  | "cancelled";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type Task = {
  taskId: string;
  groupId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority?: TaskPriority;
  ownerMemberId?: string;
  assignedMemberIds?: string[];
  parentTaskId?: string;
  dependsOnTaskIds?: string[];
  tags?: string[];
  dueAtMs?: number;
  startedAtMs?: number;
  completedAtMs?: number;
  createdBy?: string;
  updatedBy?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

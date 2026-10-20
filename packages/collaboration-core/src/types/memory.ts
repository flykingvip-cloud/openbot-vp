export type MemoryType = "consensus" | "constraint" | "lesson_learned" | "decision_context";
export type MemorySource = "task" | "deliverable" | "decision" | "discussion";
export type MemoryImportance = "low" | "medium" | "high" | "critical";

export type GroupMemory = {
  memoryId: string;
  groupId: string;
  type: MemoryType;
  title: string;
  content: string;
  source: MemorySource;
  sourceId?: string;
  importance: MemoryImportance;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
};

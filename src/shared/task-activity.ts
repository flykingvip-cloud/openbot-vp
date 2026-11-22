/** Read-only session-scoped facts; assistant text is never a status source. */
export type TaskActivitySnapshot = {
  sessionKey: string;
  observedAtMs: number;
  task: {
    taskId: string;
    lifecycle: "active" | "paused" | "terminal";
    health: "running" | "waiting_dependency" | "recovering" | "needs_user" | "unknown";
    waitingCount?: number;
    nextWakeAtMs?: number;
  } | null;
};

/** Trusted stop facts. No runtime callbacks or executable configuration. */
export type TaskStopScope = {
  kind: "managed" | "personal" | "internal";
  tenantId: string;
  userId: string;
  sessionKey: string;
};
export type TaskStopRecord = TaskStopScope & {
  taskId: string;
  stoppedAtMs: number;
  reason?: string;
};

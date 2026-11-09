import { openSessionManager } from "../../agents/pi-sdk/session.js";
import { makeZeroUsageSnapshot } from "../../agents/usage.js";
import { SESSION_TASK_BOARD_LOCK_OPTIONS, withFileLockSync } from "../../infra/file-lock.js";
import type { TaskCompletionBinding } from "../contracts/task-binding.js";
/** SessionManager owns the message DAG; the notice never creates a model turn. */
export function appendTaskCompletionNotice(
  sessionFile: string,
  binding: TaskCompletionBinding,
  text: string,
): boolean {
  return withFileLockSync(
    `${sessionFile}.completion-notice`,
    SESSION_TASK_BOARD_LOCK_OPTIONS,
    () => {
      const manager = openSessionManager(sessionFile);
      const idempotencyKey = `task-completion:${binding.taskId}:${binding.executionAttempt ?? ""}:${binding.deliverableVersion ?? ""}`;
      if (
        manager
          .getEntries()
          .some(
            (entry) =>
              entry.type === "message" &&
              (entry.message as unknown as { idempotencyKey?: string }).idempotencyKey ===
                idempotencyKey,
          )
      ) {
        return true;
      }
      const message = {
        role: "assistant" as const,
        content: [{ type: "text" as const, text }],
        timestamp: Date.now(),
        taskCompletionNotice: true,
        idempotencyKey,
        api: "openai-completions" as const,
        provider: "openbot",
        model: "task-completion-notice",
        stopReason: "stop" as const,
        usage: makeZeroUsageSnapshot(),
      };
      manager.appendMessage(message);
      return true;
    },
  );
}

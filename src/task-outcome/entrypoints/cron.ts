import type { TrustedScope } from "../types.js";
import { ChatTaskOutcomeAdapter } from "./chat.js";

/**
 * cron entry reuses the same result service / storage / consumers.
 * Message resend reuses task identity. Cron each fire = new task; same-fire retry reuses.
 * Session restore only when the session is the same task.
 */
export class CronTaskOutcomeAdapter extends ChatTaskOutcomeAdapter {
  readonly entrypoint = "cron" as const;

  openTask(params: { taskId: string; scope: TrustedScope; taskContractVersion: string }) {
    return this.createOrRestore({
      taskId: params.taskId,
      scope: params.scope,
      taskContractVersion: params.taskContractVersion,
      restoreIfExists: true,
    });
  }
}

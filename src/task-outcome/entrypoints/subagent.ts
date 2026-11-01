import type { TrustedScope } from "../types.js";
import { ChatTaskOutcomeAdapter } from "./chat.js";

/**
 * Subagent lane reuses the same result service. taskId is stable for the child
 * runId so retries restore the same tip. parentTaskId is set only when the
 * caller resolved an existing parent tip — never invented from agentId.
 */
export class SubagentTaskOutcomeAdapter extends ChatTaskOutcomeAdapter {
  readonly entrypoint = "subagent" as const;

  openTask(params: {
    taskId: string;
    scope: TrustedScope;
    taskContractVersion: string;
    parentTaskId?: string;
  }) {
    return this.createOrRestore({
      taskId: params.taskId,
      scope: params.scope,
      taskContractVersion: params.taskContractVersion,
      restoreIfExists: true,
      ...(params.parentTaskId?.trim() ? { parentTaskId: params.parentTaskId.trim() } : {}),
    });
  }
}

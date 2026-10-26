import type { TaskOutcomeResultService } from "../result-service.js";
import type { TrustedScope } from "../types.js";
import { ChatTaskOutcomeAdapter } from "./chat.js";

/**
 * gateway-agent entry reuses the same result service / storage / consumers.
 * Message resend reuses task identity. Cron each fire = new task; same-fire retry reuses.
 * Session restore only when the session is the same task.
 */
export class GatewayAgentTaskOutcomeAdapter extends ChatTaskOutcomeAdapter {
  readonly entrypoint = "gateway_agent" as const;

  openTask(params: { taskId: string; scope: TrustedScope; taskContractVersion: string }) {
    return this.createOrRestore({
      taskId: params.taskId,
      scope: params.scope,
      taskContractVersion: params.taskContractVersion,
      restoreIfExists: true,
    });
  }
}

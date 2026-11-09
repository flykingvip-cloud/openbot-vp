import { renderAgentSystemPrompt } from "../agent-runtime/context/index.js";
import { listDeliverableMessageChannels } from "../utils/message-channel.js";
import { resolveWorkspaceIdentityBootstrapState } from "./identity-file.js";

export { buildRuntimeLine } from "../agent-runtime/context/index.js";
export type { PromptMode } from "../agent-runtime/context/index.js";

type AgentSystemPromptInput = Omit<
  Parameters<typeof renderAgentSystemPrompt>[0],
  "deliverableMessageChannels"
>;

/** Compatibility source host: capture once, then use the shared pure renderer. */
export function buildAgentSystemPrompt(params: AgentSystemPromptInput): string {
  const deliverableMessageChannels = listDeliverableMessageChannels();
  const identityBootstrapState =
    (params.promptMode ?? "full") === "full"
      ? (params.identityBootstrapState ??
        resolveWorkspaceIdentityBootstrapState(params.workspaceDir))
      : params.identityBootstrapState;
  return renderAgentSystemPrompt({ ...params, identityBootstrapState, deliverableMessageChannels });
}

/**
 * Single inbound write gate.
 * TaskOutcome negation is not accepted from free text.
 * A sentence that clarifies or is ignored does not also update the workspace task.
 */
import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import {
  planInboundFeedbackDisposition,
  UNBOUND_TASK_NEGATION_CLARIFY,
  type InboundFeedbackDisposition,
} from "../../task-outcome/feedback-disposition.js";
import { applyGoalCorrectionMutation } from "./goal-correction-mutation.js";

export type InboundTaskFeedbackResult = {
  disposition: InboundFeedbackDisposition;
  workspace: "updated" | "skipped";
  clarify: string | null;
};

export async function applyInboundTaskFeedback(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentId: string;
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  text: string;
  sourceMessageId: string;
}): Promise<InboundTaskFeedbackResult> {
  const disposition = planInboundFeedbackDisposition(params.text);
  if (disposition.kind !== "workspace_goal") {
    return {
      disposition,
      workspace: "skipped",
      clarify: disposition.kind === "clarify_unbound_task" ? UNBOUND_TASK_NEGATION_CLARIFY : null,
    };
  }
  const updated = await applyGoalCorrectionMutation({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    sessionEntry: params.sessionEntry,
    text: params.text,
    sourceMessageId: params.sourceMessageId,
  });
  return {
    disposition,
    workspace: updated === "updated" ? "updated" : "skipped",
    clarify: null,
  };
}

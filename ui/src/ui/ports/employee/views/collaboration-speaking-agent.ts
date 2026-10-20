import type { CollaborationRoundPlanPayload } from "../../../../../../src/gateway/collaboration-dispatch/types.js";
import { parseAgentSessionKey } from "../../../../../../src/sessions/session-key-utils.ts";
import { extractAgentIdFromChatRunId } from "../../../chat/space-stream-identity.ts";
import { isGroupScopedSessionKey } from "../../../collaboration/resolve-group-scope.ts";

function resolveLeadAgentIdFromRoundPlan(
  roundPlan: CollaborationRoundPlanPayload | null | undefined,
): string | null {
  if (!roundPlan) {
    return null;
  }
  const lead = roundPlan.participants.find(
    (participant) => participant.contributionRole === "lead",
  );
  if (lead?.agentId?.trim()) {
    return lead.agentId.trim();
  }
  const primary = roundPlan.participants.find((participant) => participant.tier !== "wrap");
  return primary?.agentId?.trim() || null;
}

export function resolveCollaborationSpeakingAgentId(params: {
  sessionKey: string;
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamSessionKey?: string | null;
  sending?: boolean;
  collaborationRoundPlan?: CollaborationRoundPlanPayload | null;
}): string | null {
  const sessionKey = params.sessionKey.trim();
  if (!isGroupScopedSessionKey(sessionKey)) {
    return null;
  }
  const streaming = Boolean(params.chatStream?.trim());
  const sending = Boolean(params.sending);
  if (!streaming && !sending) {
    return null;
  }

  const streamKey = params.chatStreamSessionKey?.trim();
  if (streamKey) {
    const parsed = parseAgentSessionKey(streamKey);
    if (parsed?.agentId?.trim()) {
      return parsed.agentId.trim();
    }
  }

  const fromRunId = extractAgentIdFromChatRunId(params.chatRunId);
  if (fromRunId) {
    return fromRunId;
  }

  if (sending || streaming) {
    return resolveLeadAgentIdFromRoundPlan(params.collaborationRoundPlan);
  }
  return null;
}

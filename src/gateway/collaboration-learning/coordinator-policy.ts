import type { CollaborationMember, GroupProfile } from "@openbot/collaboration-core";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";

function normalizeAgentId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isEligibleCoordinatorBot(
  members: CollaborationMember[],
  agentId: string | null | undefined,
): boolean {
  const normalizedAgentId = normalizeAgentId(agentId);
  if (!normalizedAgentId || isBuiltinStewardAgent(normalizedAgentId)) {
    return false;
  }
  return members.some(
    (member) =>
      member.memberKind === "bot" &&
      normalizeAgentId(member.agentId) === normalizedAgentId &&
      (member.status === "active" || member.status === "paused"),
  );
}

export function stripBuiltinStewardGroupMembers(
  members: CollaborationMember[],
): CollaborationMember[] {
  return members.filter((member) => {
    if (member.memberKind !== "bot") {
      return true;
    }
    const agentId = normalizeAgentId(member.agentId);
    return !agentId || !isBuiltinStewardAgent(agentId);
  });
}

/** Standing group identity only. Never invent a coordinator or fall back to 大白. */
export function resolveNextCoordinatorBotId(params: {
  profile?: GroupProfile | null;
  members: CollaborationMember[];
  requestedBotId?: string | null;
}): string | null {
  if (params.requestedBotId !== undefined && params.requestedBotId !== null) {
    const requestedBotId = normalizeAgentId(params.requestedBotId);
    return isEligibleCoordinatorBot(params.members, requestedBotId) ? requestedBotId : null;
  }
  const currentCoordinator = normalizeAgentId(params.profile?.coordinatorBotId);
  if (isEligibleCoordinatorBot(params.members, currentCoordinator)) {
    return currentCoordinator;
  }
  return null;
}

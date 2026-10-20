import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";

/**
 * Group discussion bot allowlist.
 *
 * Spaces profile `members.bots` is the membership SoT. An empty roster means
 * no bots — never "scan every historical `agent:*:space:` session".
 * The builtin steward only speaks when it is an active listed member.
 */
export function isRosterAllowedGroupDiscussionBot(params: {
  agentId: string;
  activeMemberBotIds: ReadonlySet<string>;
  hasManagedSpace: boolean;
}): boolean {
  const agentId = params.agentId.trim().toLowerCase();
  if (!agentId) {
    return false;
  }
  const listed = params.activeMemberBotIds.has(agentId);
  if (isBuiltinStewardAgent(agentId)) {
    return listed;
  }
  if (params.hasManagedSpace) {
    return listed;
  }
  return true;
}

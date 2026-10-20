import type { CollaborationMember } from "@openbot/collaboration-core";
import { loadConfig } from "../../../config/config.js";
import { listAgentsForGateway } from "../../session-utils.js";

export function looksLikeOpaqueDeliverableCreatorId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (/^(bot-|user-|agent-|skill:|del-|main$|agent$)/i.test(trimmed)) {
    return true;
  }
  if (/^[a-f0-9-]{8,}$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveConfiguredAgentDisplayName(agentId: string): string | undefined {
  const trimmed = agentId.trim();
  if (!trimmed) {
    return undefined;
  }
  const configured = listAgentsForGateway(loadConfig()).agents.find(
    (entry) => normalizeLookupKey(entry.id) === normalizeLookupKey(trimmed),
  );
  const display = configured?.identity?.name?.trim() || configured?.name?.trim();
  return display || undefined;
}

function findCollaborationMember(
  memberId: string,
  members: CollaborationMember[],
): CollaborationMember | undefined {
  const key = normalizeLookupKey(memberId);
  return members.find((entry) => {
    const candidates = [entry.memberId, entry.userId, entry.agentId]
      .filter((value): value is string => Boolean(value?.trim()))
      .map(normalizeLookupKey);
    return candidates.includes(key);
  });
}

export function resolveMemberDisplayLabel(
  memberId: string,
  members: CollaborationMember[],
): string {
  const trimmed = memberId.trim();
  if (!trimmed) {
    return "";
  }
  const member = findCollaborationMember(trimmed, members);
  if (member?.name?.trim()) {
    return member.name.trim();
  }
  const configured = resolveConfiguredAgentDisplayName(trimmed);
  if (configured) {
    return configured;
  }
  if (!looksLikeOpaqueDeliverableCreatorId(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

export function resolvePrimaryCreatorDisplayName(
  creatorIds: string[],
  members: CollaborationMember[],
  options?: { groupTitle?: string },
): string | undefined {
  const labels = creatorIds
    .map((id) => resolveMemberDisplayLabel(id, members))
    .filter((value) => Boolean(value.trim()));
  const named = labels.find((label) => !looksLikeOpaqueDeliverableCreatorId(label));
  if (named) {
    return named;
  }
  for (const id of creatorIds) {
    const configured = resolveConfiguredAgentDisplayName(id);
    if (configured) {
      return configured;
    }
  }
  const groupTitle = options?.groupTitle?.trim();
  if (groupTitle && !looksLikeOpaqueDeliverableCreatorId(groupTitle)) {
    return groupTitle;
  }
  return labels[0];
}

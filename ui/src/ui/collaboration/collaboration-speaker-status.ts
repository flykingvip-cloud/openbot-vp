import type { CollaborationRoundPlanPayload } from "../../../../src/gateway/collaboration-dispatch/types.js";

export type CollaborationSpeakerStatus =
  | { kind: "speaking"; name: string }
  | { kind: "all" }
  | { kind: "named"; names: string[] }
  | { kind: "primary"; name: string }
  | { kind: "idle" };

function resolveMemberName(
  agentId: string,
  members?: Array<{ id: string; label: string }>,
  participants?: CollaborationRoundPlanPayload["participants"],
): string | null {
  const needle = agentId.trim().toLowerCase();
  if (!needle) {
    return null;
  }
  const member = members?.find((entry) => entry.id.trim().toLowerCase() === needle);
  if (member?.label.trim()) {
    return member.label.trim();
  }
  const participant = participants?.find((entry) => entry.agentId.trim().toLowerCase() === needle);
  return participant?.displayName.trim() || null;
}

export function resolveCollaborationSpeakerStatus(params: {
  sessionKey?: string | null;
  speakingAgentId?: string | null;
  members?: Array<{ id: string; label: string }>;
  roundPlan?: CollaborationRoundPlanPayload | null;
}): CollaborationSpeakerStatus {
  const sessionKey = params.sessionKey?.trim() ?? "";
  const plan =
    params.roundPlan && (!sessionKey || params.roundPlan.sessionKey.trim() === sessionKey)
      ? params.roundPlan
      : null;
  const speakingId = params.speakingAgentId?.trim() ?? "";
  if (speakingId) {
    const name = resolveMemberName(speakingId, params.members, plan?.participants);
    if (name) {
      return { kind: "speaking", name };
    }
  }

  const named = (plan?.participants ?? [])
    .filter((entry) => entry.tier === "mention")
    .map((entry) => entry.displayName.trim())
    .filter(Boolean);
  if (
    named.length > 0 ||
    plan?.mentionMode === "single_primary" ||
    plan?.mentionMode === "explicit_multi"
  ) {
    if (named.length > 0) {
      return { kind: "named", names: [...new Set(named)] };
    }
  }

  const lead =
    plan?.participants.find((entry) => entry.contributionRole === "lead") ??
    plan?.participants.find((entry) => entry.tier !== "wrap");
  if (lead?.displayName.trim()) {
    return { kind: "primary", name: lead.displayName.trim() };
  }

  const mentionAll =
    plan?.mentionAll === true ||
    plan?.alerts?.some((alert) => alert.kind === "group_broadcast_expanded") === true;
  if (mentionAll) {
    return { kind: "all" };
  }
  return { kind: "idle" };
}

export function formatCollaborationSpeakerStatus(
  status: CollaborationSpeakerStatus,
  translate: (key: string, vars?: Record<string, string>) => string,
): string | null {
  switch (status.kind) {
    case "speaking":
      return translate("frontstage.workbench.memberGovernance.speakerSpeaking", {
        name: status.name,
      });
    case "all":
      return translate("frontstage.workbench.memberGovernance.speakerAll");
    case "named":
      return translate("frontstage.workbench.memberGovernance.speakerNamed", {
        names: status.names.join("、"),
      });
    case "primary":
      return translate("frontstage.workbench.memberGovernance.speakerPrimary", {
        name: status.name,
      });
    default:
      return null;
  }
}

export function shouldShowCollaborationMentionHint(status: CollaborationSpeakerStatus): boolean {
  return status.kind === "idle" || status.kind === "primary";
}

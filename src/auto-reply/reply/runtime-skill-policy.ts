import { composeSkillPolicy, type SkillPolicy } from "../../agents/skills/skill-policy.js";
import type { SessionEntry } from "../../config/sessions.js";
import { resolveCollaborationGroupProfileForRuntime } from "../../gateway/collaboration-learning/group-runtime-profile.js";
import { resolveSessionParticipationOverlay } from "../../gateway/collaboration-learning/session-participation-overlay.js";

/**
 * Disk group profile + participation overlay → skill allow/block for this turn.
 * Empty enabledSkills on disk are omitted by compose = no group-level skill
 * restriction. Tenant/system ACL and agent capability ACL still apply.
 *
 * This is the documented DefaultCapabilityComposer.final equivalent used on the
 * reply hot path. We do not call composer.final directly: empty enabledSkills
 * would become allow-none, and overlay enabledSkills would UNION instead of
 * INTERSECT. Token→tool mapping happens later in applyEmbeddedCustomToolPolicy.
 */
export async function resolveRuntimeSkillPolicy(params: {
  groupId?: string | null;
  sessionEntry?: SessionEntry;
  /** Current speaking bot — selects overlay from the shared-session per-bot bag. */
  botId?: string | null;
}): Promise<SkillPolicy> {
  const groupId =
    params.groupId?.trim() ||
    params.sessionEntry?.collaborationGroupProfile?.groupId?.trim() ||
    params.sessionEntry?.groupId?.trim();
  const groupProfile = groupId
    ? await resolveCollaborationGroupProfileForRuntime({
        groupId,
        sessionProfile: params.sessionEntry?.collaborationGroupProfile,
      })
    : params.sessionEntry?.collaborationGroupProfile;
  return composeSkillPolicy({
    groupProfile,
    overlay: resolveSessionParticipationOverlay({
      field: params.sessionEntry?.collaborationParticipationOverlay,
      botId: params.botId,
    }),
  });
}

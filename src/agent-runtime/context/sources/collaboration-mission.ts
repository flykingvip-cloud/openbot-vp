/** Resolved data only: no profile loading, authorization or lifecycle side effects. */
export type CollaborationMissionData = {
  displayName?: string;
  purpose?: string;
  currentMission?: string;
  collaborationMode?: string;
  successCriteria?: readonly string[];
  systemInstructions?: readonly string[];
};

export function renderCollaborationMission(profile?: CollaborationMissionData): string | undefined {
  if (!profile) {
    return undefined;
  }
  const lines = ["Collaboration group context:"];
  if (profile.displayName?.trim()) {
    lines.push(`- Group: ${profile.displayName.trim()}`);
  }
  if (profile.purpose?.trim()) {
    lines.push(`- Purpose: ${profile.purpose.trim()}`);
  }
  if (profile.currentMission?.trim()) {
    lines.push(`- Current mission: ${profile.currentMission.trim()}`);
  }
  if (profile.collaborationMode?.trim()) {
    lines.push(`- Collaboration mode: ${profile.collaborationMode.trim()}`);
  }
  const criteria = (profile.successCriteria ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (criteria.length > 0) {
    lines.push(`- Success criteria: ${criteria.join("; ")}`);
  }
  const instructions = (profile.systemInstructions ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (instructions.length > 0) {
    lines.push(`- Group instructions: ${instructions.join(" | ")}`);
  }
  return lines.length > 1 ? lines.join("\n") : undefined;
}

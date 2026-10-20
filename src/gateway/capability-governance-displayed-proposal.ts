// Pending cards in 能力中心 → 待审阅 are not always rows in proposals.json.
// The UI derives them from the skill report (normalizeSkillReport) and
// labels each one proposal:urn:openclaw:skill:<skillKey>@0.0.0. Approve
// and reject must be able to land that same id, while a made-up id stays
// a clear miss.

import {
  submitProposal,
  type GovernanceProposal,
  type GovernanceManifest,
} from "./capability-governance-store.js";

export type DisplayedSkillCard = {
  skillKey: string;
  name: string;
  description: string;
  source: string;
};

const SOURCE_KIND_TRUST: Record<string, string> = {
  "openclaw-bundled": "first-party",
  "openclaw-workspace": "workspace",
  "openclaw-managed": "user",
  "openclaw-extra": "user",
  "agents-skills-personal": "user",
  "agents-skills-project": "user",
};

const DISPLAYED_SKILL_VERSION = "0.0.0";
const SYNTHETIC_SKILL_PROPOSAL_ID = /^proposal:urn:openclaw:skill:(.+)@([^@]+)$/;

export function displayedSkillProposalId(skillKey: string): string {
  return `proposal:urn:openclaw:skill:${skillKey}@${DISPLAYED_SKILL_VERSION}`;
}

/** Same rule as the platform UI: first-party and workspace skills are not pending cards. */
export function isDisplayedPendingSkillSource(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.startsWith("plugin:") || trimmed.startsWith("extension:")) {
    return false;
  }
  const trust = SOURCE_KIND_TRUST[trimmed];
  if (trust === "first-party" || trust === "workspace") {
    return false;
  }
  return true;
}

export function manifestForDisplayedSkill(skill: DisplayedSkillCard): GovernanceManifest {
  const skillKey = skill.skillKey.trim();
  const trust = SOURCE_KIND_TRUST[skill.source.trim()] ?? "third-party";
  const kind = skill.source.trim().startsWith("openclaw-")
    ? skill.source.trim().slice("openclaw-".length)
    : "upload";
  return {
    id: `urn:openclaw:skill:${skillKey}@${DISPLAYED_SKILL_VERSION}`,
    kind: "skill",
    version: DISPLAYED_SKILL_VERSION,
    skillKey,
    name: skill.name.trim() || skillKey,
    description: skill.description ?? "",
    source: {
      kind,
      origin: skill.source,
      trustTier: trust,
    },
    risk: {
      level: trust === "third-party" || trust === "external" ? "medium" : "low",
      network: false,
      filesystem: false,
      subprocess: false,
      secrets: false,
    },
  };
}

/**
 * Persist the proposal the 待审阅 card already shows, if this id is that card.
 * Returns null when the id is not a displayed pending skill (caller should
 * report a missing proposal).
 */
export function ensureDisplayedSkillProposal(
  proposalId: string,
  skills: readonly DisplayedSkillCard[],
): GovernanceProposal | null {
  const match = SYNTHETIC_SKILL_PROPOSAL_ID.exec(proposalId);
  if (!match) {
    return null;
  }
  const skillKey = match[1]?.trim() ?? "";
  const version = match[2]?.trim() ?? "";
  if (!skillKey || version !== DISPLAYED_SKILL_VERSION) {
    return null;
  }
  const skill = skills.find((entry) => entry.skillKey.trim() === skillKey);
  if (!skill || !isDisplayedPendingSkillSource(skill.source)) {
    return null;
  }
  const proposal: GovernanceProposal = {
    proposalId,
    submittedAt: new Date().toISOString(),
    submittedBy: skill.source.trim() || "skill-catalog",
    status: "proposed",
    manifest: manifestForDisplayedSkill(skill),
    findings: [],
  };
  return submitProposal(proposal);
}

export function missingGovernanceProposalMessage(proposalId: string): string {
  return `proposal ${proposalId} not found in the governance store, and it does not match a pending skill in 能力中心`;
}

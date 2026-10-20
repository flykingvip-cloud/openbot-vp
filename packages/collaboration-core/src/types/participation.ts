import type {
  CollaborationGovernanceRole,
  CollaborationMemberVisibility,
  CollaborationRole,
} from "./member.js";

type FutureParticipationMetadata = Record<string, unknown>;

export type ParticipationStatus = "active" | "paused" | "removed";
export type ParticipationTrustLevel = "baseline" | "trusted" | "elevated";
export type ParticipationConfidentialityTier = "public" | "internal" | "restricted" | "secret";
export type ParticipationOverlayStatus = "active" | "paused" | "expired";

export type CreateBotParticipationProfileInput = {
  groupId: string;
  botId: string;
  memberId?: string;
  governanceRole?: CollaborationGovernanceRole;
  collaborationRole?: CollaborationRole;
  status?: ParticipationStatus;
  visibility?: CollaborationMemberVisibility;
  trustLevel?: ParticipationTrustLevel;
  confidentialityTier?: ParticipationConfidentialityTier;
  joinedAtMs?: number;
  lastActiveAtMs?: number;
  updatedAtMs?: number;
  metadata?: FutureParticipationMetadata;
};

export function buildParticipationId(groupId: string, botId: string): string {
  return `${groupId.trim()}::${botId.trim()}`;
}

export function createBotParticipationProfile(
  input: CreateBotParticipationProfileInput,
): BotParticipationProfile {
  const joinedAtMs = input.joinedAtMs ?? input.updatedAtMs ?? Date.now();
  const updatedAtMs = input.updatedAtMs ?? joinedAtMs;

  return {
    participationId: buildParticipationId(input.groupId, input.botId),
    groupId: input.groupId,
    botId: input.botId,
    ...(input.memberId ? { memberId: input.memberId } : {}),
    governanceRole: input.governanceRole ?? "member",
    ...(input.collaborationRole ? { collaborationRole: input.collaborationRole } : {}),
    status: input.status ?? "active",
    visibility: input.visibility ?? "visible",
    trustLevel: input.trustLevel ?? "baseline",
    confidentialityTier: input.confidentialityTier ?? "internal",
    joinedAtMs,
    ...(input.lastActiveAtMs ? { lastActiveAtMs: input.lastActiveAtMs } : {}),
    updatedAtMs,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function isParticipationActive(profile: BotParticipationProfile): boolean {
  return profile.status === "active";
}

/**
 * Stable participation identity anchor.
 *
 * This is NOT a session object and NOT a CollaborationMember alias.
 */
export interface BotParticipationProfile {
  participationId: string;
  groupId: string;
  botId: string;
  memberId?: string;
  governanceRole: CollaborationGovernanceRole;
  collaborationRole?: CollaborationRole;
  status: ParticipationStatus;
  visibility?: CollaborationMemberVisibility;
  trustLevel?: ParticipationTrustLevel;
  confidentialityTier?: ParticipationConfidentialityTier;
  joinedAtMs: number;
  lastActiveAtMs?: number;
  updatedAtMs: number;
  metadata?: FutureParticipationMetadata;
}

/**
 * Runtime-only capability overlay hook reserved for the runtime package.
 */
export interface ParticipationCapabilityOverlay {
  participationId: string;
  botId: string;
  groupId: string;
  status?: ParticipationOverlayStatus;
  enabledSkills?: string[];
  blockedSkills?: string[];
  systemInstructions?: string[];
  confidentialityTier?: ParticipationConfidentialityTier;
  expiresAtMs?: number;
  updatedAtMs: number;
  metadata?: FutureParticipationMetadata;
}

/**
 * Group-level capability contract anchor.
 */
export interface GroupCapabilityProfile {
  groupId: string;
  groupCode?: string;
  displayName?: string;
  avatar?: string;
  visibilityScope?: "group_only" | "tenant" | "organization" | string;
  groupType?: string;
  lifecycleStatus?: string;
  ownerUserId?: string;
  coordinatorBotId?: string;
  purpose?: string;
  currentMission?: string;
  successCriteria?: string[];
  exitCriteria?: string[];
  collaborationMode?: string;
  finalDecisionPolicy?: import("./profile.js").FinalDecisionPolicy;
  directoryBindingId?: string;
  createdAtMs?: number;
  enabledSkills?: string[];
  requiredSkillSets?: string[][];
  blockedSkills?: string[];
  systemInstructions?: string[];
  confidentialityTier?: ParticipationConfidentialityTier;
  updatedAtMs: number;
  metadata?: FutureParticipationMetadata;
}

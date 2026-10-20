import { isParticipationActive } from "@openbot/collaboration-core";
import type {
  AgentLearningAsset,
  BotParticipationProfile,
  ParticipationCapabilityOverlay,
} from "@openbot/collaboration-core";

/**
 * Participation overlay contracts for collaboration learning-governance.
 */
export interface ParticipationOverlay {
  participationId?: string;
  botId: string;
  groupId: string;
  overlayCapabilities?: string[];
  policyFilters?: string[];
  systemInstructions?: string[];
  confidentialityTier?: string;
  expiresAt?: number;
  updatedAt?: number;
}

export interface ParticipationOverlayResolver {
  resolveOverlay(botId: string, groupId: string): Promise<ParticipationOverlay | null>;
  isOverlayActive(overlay: ParticipationOverlay): boolean;
}

export type ParticipationOverlayDependencies = {
  resolveParticipation: (botId: string, groupId: string) => Promise<BotParticipationProfile | null>;
  listLearningAssets: (botId: string, groupId: string) => Promise<AgentLearningAsset[]>;
  loadOverlayProfile?: (participationId: string) => Promise<ParticipationCapabilityOverlay | null>;
};

function toUniqueCapabilities(capabilities: string[]): string[] {
  return [...new Set(capabilities.map((entry) => entry.trim()).filter(Boolean))];
}

function readSkills(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function deriveAssetCapabilities(asset: AgentLearningAsset): string[] {
  const fromAbstractedContent = readSkills(asset.abstractedContent?.capabilities);
  const fromMetadata = readSkills(asset.metadata?.skills);
  return [...fromAbstractedContent, ...fromMetadata];
}

export class DefaultParticipationOverlayResolver implements ParticipationOverlayResolver {
  constructor(private readonly deps: ParticipationOverlayDependencies) {}

  async resolveOverlay(botId: string, groupId: string): Promise<ParticipationOverlay | null> {
    const participation = await this.deps.resolveParticipation(botId, groupId);
    if (!participation || !isParticipationActive(participation)) {
      return null;
    }

    const profile = this.deps.loadOverlayProfile
      ? await this.deps.loadOverlayProfile(participation.participationId)
      : null;
    const assets = await this.deps.listLearningAssets(botId, groupId);
    const activeAssets = assets.filter(
      (asset) => asset.status === undefined || asset.status === "active",
    );
    const overlayCapabilities = toUniqueCapabilities([
      ...(profile?.enabledSkills ?? []),
      ...activeAssets.flatMap(deriveAssetCapabilities),
    ]);
    const policyFilters = [...(profile?.blockedSkills ?? []).map((skill) => `!${skill}`)];

    return {
      participationId: participation.participationId,
      botId,
      groupId,
      overlayCapabilities,
      ...(policyFilters.length > 0 ? { policyFilters } : {}),
      ...(profile?.systemInstructions?.length
        ? { systemInstructions: profile.systemInstructions }
        : {}),
      ...(profile?.confidentialityTier ? { confidentialityTier: profile.confidentialityTier } : {}),
      ...(profile?.expiresAtMs ? { expiresAt: profile.expiresAtMs } : {}),
    };
  }

  isOverlayActive(overlay: ParticipationOverlay): boolean {
    return overlay.expiresAt === undefined || overlay.expiresAt > Date.now();
  }
}

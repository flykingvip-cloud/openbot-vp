import {
  buildParticipationId,
  createBotParticipationProfile,
  isParticipationActive,
  type BotParticipationProfile,
  type CollaborationMember,
  type GroupCapabilityProfile,
  type ParticipationCapabilityOverlay,
  type ParticipationStatus,
} from "@openbot/collaboration-core";
import type {
  OpenBotGroupStorage,
  OpenBotMetadataStorage,
} from "@openbot/collaboration-openbot-adapter";
import type { ParticipationOverlay } from "@openbot/collaboration-runtime";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import {
  mergeSessionEntryPreserveActivity,
  resolveStorePath,
  updateSessionStore,
} from "../../config/sessions.js";
import { toCollaborationSpaceSessionKey } from "../../sessions/session-key-utils.js";
import { loadCollaborationGroupProfileForRuntime } from "./group-runtime-profile.js";
import { resolveCollaborationSpaceSessionId } from "./session-id.js";
import { upsertSessionParticipationOverlay } from "./session-participation-overlay.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}

function mapMemberStatus(status: CollaborationMember["status"]): ParticipationStatus {
  if (status === "active") {
    return "active";
  }
  if (status === "paused" || status === "invited") {
    return "paused";
  }
  return "removed";
}

export function mapMemberToParticipationProfile(
  member: CollaborationMember,
  groupId: string,
  existing?: BotParticipationProfile | null,
): BotParticipationProfile | null {
  if (member.memberKind !== "bot") {
    return null;
  }
  const botId = member.agentId?.trim();
  if (!botId) {
    return null;
  }
  const next = createBotParticipationProfile({
    groupId,
    botId,
    memberId: member.memberId,
    governanceRole: member.governanceRole,
    collaborationRole: member.collaborationRole,
    status: mapMemberStatus(member.status),
    visibility: member.visibility,
    joinedAtMs: existing?.joinedAtMs ?? member.joinedAtMs ?? member.updatedAtMs,
    lastActiveAtMs: member.updatedAtMs,
    updatedAtMs: member.updatedAtMs,
    ...(existing?.metadata ? { metadata: existing.metadata } : {}),
  });
  return next;
}

export function mergeParticipationsFromMembers(params: {
  groupId: string;
  members: CollaborationMember[];
  existing: BotParticipationProfile[];
}): BotParticipationProfile[] {
  const existingByBotId = new Map(params.existing.map((entry) => [entry.botId, entry]));
  const nextBotIds = new Set<string>();
  const merged: BotParticipationProfile[] = [];

  for (const member of params.members) {
    const profile = mapMemberToParticipationProfile(
      member,
      params.groupId,
      member.agentId ? existingByBotId.get(member.agentId.trim()) : null,
    );
    if (!profile) {
      continue;
    }
    nextBotIds.add(profile.botId);
    merged.push(profile);
  }

  for (const existing of params.existing) {
    if (nextBotIds.has(existing.botId)) {
      continue;
    }
    merged.push({
      ...existing,
      status: "removed",
      updatedAtMs: Date.now(),
    });
  }

  return merged.toSorted((left, right) => left.botId.localeCompare(right.botId));
}

export async function syncGroupParticipationsFromMembers(params: {
  groupId: string;
  members: CollaborationMember[];
  groupStorage: OpenBotGroupStorage;
}): Promise<BotParticipationProfile[]> {
  const existing = await params.groupStorage.readParticipations(params.groupId);
  const merged = mergeParticipationsFromMembers({
    groupId: params.groupId,
    members: params.members,
    existing,
  });
  await params.groupStorage.writeParticipations(params.groupId, merged);
  return merged;
}

export async function resolveMembersForParticipationSync(params: {
  groupId: string;
  groupStorage: OpenBotGroupStorage;
  activeBotIds?: string[];
}): Promise<CollaborationMember[]> {
  const members = await params.groupStorage.readMembers(params.groupId);
  if (members.length > 0) {
    return members;
  }
  const now = Date.now();
  return (params.activeBotIds ?? [])
    .map((botId) => botId.trim())
    .filter(Boolean)
    .map(
      (botId) =>
        ({
          memberId: botId,
          memberKind: "bot",
          agentId: botId,
          governanceRole: "member",
          collaborationRole: "contributor",
          status: "active",
          visibility: "visible",
          updatedAtMs: now,
        }) satisfies CollaborationMember,
    );
}

export function buildSessionParticipationOverlay(params: {
  profile: BotParticipationProfile;
  capabilityOverlay?: ParticipationCapabilityOverlay | null;
}): ParticipationOverlay {
  const { profile, capabilityOverlay } = params;
  const overlayCapabilities = uniqueStrings([...(capabilityOverlay?.enabledSkills ?? [])]);
  const policyFilters = (capabilityOverlay?.blockedSkills ?? []).map((skill) => `!${skill}`);
  const now = Date.now();

  return {
    participationId: profile.participationId,
    botId: profile.botId,
    groupId: profile.groupId,
    ...(overlayCapabilities.length > 0 ? { overlayCapabilities } : {}),
    ...(policyFilters.length > 0 ? { policyFilters } : {}),
    ...(capabilityOverlay?.systemInstructions?.length
      ? { systemInstructions: capabilityOverlay.systemInstructions }
      : {}),
    confidentialityTier:
      capabilityOverlay?.confidentialityTier ?? profile.confidentialityTier ?? "internal",
    ...(capabilityOverlay?.expiresAtMs ? { expiresAt: capabilityOverlay.expiresAtMs } : {}),
    updatedAt: now,
  };
}

export async function resolveBotSessionParticipationOverlay(params: {
  groupId: string;
  botId: string;
  groupStorage: OpenBotGroupStorage;
  metadataStorage: OpenBotMetadataStorage;
}): Promise<ParticipationOverlay | null> {
  const participations = await params.groupStorage.readParticipations(params.groupId);
  const profile = participations.find((entry) => entry.botId === params.botId);
  if (!profile || !isParticipationActive(profile)) {
    return null;
  }
  const overlays = await params.metadataStorage.readParticipationOverlays(params.groupId);
  const capabilityOverlay =
    overlays.find((entry) => entry.botId === params.botId) ??
    overlays.find((entry) => entry.participationId === profile.participationId) ??
    null;
  return buildSessionParticipationOverlay({ profile, capabilityOverlay });
}

export async function refreshBotGroupSessionParticipationOverlay(params: {
  groupId: string;
  botId: string;
  title?: string;
  overlay: ParticipationOverlay;
  groupProfile?: GroupCapabilityProfile;
  resolveAgentStorePath?: (agentId: string) => string;
}): Promise<void> {
  const cfg = loadConfig();
  const sessionKey = toCollaborationSpaceSessionKey(params.groupId).toLowerCase();
  if (!sessionKey) {
    return;
  }
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const storePath = params.resolveAgentStorePath
    ? params.resolveAgentStorePath(defaultAgentId)
    : resolveStorePath(cfg.session?.store, { agentId: defaultAgentId });
  const now = Date.now();
  const groupProfile =
    params.groupProfile ?? (await loadCollaborationGroupProfileForRuntime(params.groupId));

  await updateSessionStore(
    storePath,
    (store) => {
      const existing = store[sessionKey];
      // Per-bot dictionary on the shared space:<groupId> session — never overwrite peers.
      const overlayBag = upsertSessionParticipationOverlay({
        existing: existing?.collaborationParticipationOverlay,
        overlay: params.overlay,
      });
      store[sessionKey] = mergeSessionEntryPreserveActivity(existing, {
        sessionId: resolveCollaborationSpaceSessionId({
          groupId: params.groupId,
          existingSessionId: existing?.sessionId,
        }),
        displayName: params.title ?? existing?.displayName ?? params.groupId,
        groupId: params.groupId,
        space: params.groupId,
        chatType: "group",
        collaborationParticipationOverlay: overlayBag,
        ...(groupProfile ? { collaborationGroupProfile: groupProfile } : {}),
        updatedAt: now,
      });
      return store[sessionKey];
    },
    { activeSessionKey: sessionKey },
  );
}

export async function applySharedSkillToGroupParticipation(params: {
  groupId: string;
  skillId: string;
  skillLabel: string;
  botId?: string | null;
}): Promise<void> {
  const groupId = params.groupId.trim();
  const skillKey = params.skillLabel.trim() || params.skillId.trim();
  const botId = params.botId?.trim() || null;
  if (!groupId || !skillKey) {
    return;
  }

  const { groupStorage, metadataStorage } = createWorkspaceCollaborationStores();
  const now = Date.now();
  const existingCapabilities =
    (await metadataStorage.readGroupCapabilities(groupId)) ??
    ({
      groupId,
      updatedAtMs: now,
    } satisfies GroupCapabilityProfile);

  await metadataStorage.writeGroupCapabilities(groupId, {
    ...existingCapabilities,
    groupId,
    enabledSkills: uniqueStrings([...(existingCapabilities.enabledSkills ?? []), skillKey]),
    updatedAtMs: now,
  });

  if (!botId) {
    return;
  }

  const members = await resolveMembersForParticipationSync({ groupId, groupStorage });
  await syncGroupParticipationsFromMembers({ groupId, members, groupStorage });

  const overlays = await metadataStorage.readParticipationOverlays(groupId);
  const participationId = buildParticipationId(groupId, botId);
  const existingOverlay =
    overlays.find((entry) => entry.botId === botId) ??
    overlays.find((entry) => entry.participationId === participationId) ??
    null;
  const nextOverlay: ParticipationCapabilityOverlay = {
    participationId,
    botId,
    groupId,
    status: "active",
    enabledSkills: uniqueStrings([...(existingOverlay?.enabledSkills ?? []), skillKey]),
    ...(existingOverlay?.blockedSkills ? { blockedSkills: existingOverlay.blockedSkills } : {}),
    ...(existingOverlay?.systemInstructions
      ? { systemInstructions: existingOverlay.systemInstructions }
      : {}),
    ...(existingOverlay?.confidentialityTier
      ? { confidentialityTier: existingOverlay.confidentialityTier }
      : {}),
    ...(existingOverlay?.expiresAtMs ? { expiresAtMs: existingOverlay.expiresAtMs } : {}),
    updatedAtMs: now,
  };
  const nextOverlays = overlays.filter(
    (entry) => entry.botId !== botId && entry.participationId !== participationId,
  );
  nextOverlays.push(nextOverlay);
  await metadataStorage.writeParticipationOverlays(groupId, nextOverlays);

  const sessionOverlay = await resolveBotSessionParticipationOverlay({
    groupId,
    botId,
    groupStorage,
    metadataStorage,
  });
  if (sessionOverlay) {
    await refreshBotGroupSessionParticipationOverlay({
      groupId,
      botId,
      overlay: sessionOverlay,
    });
  }
}

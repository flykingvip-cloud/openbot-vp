import fs from "node:fs/promises";
import path from "node:path";
import type { CollaborationMember, GroupCapabilityProfile } from "@openbot/collaboration-core";
import { resolveAgentConfig } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { resolveLiveCollaborationWorkspaceRoot } from "../gateway/workspace/group-locator.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { readOrganizationPresence } from "./presence.js";
import { readOrganizationTaskAssignments } from "./task-assignment.js";

export type RuntimeIdentitySource =
  | "organization_registry"
  | "collaboration_member"
  | "agent_config"
  | "fallback";

export type RuntimeAgentRef = {
  agentId: string;
  displayName: string;
  roleName?: string;
  online?: boolean;
  lastActiveAt?: string;
  currentTask?: string;
};

export type RuntimeHumanRef = {
  userId: string;
  displayName: string;
  roleName?: string;
  /** Roster status from collaboration members.json */
  status: string;
  online?: boolean;
};

export type RuntimeIdentity = RuntimeAgentRef & {
  organizationId?: string;
  organizationName?: string;
  coordinatorAgentId?: string;
  permissions: string[];
  reachableAgents: RuntimeAgentRef[];
  identitySource: RuntimeIdentitySource;
  capabilities: string[];
};

export type RuntimeOrganizationContext = {
  organization?: {
    id: string;
    name: string;
  };
  self: RuntimeIdentity;
  coordinator?: RuntimeAgentRef;
  members: RuntimeAgentRef[];
  /** Human roster for the collaboration group (all statuses retained for validation). */
  humans?: RuntimeHumanRef[];
  activeProject?: {
    id?: string;
    name: string;
  };
  activeTasks?: Array<{
    id?: string;
    title: string;
    ownerAgentId?: string;
    status?: string;
  }>;
};

type StoredProfileWrapper = {
  profile?: GroupCapabilityProfile | null;
};

type StoredMembersWrapper = {
  members?: CollaborationMember[] | null;
};

function normalizeValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function resolveGroupId(params: {
  sessionEntry?: SessionEntry;
  sessionKey?: string;
}): string | undefined {
  const direct =
    normalizeValue(params.sessionEntry?.groupId) ?? normalizeValue(params.sessionEntry?.space);
  if (direct) {
    return direct;
  }
  const sessionKey = params.sessionKey ?? "";
  const orgMatch = sessionKey.match(/(?:^|:)org:([^:]+)$/i);
  if (orgMatch?.[1]) {
    return decodeURIComponent(orgMatch[1]);
  }
  const spaceMatch = sessionKey.match(/(?:^|:)space:([^:]+)$/i);
  return spaceMatch?.[1] ? decodeURIComponent(spaceMatch[1]) : undefined;
}

function resolveConfigDisplayName(cfg: OpenBotConfig, agentId: string): string | undefined {
  const agentConfig = resolveAgentConfig(cfg, agentId);
  return normalizeValue(agentConfig?.identity?.name) ?? normalizeValue(agentConfig?.name);
}

function resolveConfigCapabilities(cfg: OpenBotConfig, agentId: string): string[] {
  const agentConfig = resolveAgentConfig(cfg, agentId);
  return Array.isArray(agentConfig?.skills) ? agentConfig.skills.filter(Boolean) : [];
}

function toRoleName(member?: CollaborationMember): string | undefined {
  return normalizeValue(member?.collaborationRole) ?? normalizeValue(member?.governanceRole);
}

function toAgentRef(
  cfg: OpenBotConfig,
  memberOrAgentId: CollaborationMember | string,
): RuntimeAgentRef | undefined {
  const agentId =
    typeof memberOrAgentId === "string"
      ? normalizeAgentId(memberOrAgentId)
      : normalizeValue(memberOrAgentId.agentId)
        ? normalizeAgentId(memberOrAgentId.agentId)
        : undefined;
  if (!agentId) {
    return undefined;
  }
  const member = typeof memberOrAgentId === "string" ? undefined : memberOrAgentId;
  return {
    agentId,
    displayName: normalizeValue(member?.name) ?? resolveConfigDisplayName(cfg, agentId) ?? agentId,
    ...(toRoleName(member) ? { roleName: toRoleName(member) } : {}),
    ...(member?.status === "active" ? { online: true } : {}),
  };
}

function toHumanRef(member: CollaborationMember): RuntimeHumanRef | undefined {
  if (member.memberKind !== "human") {
    return undefined;
  }
  const userId = normalizeValue(member.userId);
  if (!userId) {
    return undefined;
  }
  return {
    userId,
    displayName: normalizeValue(member.name) ?? userId,
    ...(toRoleName(member) ? { roleName: toRoleName(member) } : {}),
    status: member.status,
    ...(member.status === "active" ? { online: true } : {}),
  };
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readFirstJson<T>(paths: string[]): Promise<T | null> {
  for (const filePath of paths) {
    const value = await readJson<T>(filePath);
    if (value != null) {
      return value;
    }
  }
  return null;
}

function resolveWorkspaceGroupDirs(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  groupId: string;
}): string[] {
  void params.workspaceDir;
  const groupsRoot = path.join(resolveLiveCollaborationWorkspaceRoot(params.cfg), "groups");
  return [path.join(groupsRoot, encodePathSegment(params.groupId))];
}

function unwrapProfile(
  value: GroupCapabilityProfile | StoredProfileWrapper | null,
): GroupCapabilityProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  if ("profile" in value) {
    return value.profile ?? null;
  }
  return value as GroupCapabilityProfile;
}

function unwrapMembers(
  value: CollaborationMember[] | StoredMembersWrapper | null,
): CollaborationMember[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && Array.isArray(value.members)) {
    return value.members;
  }
  return [];
}

async function readOrganizationRegistry(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  groupId: string;
}): Promise<{ profile: GroupCapabilityProfile | null; members: CollaborationMember[] }> {
  // Runtime workspace groups are SoT.
  const dirs = [...resolveWorkspaceGroupDirs(params)];
  const profile = unwrapProfile(
    await readFirstJson<GroupCapabilityProfile | StoredProfileWrapper>(
      dirs.map((dir) => path.join(dir, "profile.json")),
    ),
  );
  const members = unwrapMembers(
    await readFirstJson<CollaborationMember[] | StoredMembersWrapper>(
      dirs.map((dir) => path.join(dir, "members.json")),
    ),
  );
  return { profile, members };
}

export function resolveRuntimeIdentityFromConfig(params: {
  cfg: OpenBotConfig;
  agentId: string;
}): RuntimeIdentity {
  const agentId = normalizeAgentId(params.agentId);
  return {
    agentId,
    displayName: resolveConfigDisplayName(params.cfg, agentId) ?? agentId,
    permissions: ["receive_tasks", "report_status"],
    reachableAgents: [],
    identitySource: resolveConfigDisplayName(params.cfg, agentId) ? "agent_config" : "fallback",
    capabilities: resolveConfigCapabilities(params.cfg, agentId),
  };
}

/**
 * Registry status of the agent's own bot membership in the organization the
 * session resolves to (`members.json`), or undefined when the agent is not
 * listed / no organization resolves. Used by fail-closed organization tool
 * authorization; does not change {@link resolveRuntimeOrganizationContext}.
 */
export async function readRuntimeSelfMemberStatus(params: {
  cfg: OpenBotConfig;
  agentId: string;
  workspaceDir: string;
  sessionEntry?: SessionEntry;
  sessionKey?: string;
}): Promise<CollaborationMember["status"] | undefined> {
  const groupId = resolveGroupId(params);
  if (!groupId) {
    return undefined;
  }
  const agentId = normalizeAgentId(params.agentId);
  const { members } = await readOrganizationRegistry({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    groupId,
  });
  const selfMember = members.find(
    (member) => member.memberKind === "bot" && normalizeValue(member.agentId) === agentId,
  );
  return selfMember?.status;
}

export async function resolveRuntimeOrganizationContext(params: {
  cfg: OpenBotConfig;
  agentId: string;
  workspaceDir: string;
  sessionEntry?: SessionEntry;
  sessionKey?: string;
}): Promise<RuntimeOrganizationContext> {
  const agentId = normalizeAgentId(params.agentId);
  const groupId = resolveGroupId(params);
  const sessionProfile = params.sessionEntry?.collaborationGroupProfile ?? null;
  const registry = groupId
    ? await readOrganizationRegistry({
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
        groupId,
      })
    : { profile: null, members: [] };
  const profile = registry.profile ?? sessionProfile;
  const members = registry.members;
  const organizationId = normalizeValue(profile?.groupId) ?? groupId;
  const organizationPresence = organizationId
    ? await readOrganizationPresence({
        cfg: params.cfg,
        workspaceDir: params.workspaceDir,
        organizationId,
      })
    : [];
  const presenceByAgentId = new Map(
    organizationPresence.map((presence) => [normalizeAgentId(presence.agentId), presence]),
  );
  const selfMember = members.find(
    (member) => member.memberKind === "bot" && normalizeValue(member.agentId) === agentId,
  );
  const memberRefs = members
    .filter((member) => member.memberKind === "bot" && member.status !== "removed")
    .map((member) => toAgentRef(params.cfg, member))
    .filter((entry): entry is RuntimeAgentRef => Boolean(entry))
    .map((entry) => {
      const presence = presenceByAgentId.get(entry.agentId);
      return presence
        ? {
            ...entry,
            online: presence.online,
            lastActiveAt: presence.lastActiveAt,
            ...(presence.currentTask ? { currentTask: presence.currentTask } : {}),
          }
        : entry;
    });
  const humanRefs = members
    .map((member) => toHumanRef(member))
    .filter((entry): entry is RuntimeHumanRef => Boolean(entry));
  const coordinatorAgentId = normalizeValue(profile?.coordinatorBotId);
  const coordinator = coordinatorAgentId
    ? (memberRefs.find((member) => member.agentId === normalizeAgentId(coordinatorAgentId)) ??
      toAgentRef(params.cfg, coordinatorAgentId))
    : undefined;
  const reachableAgents = memberRefs.filter((member) => member.agentId !== agentId);
  const organizationName =
    normalizeValue(profile?.displayName) ?? normalizeValue(profile?.groupCode) ?? organizationId;
  const activeAssignments = organizationId
    ? (
        await readOrganizationTaskAssignments({
          cfg: params.cfg,
          workspaceDir: params.workspaceDir,
          organizationId,
        })
      ).filter(
        (assignment) => assignment.status !== "completed" && assignment.status !== "rejected",
      )
    : [];
  const configIdentity = resolveRuntimeIdentityFromConfig({ cfg: params.cfg, agentId });
  const isCoordinator =
    coordinatorAgentId !== undefined && normalizeAgentId(coordinatorAgentId) === agentId;
  const selfPresence = presenceByAgentId.get(agentId);
  const self: RuntimeIdentity = {
    agentId,
    displayName: normalizeValue(selfMember?.name) ?? configIdentity.displayName,
    ...(toRoleName(selfMember) ? { roleName: toRoleName(selfMember) } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(organizationName ? { organizationName } : {}),
    ...(coordinatorAgentId ? { coordinatorAgentId: normalizeAgentId(coordinatorAgentId) } : {}),
    permissions: isCoordinator
      ? ["coordinate", "assign_tasks", "message_agents", "report_status"]
      : ["receive_tasks", "report_status"],
    reachableAgents,
    identitySource: selfMember ? "organization_registry" : configIdentity.identitySource,
    capabilities: [
      ...new Set([
        ...configIdentity.capabilities,
        ...(params.sessionEntry?.collaborationPersonalCapabilities ?? []),
        ...(profile?.enabledSkills ?? []),
      ]),
    ],
    ...(selfPresence
      ? {
          online: selfPresence.online,
          lastActiveAt: selfPresence.lastActiveAt,
          ...(selfPresence.currentTask ? { currentTask: selfPresence.currentTask } : {}),
        }
      : selfMember?.status === "active"
        ? { online: true }
        : {}),
  };

  return {
    ...(organizationId && organizationName
      ? { organization: { id: organizationId, name: organizationName } }
      : {}),
    self,
    ...(coordinator ? { coordinator } : {}),
    members: memberRefs,
    humans: humanRefs,
    ...(normalizeValue(profile?.currentMission)
      ? { activeProject: { name: normalizeValue(profile?.currentMission) as string } }
      : {}),
    ...(activeAssignments.length > 0
      ? {
          activeTasks: activeAssignments.map((assignment) => ({
            id: assignment.id,
            title: assignment.title,
            ownerAgentId: assignment.ownerAgentId,
            status: assignment.status,
          })),
        }
      : {}),
  };
}

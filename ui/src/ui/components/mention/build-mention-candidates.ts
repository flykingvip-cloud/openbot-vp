import { isBuiltinStewardAgent } from "../../../../../src/agents/builtin-steward/identity.js";
import type { MentionCandidate } from "../../../../../src/organization/mention-types.js";
import {
  normalizeCollaborationSpaceIdentity,
  parseAgentSessionKey,
} from "../../../../../src/sessions/session-key-utils.js";
import type { CollaborationSpaceMemberRosterTransport } from "../../types.ts";

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Build @-mention popup candidates for a collaboration space roster.
 * Includes active humans + active bots; excludes self / invited / removed / inactive.
 */
export function buildMentionCandidatesFromRoster(params: {
  members: CollaborationSpaceMemberRosterTransport | null | undefined;
  selfUserId?: string | null;
  coordinatorBotId?: string | null;
}): MentionCandidate[] {
  const roster = params.members;
  if (!roster) {
    return [];
  }
  const selfUserId = stringField(params.selfUserId).toLowerCase();
  const coordinatorBotId = stringField(params.coordinatorBotId);

  const humans = (roster.humans ?? [])
    .filter((human) => {
      const userId = stringField(human.userId);
      if (!userId) {
        return false;
      }
      if (human.status && human.status !== "active") {
        return false;
      }
      if (selfUserId && userId.toLowerCase() === selfUserId) {
        return false;
      }
      return true;
    })
    .map((human) => {
      const userId = stringField(human.userId);
      return {
        kind: "human" as const,
        agentId: "",
        userId,
        displayName: stringField(human.name) || userId,
        roleName: "成员",
        online: human.status === "active",
        isCoordinator: false,
        isBot: false,
      };
    });

  const bots = (roster.bots ?? [])
    .filter(
      (bot) => stringField(bot.agentId) && bot.status !== "removed" && bot.status !== "invited",
    )
    .filter((bot) => !bot.status || bot.status === "active")
    .map((bot) => {
      const agentId = stringField(bot.agentId);
      const runtimeStatus = stringField(bot.runtimeStatus);
      const isCoordinator = Boolean(coordinatorBotId && agentId === coordinatorBotId);
      const online = runtimeStatus
        ? runtimeStatus === "online" || runtimeStatus === "busy"
        : bot.status === "active";
      return {
        kind: "agent" as const,
        agentId,
        displayName: stringField(bot.name) || agentId,
        roleName: isCoordinator ? "协调者" : "成员",
        online,
        isCoordinator,
        isBot: true,
        currentTask: stringField(bot.currentTask) || undefined,
      };
    });

  return [...humans, ...bots];
}

export type ComposerMentionDirectory = {
  /** Active people already scoped to the signed-in enterprise. */
  humans?: ReadonlyArray<{
    user?: string | null;
    userId?: string | null;
    displayName?: string | null;
    status?: string | null;
  }> | null;
  /** Tenant robot rows. Ownership is applied separately; this list may include colleagues' robots. */
  robots?: ReadonlyArray<{
    agentId?: string | null;
    displayName?: string | null;
    ownerUserId?: string | null;
  }> | null;
  /** Agent ids the signed-in user owns (ownership records and seat grants). */
  ownedAgentIds?: readonly string[] | null;
  /** user id / email aliases for the signed-in person. */
  actorIdentities?: readonly (string | null | undefined)[] | null;
  /**
   * MCP connectors / plugins already modeled by the product (operational
   * identities, tools.catalog plugin groups, etc.). Status labels must come
   * from existing connection state — do not invent ones the data lacks.
   */
  plugins?: ReadonlyArray<{
    id?: string | null;
    displayName?: string | null;
    /** Product status label when known (e.g. 已连接 / 需重授权). */
    statusLabel?: string | null;
    /** True when the product reports an active/connected state. */
    connected?: boolean | null;
    /** Role shown when statusLabel is absent (e.g. 连接器 / 插件). */
    fallbackRoleName?: string | null;
  }> | null;
};

/** Prefix for connector/plugin @ candidates so they never collide with agent ids. */
export const COMPOSER_PLUGIN_MENTION_PREFIX = "plugin:";

export function isComposerPluginMentionAgentId(agentId: string | null | undefined): boolean {
  return (agentId?.trim().toLowerCase() ?? "").startsWith(COMPOSER_PLUGIN_MENTION_PREFIX);
}

/**
 * Map product connector/plugin rows into @ candidates.
 * Uses kind "plugin" so send-time mention extraction can skip delivery.
 */
export function buildPluginMentionCandidates(
  plugins: ComposerMentionDirectory["plugins"],
): MentionCandidate[] {
  const out: MentionCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of plugins ?? []) {
    const rawId = entry.id?.trim() ?? "";
    const displayName = entry.displayName?.trim() || rawId;
    if (!rawId || !displayName) {
      continue;
    }
    const agentId = rawId.toLowerCase().startsWith(COMPOSER_PLUGIN_MENTION_PREFIX)
      ? rawId
      : `${COMPOSER_PLUGIN_MENTION_PREFIX}${rawId}`;
    const key = agentId.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const statusLabel = entry.statusLabel?.trim() || undefined;
    const connected = entry.connected;
    out.push({
      kind: "plugin",
      agentId,
      displayName,
      roleName: statusLabel || entry.fallbackRoleName?.trim() || "插件",
      online: connected == null ? true : Boolean(connected),
      isCoordinator: false,
      isBot: false,
    });
  }
  return out;
}

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isSessionLikeHumanId(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized === "main" ||
    normalized.startsWith("agent:") ||
    normalized.startsWith("space:")
  );
}

/**
 * Tenant directory the composer can draw from.
 * Humans are real people in the same enterprise. Robots are only the
 * signed-in user's own robots, never the rest of the tenant roster.
 * This is not the picker list: {@link buildMentionCandidatesForComposer}
 * decides who is eligible in the open chat.
 */
export function buildComposerMentionCandidates(
  directory: ComposerMentionDirectory,
): MentionCandidate[] {
  const actors = new Set(
    (directory.actorIdentities ?? []).map((value) => normalizeIdentity(value)).filter(Boolean),
  );
  const ownedIds = (directory.ownedAgentIds ?? []).map((id) => id.trim()).filter(Boolean);
  const ownedKeys = new Set(ownedIds.map((id) => id.toLowerCase()));

  const humans: MentionCandidate[] = [];
  const seenHumans = new Set<string>();
  for (const member of directory.humans ?? []) {
    const email = member.user?.trim() ?? "";
    const userId = member.userId?.trim() || email;
    if (!userId || isSessionLikeHumanId(userId) || (email && isSessionLikeHumanId(email))) {
      continue;
    }
    if (member.status && member.status !== "active") {
      continue;
    }
    const key = userId.toLowerCase();
    if (seenHumans.has(key)) {
      continue;
    }
    seenHumans.add(key);
    humans.push({
      kind: "human",
      agentId: "",
      userId,
      displayName: member.displayName?.trim() || email || userId,
      roleName: "同事",
      online: true,
      isCoordinator: false,
      isBot: false,
    });
  }

  const robotById = new Map<
    string,
    { agentId: string; displayName: string; ownerUserId: string | null }
  >();
  const rememberRobot = (robot: {
    agentId?: string | null;
    displayName?: string | null;
    ownerUserId?: string | null;
  }) => {
    const agentId = robot.agentId?.trim() ?? "";
    if (!agentId || isBuiltinStewardAgent(agentId)) {
      return;
    }
    const key = agentId.toLowerCase();
    const existing = robotById.get(key);
    const incomingName = robot.displayName?.trim() ?? "";
    const previousName = existing?.displayName ?? "";
    const displayName =
      (previousName && previousName !== existing?.agentId ? previousName : "") ||
      incomingName ||
      previousName ||
      agentId;
    robotById.set(key, {
      agentId: existing?.agentId || agentId,
      displayName,
      ownerUserId: existing?.ownerUserId || robot.ownerUserId?.trim() || null,
    });
  };
  for (const robot of directory.robots ?? []) {
    rememberRobot(robot);
  }
  for (const agentId of ownedIds) {
    rememberRobot({ agentId });
  }

  const robots: MentionCandidate[] = [];
  for (const robot of robotById.values()) {
    const ownerKey = normalizeIdentity(robot.ownerUserId);
    const ownedByActor =
      ownedKeys.has(robot.agentId.toLowerCase()) || Boolean(ownerKey && actors.has(ownerKey));
    if (!ownedByActor) {
      continue;
    }
    robots.push({
      kind: "agent",
      agentId: robot.agentId,
      displayName: robot.displayName,
      roleName: "我的机器人",
      online: true,
      isCoordinator: false,
      isBot: true,
    });
  }

  return [...humans, ...robots];
}

/**
 * Who @ may offer in the open chat.
 * - group-members: a collaboration room — only that group's humans + robots
 * - own-assistants / tenant-humans: any non-group composer — same-tenant humans
 *   + robots the signed-in user owns/created (never colleagues' robots)
 */
export type ComposerMentionScope = "group-members" | "own-assistants" | "tenant-humans";

export type ComposerMentionSessionDefaults = {
  mainSessionKey?: string | null;
};

/** Space id embedded in `space:<id>`, `group:<id>`, or `agent:<bot>:…:space:<id>`. */
export function collaborationSessionMentionIdentity(sessionKey: string | null | undefined): string {
  const raw = sessionKey?.trim() ?? "";
  if (!raw) {
    return "";
  }
  if (/^group:/i.test(raw)) {
    return raw.slice("group:".length).trim();
  }
  if (/^space:/i.test(raw)) {
    return normalizeCollaborationSpaceIdentity(raw);
  }
  const embedded = raw.match(/:space:([^:]+)/i)?.[1]?.trim() ?? "";
  return embedded ? normalizeCollaborationSpaceIdentity(embedded) : "";
}

function isStewardMentionSession(sessionKey: string, mainSessionKey?: string | null): boolean {
  const raw = sessionKey.trim();
  if (!raw || collaborationSessionMentionIdentity(raw)) {
    return false;
  }
  const lower = raw.toLowerCase();
  if (
    lower === "main" ||
    lower === "agent:main" ||
    lower === "agent:main:main" ||
    lower === "daibai"
  ) {
    return true;
  }
  if (/^agent:main:employee:[^:]+$/i.test(raw)) {
    return true;
  }
  const parsed = parseAgentSessionKey(raw);
  if (parsed?.rest.toLowerCase().startsWith("org:")) {
    return false;
  }
  if (parsed && isBuiltinStewardAgent(parsed.agentId)) {
    return true;
  }
  const canonical = mainSessionKey?.trim() ?? "";
  if (canonical && raw === canonical) {
    return isStewardMentionSession(canonical);
  }
  return false;
}

/**
 * Eligibility follows the chat the composer is actually showing, not the
 * enterprise directory and not a stale module flag. A default agent id is
 * not 大白管家.
 */
export function resolveComposerMentionScope(params: {
  sessionKey?: string | null;
  sessionDefaults?: ComposerMentionSessionDefaults | null;
}): ComposerMentionScope {
  const sessionKey = params.sessionKey?.trim() ?? "";
  if (collaborationSessionMentionIdentity(sessionKey)) {
    return "group-members";
  }
  if (isStewardMentionSession(sessionKey, params.sessionDefaults?.mainSessionKey)) {
    return "tenant-humans";
  }
  return "own-assistants";
}

function normalizeMentionId(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function findCollaborationSpaceForMention<
  T extends { id?: string | null; groupId?: string | null },
>(spaces: readonly T[] | null | undefined, sessionKey: string | null | undefined): T | null {
  const identity = normalizeMentionId(collaborationSessionMentionIdentity(sessionKey));
  if (!identity) {
    return null;
  }
  for (const space of spaces ?? []) {
    const ids = [space.id, space.groupId].map((value) => normalizeMentionId(value)).filter(Boolean);
    if (ids.includes(identity)) {
      return space;
    }
  }
  return null;
}

export type ComposerMentionSpace = {
  id?: string | null;
  groupId?: string | null;
  coordinatorBotId?: string | null;
  members?: CollaborationSpaceMemberRosterTransport;
};

/**
 * @ candidates for the open composer.
 * Group chats offer that group's members only (humans + robots in the room).
 * Every non-group composer offers same-tenant humans plus the signed-in user's
 * own robots — never colleagues' robots. MCP connectors / plugins from the
 * product catalog remain available outside collaboration groups.
 */
export function buildMentionCandidatesForComposer(params: {
  sessionKey?: string | null;
  sessionDefaults?: ComposerMentionSessionDefaults | null;
  directory: ComposerMentionDirectory;
  spaces?: readonly ComposerMentionSpace[] | null;
  selfUserId?: string | null;
}): MentionCandidate[] {
  const scope = resolveComposerMentionScope({
    sessionKey: params.sessionKey,
    sessionDefaults: params.sessionDefaults,
  });
  if (scope === "group-members") {
    const space = findCollaborationSpaceForMention(params.spaces, params.sessionKey);
    return buildMentionCandidatesFromRoster({
      members: space?.members,
      selfUserId: params.selfUserId,
      coordinatorBotId: space?.coordinatorBotId,
    });
  }
  // Non-group (ordinary bot chat and 大白管家): tenant humans + owned robots.
  const directoryCandidates = buildComposerMentionCandidates(params.directory);
  const pluginCandidates = buildPluginMentionCandidates(params.directory.plugins);
  return [...directoryCandidates, ...pluginCandidates];
}

/** Map known operational-identity statuses to existing product labels only. */
export function composerConnectorStatusFromIdentity(
  status: string | null | undefined,
): { statusLabel: string; connected: boolean } | null {
  switch (status?.trim()) {
    case "active":
      return { statusLabel: "已连接", connected: true };
    case "expired":
      return { statusLabel: "已过期", connected: false };
    case "reauth_required":
      return { statusLabel: "需重授权", connected: false };
    case "revoked":
      return { statusLabel: "已停用", connected: false };
    default:
      return null;
  }
}

/**
 * Collect MCP connector / plugin @ rows from catalogs the UI already loads.
 * Operational identities carry connection status; tools.catalog plugin groups
 * are listed without inventing an auth state.
 */
export function collectComposerPluginMentionEntries(params: {
  operationalIdentities?: ReadonlyArray<{
    identityId?: string | null;
    provider?: string | null;
    providerLabel?: string | null;
    displayName?: string | null;
    status?: string | null;
  }> | null;
  pluginToolGroups?: ReadonlyArray<{
    id?: string | null;
    label?: string | null;
    source?: string | null;
    pluginId?: string | null;
  }> | null;
}): NonNullable<ComposerMentionDirectory["plugins"]> {
  const entries: Array<NonNullable<ComposerMentionDirectory["plugins"]>[number]> = [];
  const seen = new Set<string>();

  for (const identity of params.operationalIdentities ?? []) {
    const identityId = identity.identityId?.trim() ?? "";
    const provider = identity.provider?.trim() ?? "";
    // Encode provider so turn-time binding can call user_operational_identity.
    const id = provider && identityId ? `${provider}:${identityId}` : provider || identityId;
    if (!id) {
      continue;
    }
    const key = `connector:${id}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const status = composerConnectorStatusFromIdentity(identity.status);
    const displayName =
      identity.displayName?.trim() || identity.providerLabel?.trim() || provider || identityId;
    entries.push({
      id: `connector:${id}`,
      displayName,
      statusLabel: status?.statusLabel,
      connected: status?.connected,
      fallbackRoleName: "连接器",
    });
  }

  for (const group of params.pluginToolGroups ?? []) {
    if (group.source && group.source !== "plugin") {
      continue;
    }
    const pluginId = group.pluginId?.trim() || group.id?.trim() || "";
    if (!pluginId) {
      continue;
    }
    const id = pluginId.startsWith("plugin:") ? pluginId.slice("plugin:".length) : pluginId;
    const key = `plugin:${id}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({
      id: `ext:${id}`,
      displayName: group.label?.trim() || id,
      fallbackRoleName: "插件",
    });
  }

  return entries;
}

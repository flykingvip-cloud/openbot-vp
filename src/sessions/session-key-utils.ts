export type ParsedAgentSessionKey = {
  agentId: string;
  rest: string;
};

export type SessionKeyChatType = "direct" | "group" | "channel" | "unknown";

/**
 * Parse agent-scoped session keys in a canonical, case-insensitive way.
 * Returned values are normalized to lowercase for stable comparisons/routing.
 */
export function parseAgentSessionKey(
  sessionKey: string | undefined | null,
): ParsedAgentSessionKey | null {
  const raw = (sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return null;
  }
  const parts = raw.split(":").filter(Boolean);
  if (parts.length < 3) {
    return null;
  }
  if (parts[0] !== "agent") {
    return null;
  }
  const agentId = parts[1]?.trim();
  const rest = parts.slice(2).join(":");
  if (!agentId || !rest) {
    return null;
  }
  return { agentId, rest };
}

/**
 * Best-effort chat-type extraction from session keys across canonical and legacy formats.
 */
export function deriveSessionChatType(sessionKey: string | undefined | null): SessionKeyChatType {
  const raw = (sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return "unknown";
  }
  const scoped = parseAgentSessionKey(raw)?.rest ?? raw;
  const tokens = new Set(scoped.split(":").filter(Boolean));
  if (tokens.has("group")) {
    return "group";
  }
  if (tokens.has("channel")) {
    return "channel";
  }
  if (tokens.has("direct") || tokens.has("dm")) {
    return "direct";
  }
  // Legacy Discord keys can be shaped like:
  // discord:<accountId>:guild-<guildId>:channel-<channelId>
  if (/^discord:(?:[^:]+:)?guild-[^:]+:channel-[^:]+$/.test(scoped)) {
    return "channel";
  }
  return "unknown";
}

export function isCronRunSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return false;
  }
  return /^cron:[^:]+:run:[^:]+$/.test(parsed.rest);
}

export function isCronSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return false;
  }
  return parsed.rest.toLowerCase().startsWith("cron:");
}

export function isSubagentSessionKey(sessionKey: string | undefined | null): boolean {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return false;
  }
  if (raw.toLowerCase().startsWith("subagent:")) {
    return true;
  }
  const parsed = parseAgentSessionKey(raw);
  return Boolean((parsed?.rest ?? "").toLowerCase().startsWith("subagent:"));
}

export function getSubagentDepth(sessionKey: string | undefined | null): number {
  const raw = (sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return 0;
  }
  return raw.split(":subagent:").length - 1;
}

export function isAcpSessionKey(sessionKey: string | undefined | null): boolean {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return false;
  }
  const normalized = raw.toLowerCase();
  if (normalized.startsWith("acp:")) {
    return true;
  }
  const parsed = parseAgentSessionKey(raw);
  return Boolean((parsed?.rest ?? "").toLowerCase().startsWith("acp:"));
}

const THREAD_SESSION_MARKERS = [":thread:", ":topic:"];

/**
 * Collaboration space identity. Repeated `space:` prefixes collapse so
 * `space:space:grp-x` and `space:grp-x` are the same group.
 */
export function normalizeCollaborationSpaceIdentity(value: string | null | undefined): string {
  let out = (value ?? "").trim();
  while (/^space:/i.test(out)) {
    out = out.slice("space:".length).trim();
  }
  return out;
}

/** Destination key for a collaboration group: `space:<groupId>`. */
export function toCollaborationSpaceSessionKey(value: string | null | undefined): string {
  const identity = normalizeCollaborationSpaceIdentity(value);
  return identity ? `space:${identity}` : "";
}

/** True for collaboration group / space chat lanes (`space:…` or `…:space:…`). */
export function isCollaborationGroupChatSessionKey(sessionKey: string | null | undefined): boolean {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return false;
  }
  if (/^space:/i.test(raw)) {
    return true;
  }
  return /(?:^|:)space:[^:]+/i.test(raw);
}

/**
 * Organization inter-agent inbox. Per robot, per organization — not a
 * collaboration-group transcript and not the robot's 1:1 `agent:<id>:main`.
 */
export function toOrganizationAgentSessionKey(params: {
  agentId: string;
  organizationId: string;
}): string {
  const agentId = params.agentId.trim();
  const organizationId = params.organizationId.trim();
  if (!agentId || !organizationId) {
    return "";
  }
  return `agent:${agentId}:org:${encodeURIComponent(organizationId)}`;
}

/** True for `agent:<bot>:org:<organizationId>` inter-agent inboxes. */
export function isOrganizationAgentSessionKey(sessionKey: string | null | undefined): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  return Boolean(parsed?.rest.toLowerCase().startsWith("org:"));
}

/**
 * One workbench destination per robot and per collaboration group.
 * Bot-scoped `agent:…:space:<id>` mirrors collapse onto `space:<id>`.
 * Extra 1:1 channel aliases collapse onto `agent:<id>:main`.
 * Imported / wecom leftovers stay leftover so retire can delete them.
 * Cron, subagent, ACP, per-employee steward, and organization inboxes
 * stay on their own files.
 */
export function canonicalizeWorkbenchChatSessionKey(sessionKey: string): string {
  const raw = sessionKey.trim();
  if (!raw) {
    return raw;
  }
  if (isCronSessionKey(raw) || isSubagentSessionKey(raw) || isAcpSessionKey(raw)) {
    return raw;
  }
  if (isRedundantRobotAliasSessionKey(raw)) {
    return raw;
  }
  if (isOrganizationAgentSessionKey(raw)) {
    const parsed = parseAgentSessionKey(raw);
    return parsed ? `agent:${parsed.agentId}:${parsed.rest}` : raw;
  }
  if (raw.toLowerCase().startsWith("space:")) {
    return toCollaborationSpaceSessionKey(raw) || raw;
  }
  const spaceMatch = raw.match(/:space:([^:]+)/i);
  const groupId = spaceMatch?.[1]?.trim();
  if (groupId) {
    return toCollaborationSpaceSessionKey(groupId);
  }
  const parsed = parseAgentSessionKey(raw);
  if (!parsed) {
    return raw;
  }
  if (parsed.rest.toLowerCase().startsWith("employee:")) {
    return raw;
  }
  return `agent:${parsed.agentId}:main`;
}

export function isImportedAgentSessionKey(sessionKey: string | null | undefined): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  return Boolean(parsed?.rest.toLowerCase().startsWith("imported:"));
}

export function isWecomGroupSessionKey(sessionKey: string | null | undefined): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  return Boolean(parsed?.rest.toLowerCase().startsWith("wecom:group:"));
}

/** Leftover robot aliases that must not remain as workbench store destinations. */
export function isRedundantRobotAliasSessionKey(sessionKey: string | null | undefined): boolean {
  return isImportedAgentSessionKey(sessionKey) || isWecomGroupSessionKey(sessionKey);
}

/**
 * Old bot-scoped `:space:` leftover, including the retired org-bus inbox
 * `agent:<bot>:main:space:<org>`. Canonical `space:<id>` and the new
 * `agent:<bot>:org:<id>` inbox are not leftovers.
 */
export function isLeftoverBotSpaceSessionKey(sessionKey: string | null | undefined): boolean {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return false;
  }
  if (raw.toLowerCase().startsWith("space:")) {
    return false;
  }
  if (
    isOrganizationAgentSessionKey(raw) ||
    isCronSessionKey(raw) ||
    isSubagentSessionKey(raw) ||
    isAcpSessionKey(raw)
  ) {
    return false;
  }
  return Boolean(parseAgentSessionKey(raw) && /:space:[^:]+/i.test(raw));
}

export function resolveThreadParentSessionKey(
  sessionKey: string | undefined | null,
): string | null {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  let idx = -1;
  for (const marker of THREAD_SESSION_MARKERS) {
    const candidate = normalized.lastIndexOf(marker);
    if (candidate > idx) {
      idx = candidate;
    }
  }
  if (idx <= 0) {
    return null;
  }
  const parent = raw.slice(0, idx).trim();
  return parent ? parent : null;
}

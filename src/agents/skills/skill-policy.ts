import { normalizeSkillFilter } from "./filter.js";

/**
 * Runtime skill gate used by snapshot + embedded runner.
 *
 * Documented DefaultCapabilityComposer equivalent (not a drop-in call):
 * - `allow` is the composer.final analogue — capability/skill tokens, not tool names.
 * - `block` is composer policyFilters `block:x` / `!x` plus group/overlay blockedSkills.
 * - Empty `enabledSkills` omit `allow` = no group-level skill restriction.
 *   That is not "tools unrestricted": tenant/system ACL and agent capability ACL still apply.
 *   composer.final `[]` would mean allow-none; we do not use that.
 * - Overlay `enabledSkills` INTERSECT other allow sources (composer UNIONs participation).
 * - Track D lock: this module is the only skill *execution* gate compose path; never call
 *   DefaultCapabilityComposer here (prompt-only UNION lives in collaboration capability context).
 * - Personal 1:1 never attaches this policy. composer personalCapabilities stay unused.
 *
 * Tool execution authority is `applySkillPolicyToAllowlist` / `isToolAllowedBySkillPolicy`:
 * tokens map onto tool names (search → web_search) and identity `ob_sk_<skillId>__*`.
 *
 * `allow` undefined = no extra allow-list (existing skills stay visible).
 * `allow` [] = none. Non-empty `allow` is an allow-list.
 * `block` always subtracts, including when `allow` is unrestricted.
 */
export type SkillPolicy = {
  allow?: string[];
  block: string[];
};

export const UNRESTRICTED_SKILL_POLICY: SkillPolicy = { block: [] };

function normalizeNamedList(values?: ReadonlyArray<string> | null): string[] {
  return normalizeSkillFilter(values ?? undefined) ?? [];
}

function intersectAllowLists(lists: string[][]): string[] {
  if (lists.length === 0) {
    return [];
  }
  return lists.reduce((current, next) => {
    const nextSet = new Set(next);
    return current.filter((name) => nextSet.has(name));
  });
}

/** Same tokens as DefaultCapabilityComposer: `allow:x`, `block:x`, `!x`, or bare `x`. */
export function parseSkillPolicyFilters(filters?: ReadonlyArray<string> | null): {
  allow: string[];
  block: string[];
} {
  const allow: string[] = [];
  const block: string[] = [];
  for (const raw of filters ?? []) {
    const filter = raw.trim();
    if (!filter) {
      continue;
    }
    if (filter.startsWith("allow:")) {
      const name = filter.slice("allow:".length).trim();
      if (name) {
        allow.push(name);
      }
      continue;
    }
    if (filter.startsWith("block:")) {
      const name = filter.slice("block:".length).trim();
      if (name) {
        block.push(name);
      }
      continue;
    }
    if (filter.startsWith("!")) {
      const name = filter.slice(1).trim();
      if (name) {
        block.push(name);
      }
      continue;
    }
    allow.push(filter);
  }
  return { allow: normalizeNamedList(allow), block: normalizeNamedList(block) };
}

export function composeSkillPolicy(params: {
  groupProfile?: { enabledSkills?: string[]; blockedSkills?: string[] } | null;
  overlay?: {
    enabledSkills?: string[];
    blockedSkills?: string[];
    policyFilters?: string[];
  } | null;
}): SkillPolicy {
  const overlayFilters = parseSkillPolicyFilters(params.overlay?.policyFilters);
  const allowLists = [
    normalizeNamedList(params.groupProfile?.enabledSkills),
    normalizeNamedList(params.overlay?.enabledSkills),
    overlayFilters.allow,
  ].filter((list) => list.length > 0);
  const allow = allowLists.length > 0 ? intersectAllowLists(allowLists) : undefined;
  const block = [
    ...new Set([
      ...normalizeNamedList(params.groupProfile?.blockedSkills),
      ...normalizeNamedList(params.overlay?.blockedSkills),
      ...overlayFilters.block,
    ]),
  ];
  if (allow === undefined) {
    return { block };
  }
  const blocked = new Set(block);
  return {
    allow: allow.filter((name) => !blocked.has(name)),
    block,
  };
}

/** Merge an existing snapshot/channel allow-list with group/overlay policy. */
export function applySkillPolicyToFilter(
  baseFilter: string[] | undefined,
  policy: SkillPolicy,
): string[] | undefined {
  if (policy.allow === undefined) {
    return baseFilter;
  }
  if (baseFilter === undefined) {
    return policy.allow;
  }
  if (baseFilter.length === 0 || policy.allow.length === 0) {
    return [];
  }
  const allowSet = new Set(policy.allow);
  return baseFilter.filter((name) => allowSet.has(name));
}

/** Duplicated from skill-tool-wrappers to keep this module import-light. */
const SKILL_IDENTITY_TOOL_PREFIX = "ob_sk_";

function foldPolicyToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** search/websearch/web_search → web_search; exec/bash/shell → exec. Lookup is folded. */
const CORE_TOOL_CANONICAL_BY_FOLD = new Map<string, string>([
  ["search", "web_search"],
  ["websearch", "web_search"],
  ["exec", "exec"],
  ["bash", "exec"],
  ["shell", "exec"],
]);

/** CJK / UI labels do not survive foldPolicyToken; match the trimmed token first. */
const CORE_TOOL_CANONICAL_BY_TOKEN = new Map<string, string>([
  ["搜索", "web_search"],
  ["搜索技能", "web_search"],
  ["联网搜索", "web_search"],
  ["搜索网页", "web_search"],
]);

function canonicalCoreTool(value: string): string | undefined {
  const trimmed = value.trim();
  const byToken = CORE_TOOL_CANONICAL_BY_TOKEN.get(trimmed);
  if (byToken) {
    return byToken;
  }
  const folded = foldPolicyToken(trimmed);
  return folded ? CORE_TOOL_CANONICAL_BY_FOLD.get(folded) : undefined;
}

function parseSkillIdentityToolName(
  toolName: string,
): { skillId: string; baseTool: string } | null {
  const name = toolName.trim();
  if (!name.startsWith(SKILL_IDENTITY_TOOL_PREFIX)) {
    return null;
  }
  const rest = name.slice(SKILL_IDENTITY_TOOL_PREFIX.length);
  const sep = rest.lastIndexOf("__");
  if (sep <= 0 || sep >= rest.length - 2) {
    return null;
  }
  const skillId = rest.slice(0, sep);
  const baseTool = rest.slice(sep + 2);
  if (!skillId || !baseTool) {
    return null;
  }
  return { skillId, baseTool };
}

/**
 * Map a group/capability policy token onto an embedded tool name.
 * Exact match, folded equality, core aliases, then identity `ob_sk_<skillId>__<baseTool>`.
 */
export function skillPolicyTokenMatchesToolName(token: string, toolName: string): boolean {
  const trimmedToken = token.trim();
  const trimmedTool = toolName.trim();
  if (!trimmedToken || !trimmedTool) {
    return false;
  }
  if (trimmedToken === trimmedTool) {
    return true;
  }
  if (foldPolicyToken(trimmedToken) === foldPolicyToken(trimmedTool)) {
    return true;
  }
  const tokenCore = canonicalCoreTool(trimmedToken);
  const toolCore = canonicalCoreTool(trimmedTool);
  if (tokenCore && toolCore && tokenCore === toolCore) {
    return true;
  }
  const identity = parseSkillIdentityToolName(trimmedTool);
  if (!identity) {
    return false;
  }
  if (foldPolicyToken(identity.skillId) === foldPolicyToken(trimmedToken)) {
    return true;
  }
  const baseCore = canonicalCoreTool(identity.baseTool);
  return Boolean(tokenCore && baseCore && tokenCore === baseCore);
}

export function isSkillNameAllowed(name: string, policy: SkillPolicy): boolean {
  const normalized = name.trim();
  if (!normalized) {
    return false;
  }
  if (policy.block.some((token) => skillPolicyTokenMatchesToolName(token, normalized))) {
    return false;
  }
  if (policy.allow !== undefined) {
    return policy.allow.some((token) => skillPolicyTokenMatchesToolName(token, normalized));
  }
  return true;
}

/** Tool-level DefaultCapabilityComposer.isCapabilityAllowed. */
export function isToolAllowedBySkillPolicy(toolName: string, policy: SkillPolicy): boolean {
  return isSkillNameAllowed(toolName, policy);
}

/**
 * Lift composer.final (+ explicit blocks) into a SkillPolicy.
 * Empty `final` is allow-none — only call this when the composer actually composed
 * a non-empty capability set, never as a stand-in for unrestricted group profiles.
 */
export function skillPolicyFromCapabilityFinal(params: {
  final: readonly string[];
  block?: readonly string[];
}): SkillPolicy {
  const blocked = new Set(normalizeNamedList(params.block));
  return {
    allow: normalizeNamedList(params.final).filter((name) => !blocked.has(name)),
    block: [...blocked],
  };
}

export function applySkillPolicyToEntries<T extends { skill: { name: string } }>(
  entries: T[],
  policy: SkillPolicy,
): T[] {
  if (policy.allow === undefined && policy.block.length === 0) {
    return entries;
  }
  return entries.filter((entry) => isSkillNameAllowed(entry.skill.name, policy));
}

/** Name-level gate for embedded tool allowlists. Empty `allow` does not tighten. */
export function applySkillPolicyToAllowlist(names: string[], policy: SkillPolicy): string[] {
  if (policy.allow === undefined && policy.block.length === 0) {
    return names;
  }
  return names.filter((name) => isSkillNameAllowed(name, policy));
}

export function skillPolicyFromSnapshot(
  snapshot?: {
    skillFilter?: string[];
    skillBlocklist?: string[];
  } | null,
): SkillPolicy {
  if (!snapshot) {
    return UNRESTRICTED_SKILL_POLICY;
  }
  return {
    ...(snapshot.skillFilter !== undefined ? { allow: snapshot.skillFilter } : {}),
    block: snapshot.skillBlocklist ?? [],
  };
}

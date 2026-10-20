import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import { SKILL_EXECUTION_BINDING_PREFIX } from "./types.js";

/** Root for all per-agent materialised lifecycle skills. */
export function resolveSkillExecutionBindingsRoot(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, "skill-execution-bindings");
}

/** Per-agent binding root (one subdirectory tree per robot). */
export function resolveAgentSkillExecutionBindingsDir(
  agentId: string,
  configDir: string = CONFIG_DIR,
): string {
  const safeAgent = sanitizePathSegment(agentId) || "unknown-agent";
  return path.join(resolveSkillExecutionBindingsRoot(configDir), safeAgent);
}

/** Directory for a single bound skill (contains SKILL.md). */
export function resolveBoundSkillDir(
  agentId: string,
  skillId: string,
  configDir: string = CONFIG_DIR,
): string {
  return path.join(
    resolveAgentSkillExecutionBindingsDir(agentId, configDir),
    skillExecutionSkillDirName(skillId),
  );
}

export function skillExecutionSkillDirName(skillId: string): string {
  return `${SKILL_EXECUTION_BINDING_PREFIX}${sanitizePathSegment(skillId) || "skill"}`;
}

/** Frontmatter / runtime skill name (must match dir-derived name for pi loader). */
export function skillExecutionSkillName(skillId: string): string {
  return skillExecutionSkillDirName(skillId);
}

function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

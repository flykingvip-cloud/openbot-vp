/**
 * Builtin Steward — 标配 skills。
 *
 * 每个用户的大白管家会话都必须能加载这些 bundled skills。
 * - 无 agent skills 白名单时：bundled 技能本身已可见（always 仅作高优先级排序，非标配唯一路径）；
 * - 有白名单时：把标配 skill 并入白名单，避免被误关。
 */

/** 大白管家标配 skill 名（与 skills/<name>/SKILL.md 的 name 一致）。 */
export const STEWARD_REQUIRED_SKILLS = [
  "configure-external-api-source",
  "user-guidance-protocol",
  "execution-discipline",
  "openbot-docs",
  "personal-mail-assistant",
] as const;

export type StewardRequiredSkill = (typeof STEWARD_REQUIRED_SKILLS)[number];

/**
 * 将大白标配 skills 并入 agent skills 过滤列表。
 * - `undefined`：不过滤（全部 eligible），原样返回；
 * - 数组（含空数组）：确保标配 skill 名存在于结果中。
 */
export function ensureStewardRequiredSkills(
  skillFilter: string[] | undefined,
): string[] | undefined {
  if (skillFilter === undefined) {
    return undefined;
  }
  const merged = new Set(skillFilter);
  for (const skill of STEWARD_REQUIRED_SKILLS) {
    merged.add(skill);
  }
  return Array.from(merged);
}

/**
 * Governance / steward-required skills belong in the visible whitelist only when
 * the turn may take side effects or UI navigation. Today that is inbound depth
 * `act` (there is no separate `ui_nav` depth; act ceiling covers it).
 * chat / retrieve must not force-merge these into the skill window.
 */
export function shouldForceStewardRequiredSkills(
  depth: "chat" | "retrieve" | "act" | undefined,
): boolean {
  return depth === "act";
}

/**
 * P1：技能安装成功 → 成长续跑条 的轻量钩子（避免 controllers ↔ ports 循环依赖）。
 */

type GrowthSkillInstallHook = (agentId: string, skillId: string) => void | Promise<void>;

let hook: GrowthSkillInstallHook | null = null;

export function setGrowthSkillInstallHook(next: GrowthSkillInstallHook | null): void {
  hook = next;
}

export async function runGrowthSkillInstallHook(agentId: string, skillId: string): Promise<void> {
  await hook?.(agentId, skillId);
}

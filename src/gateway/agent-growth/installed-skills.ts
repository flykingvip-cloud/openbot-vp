/**
 * Agent Growth OS — 已安装技能采集（P0 onboarding）。
 *
 * 单一权威源：robot skill assets store。供 recompute / operational projection / gaps 共用。
 */

import { listRobotSkillAssets } from "../skill-lifecycle-store.js";

/** 收集机器人已安装 skill 的可匹配标识集合（id + profile.name）。 */
export function collectInstalledSkillKeys(agentId: string): string[] {
  const keys: string[] = [];
  for (const entry of listRobotSkillAssets(agentId)) {
    if (typeof entry.id === "string" && entry.id) {
      keys.push(entry.id);
    }
    const profileName = (entry as { profile?: { name?: unknown } }).profile?.name;
    if (typeof profileName === "string" && profileName) {
      keys.push(profileName);
    }
  }
  return keys;
}

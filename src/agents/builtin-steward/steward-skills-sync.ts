/**
 * Sync steward-required bundled skills into an employee steward workspace so
 * workspaceOnly FS policy can still read SKILL.md + references/*.yaml.
 *
 * Unlike syncSkillsToWorkspace (sandbox), this only copies STEWARD_REQUIRED_SKILLS
 * and never deletes other workspace skills.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveBundledSkillsDir } from "../skills/bundled-dir.js";
import { STEWARD_REQUIRED_SKILLS } from "./required-skills.js";

export async function ensureStewardRequiredSkillsSynced(params: {
  workspaceDir: string;
  bundledSkillsDir?: string;
}): Promise<string[]> {
  const bundledRoot = params.bundledSkillsDir?.trim() || resolveBundledSkillsDir();
  if (!bundledRoot) {
    return [];
  }
  const targetRoot = path.join(params.workspaceDir, "skills");
  await fs.mkdir(targetRoot, { recursive: true });
  const synced: string[] = [];
  for (const name of STEWARD_REQUIRED_SKILLS) {
    const source = path.join(bundledRoot, name);
    const skillMd = path.join(source, "SKILL.md");
    try {
      await fs.access(skillMd);
    } catch {
      continue;
    }
    const dest = path.join(targetRoot, name);
    await fs.cp(source, dest, { recursive: true, force: true });
    synced.push(name);
  }
  return synced;
}

import fs from "node:fs";
import path from "node:path";
import { resolveAgentSkillExecutionBindingsDir, resolveBoundSkillDir } from "./paths.js";
import type { SkillExecutionBindingRecord } from "./types.js";

/**
 * SAR execution pin. Stored beside the materialised skill, not inside the
 * directory that disable/remove deletes. Catalog upgrades must not rewrite
 * installedVersion or artifactDigest.
 */
export function resolveSarExecutionPinPath(
  agentId: string,
  skillId: string,
  configDir?: string,
): string {
  const safeSkill = skillId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 120);
  return path.join(
    resolveAgentSkillExecutionBindingsDir(agentId, configDir),
    "sar-pins",
    `${safeSkill || "skill"}.json`,
  );
}

export function readSarExecutionPin(params: {
  agentId: string;
  skillId: string;
  configDir?: string;
}): SkillExecutionBindingRecord | null {
  const filePath = resolveSarExecutionPinPath(params.agentId, params.skillId, params.configDir);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as Partial<SkillExecutionBindingRecord>;
    const artifactDigest = parsed.artifactDigest?.trim() ?? "";
    const installedVersion = parsed.installedVersion?.trim() ?? "";
    const skillId = parsed.skillId?.trim() ?? "";
    const agentId = parsed.agentId?.trim() ?? "";
    if (!artifactDigest || !installedVersion || !skillId || !agentId) {
      return null;
    }
    if (skillId !== params.skillId.trim() || agentId !== params.agentId.trim()) {
      return null;
    }
    return {
      agentId,
      skillId,
      skillName: parsed.skillName?.trim() || skillId,
      installedVersion,
      artifactDigest,
      enabled: parsed.enabled !== false,
      materialisedPath: parsed.materialisedPath?.trim() || filePath,
      updatedAtMs: typeof parsed.updatedAtMs === "number" ? parsed.updatedAtMs : 0,
    };
  } catch {
    return null;
  }
}

export function writeSarExecutionPin(
  record: SkillExecutionBindingRecord,
  configDir?: string,
): SkillExecutionBindingRecord {
  const artifactDigest = record.artifactDigest?.trim() ?? "";
  const installedVersion = record.installedVersion.trim();
  if (!artifactDigest || !installedVersion) {
    throw new Error("SAR execution pin requires installedVersion and artifactDigest");
  }
  const filePath = resolveSarExecutionPinPath(record.agentId, record.skillId, configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const pinned: SkillExecutionBindingRecord = {
    agentId: record.agentId.trim(),
    skillId: record.skillId.trim(),
    skillName: record.skillName.trim() || record.skillId.trim(),
    installedVersion,
    artifactDigest,
    enabled: record.enabled,
    materialisedPath:
      record.materialisedPath.trim() ||
      path.join(resolveBoundSkillDir(record.agentId, record.skillId, configDir), "SKILL.md"),
    updatedAtMs: record.updatedAtMs,
  };
  fs.writeFileSync(filePath, JSON.stringify(pinned, null, 2), "utf8");
  return pinned;
}

/**
 * Keep an existing pin's version and digest. Only the enabled flag follows
 * the robot relation. A missing pin is left missing.
 */
export function retainSarExecutionPin(params: {
  agentId: string;
  skillId: string;
  enabled: boolean;
  configDir?: string;
}): SkillExecutionBindingRecord | null {
  const existing = readSarExecutionPin(params);
  if (!existing?.artifactDigest) {
    return null;
  }
  if (existing.enabled === params.enabled) {
    return existing;
  }
  return writeSarExecutionPin({ ...existing, enabled: params.enabled }, params.configDir);
}

export function deleteSarExecutionPin(params: {
  agentId: string;
  skillId: string;
  configDir?: string;
}): void {
  const filePath = resolveSarExecutionPinPath(params.agentId, params.skillId, params.configDir);
  fs.rmSync(filePath, { force: true });
}

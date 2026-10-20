import fs from "node:fs";
import path from "node:path";
import { loadSkillsFromDir, type Skill } from "@earendil-works/pi-coding-agent";
import type { SkillSnapshot } from "../../agents/skills.js";
import type { SkillEntry } from "../../agents/skills/types.js";
import { CONFIG_DIR } from "../../utils.js";
import { listBindings } from "../agent-runtime-store.js";
import {
  getSkillRuntimeDefinitionForBinding,
  listRobotSkillAssets,
} from "../skill-lifecycle-store.js";
import {
  materializeSkillExecutionBinding,
  removeSkillExecutionBindingFiles,
} from "./materialize.js";
import { resolveAgentSkillExecutionBindingsDir, skillExecutionSkillName } from "./paths.js";
import { deleteSarExecutionPin, retainSarExecutionPin } from "./sar-pin.js";
import { SKILL_EXECUTION_BINDING_PREFIX, type SyncSkillExecutionBindingResult } from "./types.js";

/**
 * Sync one robot↔skill relation into the execution projection (materialise or remove).
 * Safe to call after install/toggle/upgrade/remove.
 */
export function syncSkillExecutionBinding(params: {
  agentId: string;
  skillId: string;
  configDir?: string;
}): SyncSkillExecutionBindingResult {
  const agentId = params.agentId.trim();
  const skillId = params.skillId.trim();
  if (!agentId || !skillId) {
    return { action: "skipped", reason: "missing-ids" };
  }

  const relations = listRobotSkillAssets(agentId);
  const relation = relations.find((entry) => entry.id === skillId);
  if (!relation) {
    deleteSarExecutionPin({ agentId, skillId, configDir: params.configDir });
    return removeSkillExecutionBindingFiles({
      agentId,
      skillId,
      configDir: params.configDir,
    });
  }

  // SAR pins stay on the digest recorded at install. Relation upgrades follow
  // the catalog head and must not move this version.
  const sarPin = retainSarExecutionPin({
    agentId,
    skillId,
    enabled: relation.enabled,
    configDir: params.configDir,
  });
  const installedVersion = sarPin?.artifactDigest
    ? sarPin.installedVersion
    : relation.installedVersion;

  let bundle: ReturnType<typeof getSkillRuntimeDefinitionForBinding>;
  try {
    bundle = getSkillRuntimeDefinitionForBinding(skillId, {
      version: installedVersion,
    });
  } catch {
    return removeSkillExecutionBindingFiles({
      agentId,
      skillId,
      configDir: params.configDir,
    });
  }

  return materializeSkillExecutionBinding({
    agentId,
    skillId,
    enabled: relation.enabled,
    installedVersion,
    artifactDigest: sarPin?.artifactDigest,
    lifecycle: bundle.lifecycle,
    assetType: bundle.profile.assetType,
    profile: bundle.profile,
    runtimeDefinition: bundle.runtimeDefinition,
    configDir: params.configDir,
  });
}

export function syncAllSkillExecutionBindingsForAgent(params: {
  agentId: string;
  configDir?: string;
}): SyncSkillExecutionBindingResult[] {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return [];
  }
  const results: SyncSkillExecutionBindingResult[] = [];
  for (const entry of listRobotSkillAssets(agentId)) {
    results.push(
      syncSkillExecutionBinding({
        agentId,
        skillId: entry.id,
        configDir: params.configDir,
      }),
    );
  }
  // Remove orphan materialisations no longer present / enabled.
  const root = resolveAgentSkillExecutionBindingsDir(agentId, params.configDir ?? CONFIG_DIR);
  if (fs.existsSync(root)) {
    const keep = new Set(
      listRobotSkillAssets(agentId)
        .filter((entry) => entry.enabled)
        .map((entry) => skillExecutionSkillName(entry.id)),
    );
    for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dirent.isDirectory()) {
        continue;
      }
      if (!keep.has(dirent.name)) {
        fs.rmSync(path.join(root, dirent.name), { recursive: true, force: true });
        results.push({ action: "removed", reason: "orphan", skillName: dirent.name });
      }
    }
  }
  return results;
}

export function isLifecycleBindingSkillName(name: string): boolean {
  return name.startsWith(SKILL_EXECUTION_BINDING_PREFIX);
}

/**
 * Load materialised lifecycle skills for an agent as SkillEntry[] for the embedded runner.
 * Skips skills whose agent-runtime binding is disabled (governance pause).
 */
export function loadSkillExecutionBindingEntries(params: {
  agentId: string;
  configDir?: string;
  /** When true, also require agent-runtime binding not disabled for the skill. */
  respectRuntimeBindingPause?: boolean;
}): SkillEntry[] {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return [];
  }
  const root = resolveAgentSkillExecutionBindingsDir(agentId, params.configDir ?? CONFIG_DIR);
  if (!fs.existsSync(root)) {
    return [];
  }
  try {
    const loaded = loadSkillsFromDir({ dir: root, source: "openbot-lifecycle-binding" });
    const skills = unwrapLoadedSkills(loaded);
    const pausedNames =
      params.respectRuntimeBindingPause === false
        ? new Set<string>()
        : resolvePausedLifecycleSkillNames(agentId);
    return skills
      .filter((skill) => !pausedNames.has(skill.name))
      .map((skill) => toBindingSkillEntry(skill));
  } catch {
    return [];
  }
}

/** Merge binding skills into an existing SkillEntry list (binding wins on name collision). */
export function mergeSkillEntriesWithBindings(
  base: SkillEntry[],
  bound: SkillEntry[],
): SkillEntry[] {
  // Drop stale lifecycle skills from base (snapshot freeze) so disable/remove take effect.
  const withoutStaleLifecycle = base.filter(
    (entry) => !isLifecycleBindingSkillName(entry.skill.name),
  );
  if (bound.length === 0) {
    return withoutStaleLifecycle;
  }
  const byName = new Map<string, SkillEntry>();
  for (const entry of withoutStaleLifecycle) {
    byName.set(entry.skill.name, entry);
  }
  for (const entry of bound) {
    byName.set(entry.skill.name, entry);
  }
  return Array.from(byName.values());
}

function toSkillEntry(skill: Skill): SkillEntry {
  return {
    skill,
    frontmatter: {},
    metadata: {
      skillKey: skill.name,
      always: true,
    },
  };
}

/** Installed lifecycle/MCP skills must outrank the frozen catalog so char-budget truncation keeps them. */
function toBindingSkillEntry(skill: Skill): SkillEntry {
  return {
    skill,
    frontmatter: {},
    metadata: {
      skillKey: skill.name,
      always: true,
      promptPriority: 80,
    },
  };
}

/**
 * Merge lifecycle execution bindings into a frozen skills snapshot (cron/session).
 * Stale `ob-asset-*` names from the snapshot are dropped; live bindings win on collision.
 */
export function mergeSkillSnapshotWithExecutionBindings(
  snapshot: SkillSnapshot,
  agentId: string,
  configDir?: string,
): SkillSnapshot {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return snapshot;
  }
  const bound = loadSkillExecutionBindingEntries({
    agentId: normalizedAgentId,
    respectRuntimeBindingPause: true,
    configDir,
  });
  const baseEntries = (snapshot.resolvedSkills ?? []).map((skill) => toSkillEntry(skill));
  const merged = mergeSkillEntriesWithBindings(baseEntries, bound);
  const resolvedSkills = merged.map((entry) => entry.skill);
  const prior = snapshot.resolvedSkills ?? [];
  if (
    bound.length === 0 &&
    prior.length === resolvedSkills.length &&
    prior.every((skill, index) => skill.name === resolvedSkills[index]?.name)
  ) {
    return snapshot;
  }
  return { ...snapshot, resolvedSkills };
}

function unwrapLoadedSkills(loaded: unknown): Skill[] {
  if (loaded && typeof loaded === "object" && "skills" in loaded) {
    const skills = (loaded as { skills?: unknown }).skills;
    if (Array.isArray(skills)) {
      return skills.filter(isSkillShape);
    }
  }
  if (Array.isArray(loaded)) {
    return loaded.filter(isSkillShape);
  }
  return [];
}

function isSkillShape(value: unknown): value is Skill {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  // pi-coding-agent 0.84+ replaced Skill.source with Skill.sourceInfo.
  // A stale `source: string` guard dropped every materialised lifecycle skill.
  const sourceInfo = record.sourceInfo;
  const hasSourceInfo =
    !!sourceInfo &&
    typeof sourceInfo === "object" &&
    typeof (sourceInfo as { source?: unknown }).source === "string";
  const hasLegacySource = typeof record.source === "string";
  return (
    typeof record.name === "string" &&
    typeof record.description === "string" &&
    typeof record.filePath === "string" &&
    typeof record.baseDir === "string" &&
    typeof record.disableModelInvocation === "boolean" &&
    (hasSourceInfo || hasLegacySource)
  );
}

/**
 * Governance pause: agent-runtime bindings with state disabled for this agent
 * map to lifecycle skill names via capabilityId → skillExecutionSkillName.
 */
function resolvePausedLifecycleSkillNames(agentId: string): Set<string> {
  try {
    const paused = listBindings({
      runtimeAgentId: agentId,
      capabilityId: null,
      bindingType: null,
      bindingState: "disabled",
      health: null,
    });
    return new Set(paused.map((b) => skillExecutionSkillName(b.capabilityId)));
  } catch {
    return new Set();
  }
}

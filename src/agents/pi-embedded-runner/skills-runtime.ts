import type { OpenBotConfig } from "../../config/config.js";
import {
  isLifecycleBindingSkillName,
  loadSkillExecutionBindingEntries,
  mergeSkillEntriesWithBindings,
} from "../../gateway/skill-execution-binding/index.js";
import { loadWorkspaceSkillEntries, type SkillEntry, type SkillSnapshot } from "../skills.js";
import { applySkillPolicyToEntries, skillPolicyFromSnapshot } from "../skills/skill-policy.js";

function toSkillEntry(skill: NonNullable<SkillSnapshot["resolvedSkills"]>[number]): SkillEntry {
  // Live snapshot skills do not carry frontmatter metadata. Never invent
  // `always: true` here — that over-ranks the entire catalog in the skills
  // prompt. Real `metadata.openclaw.always` is applied when loading workspace
  // SkillEntry rows (or when a future snapshot preserves metadata).
  return {
    skill,
    frontmatter: {},
    metadata: {
      skillKey: skill.name,
    },
  };
}

function loadLiveBindingEntries(agentId: string | undefined): SkillEntry[] {
  const normalized = agentId?.trim();
  if (!normalized) {
    return [];
  }
  return loadSkillExecutionBindingEntries({
    agentId: normalized,
    respectRuntimeBindingPause: true,
  });
}

export function resolveEmbeddedRunSkillEntries(params: {
  workspaceDir: string;
  config?: OpenBotConfig;
  skillsSnapshot?: SkillSnapshot;
  /**
   * Lifecycle skill projection (SkillExecutionBinding) is per-agent.
   * Bindings merge into the same embedded-runner SkillEntry[] — not a second execution chain.
   */
  agentId?: string;
}): {
  shouldLoadSkillEntries: boolean;
  skillEntries: SkillEntry[];
  preferLiveEntries: boolean;
} {
  const resolvedSkills = params.skillsSnapshot?.resolvedSkills;
  const preferLiveEntries = Boolean(params.agentId?.trim());
  const shouldLoadSkillEntries =
    preferLiveEntries || !params.skillsSnapshot || !params.skillsSnapshot.resolvedSkills;
  if (!shouldLoadSkillEntries) {
    return { shouldLoadSkillEntries, skillEntries: [], preferLiveEntries };
  }

  const policy = skillPolicyFromSnapshot(params.skillsSnapshot);
  let skillEntries: SkillEntry[];
  if (preferLiveEntries && resolvedSkills) {
    const base = resolvedSkills
      .filter((skill) => !isLifecycleBindingSkillName(skill.name))
      .map((skill) => toSkillEntry(skill));
    skillEntries = mergeSkillEntriesWithBindings(base, loadLiveBindingEntries(params.agentId));
  } else {
    const workspaceEntries = loadWorkspaceSkillEntries(params.workspaceDir, {
      config: params.config,
    });
    skillEntries = params.agentId?.trim()
      ? mergeSkillEntriesWithBindings(workspaceEntries, loadLiveBindingEntries(params.agentId))
      : workspaceEntries;
  }

  return {
    shouldLoadSkillEntries,
    preferLiveEntries,
    skillEntries: applySkillPolicyToEntries(skillEntries, policy),
  };
}

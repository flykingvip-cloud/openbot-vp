/**
 * Orchestration Plane — skill recipe binder (P4.5).
 *
 * Skill is a recipe (`skillId` on a seed step), not an agent. This helper maps
 * a skillId onto a Progress Ledger `SeedStepDraft` **without** loading
 * workspace files, hitting the network, or running install
 * (`loadWorkspaceSkillEntries` / `syncSkillsToWorkspace` stay unused).
 *
 * Skill expand is not Evidence. Tool results are. See ORCH8.
 */

import type { SeedStepDraft } from "../progress-ledger/types.js";
import { OrchestrationInvariantError } from "./errors.js";

export type SkillBoundStepDraft = {
  skillId: string;
  step: SeedStepDraft;
  readonly evidenceEligible: false;
  readonly skillIsRecipe: true;
};

export function bindSkillToStepDraft(input: {
  skillId: string;
  stepId?: string;
  title?: string;
}): SkillBoundStepDraft {
  const skillId = input.skillId.trim();
  if (!skillId) {
    throw new OrchestrationInvariantError("ORCH8", "skillId is required");
  }
  return {
    skillId,
    step: {
      id: input.stepId ?? `skill:${skillId}`,
      title: input.title ?? `Apply skill ${skillId}`,
    },
    evidenceEligible: false,
    skillIsRecipe: true,
  };
}

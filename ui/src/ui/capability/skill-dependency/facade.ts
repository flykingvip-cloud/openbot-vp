import {
  loadDependencyGraph,
  loadDependencySummary,
  type SkillDependencyState,
} from "../../controllers/skill-dependency.ts";

export type SkillDependencyCapabilityState = SkillDependencyState;

export const skillDependencyCapability = {
  loadSummary: loadDependencySummary,
  loadGraph: loadDependencyGraph,
} as const;

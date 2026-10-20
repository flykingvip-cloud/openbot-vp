import {
  filterBySource,
  loadRecommendations,
  type SkillRecommendationsState,
} from "../../controllers/skill-recommendations.ts";

export type SkillRecommendationsCapabilityState = SkillRecommendationsState;

export const skillRecommendationsCapability = {
  load: loadRecommendations,
  filterBySource,
} as const;

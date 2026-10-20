import {
  installRecommendation,
  loadRecommendations,
} from "../../controllers/capability-recommendation.ts";

export const capabilityRecommendationCapability = {
  load: loadRecommendations,
  install: installRecommendation,
} as const;

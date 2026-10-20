import {
  acceptClassificationSuggestion,
  dismissClassificationSuggestion,
  loadClassificationSuggestions,
  type SkillAutoClassifyState,
} from "../../controllers/skill-auto-classify.ts";

export type SkillAutoClassifyCapabilityState = SkillAutoClassifyState;

export const skillAutoClassifyCapability = {
  load: loadClassificationSuggestions,
  accept: acceptClassificationSuggestion,
  dismiss: dismissClassificationSuggestion,
} as const;

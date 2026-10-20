import {
  closeSaveModal,
  extractSkillContent,
  openSaveModal,
  saveSkill,
  type SkillLifecycleState,
} from "../../controllers/skill-lifecycle.ts";

export type SkillLifecycleCapabilityState = SkillLifecycleState;

export const skillLifecycleCapability = {
  extract: extractSkillContent,
  save: saveSkill,
  openModal: openSaveModal,
  closeModal: closeSaveModal,
} as const;

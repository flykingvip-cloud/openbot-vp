import {
  installSkill,
  loadSkills,
  saveSkillApiKey,
  updateSkillEdit,
  updateSkillEnabled,
  type SkillsState,
} from "../../controllers/skills.ts";

export type SkillsCapabilityLoadState = Pick<
  SkillsState,
  | "client"
  | "connected"
  | "skillsLoading"
  | "skillsReport"
  | "skillsError"
  | "skillsBusyKey"
  | "skillMessages"
>;

export type SkillsCapabilityManageState = Pick<
  SkillsState,
  | "client"
  | "connected"
  | "skillsLoading"
  | "skillsReport"
  | "skillsError"
  | "skillsBusyKey"
  | "skillEdits"
  | "skillMessages"
>;

export const skillsCapability = {
  load: (state: SkillsCapabilityLoadState, options?: { clearMessages?: boolean }) =>
    loadSkills(state as unknown as SkillsState, options),
  updateEnabled: (state: SkillsCapabilityManageState, skillKey: string, enabled: boolean) =>
    updateSkillEnabled(state as unknown as SkillsState, skillKey, enabled),
  updateEdit: (state: SkillsCapabilityManageState, skillKey: string, value: string) =>
    updateSkillEdit(state as unknown as SkillsState, skillKey, value),
  saveApiKey: (state: SkillsCapabilityManageState, skillKey: string) =>
    saveSkillApiKey(state as unknown as SkillsState, skillKey),
  install: (
    state: SkillsCapabilityManageState,
    skillKey: string,
    name: string,
    installId: string,
  ) => installSkill(state as unknown as SkillsState, skillKey, name, installId),
} as const;

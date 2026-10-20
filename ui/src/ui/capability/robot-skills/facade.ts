import {
  installSkillToRobot,
  loadRobotSkills,
  removeRobotSkill,
  toggleRobotSkillEnabled,
  upgradeRobotSkill,
  type RobotSkillsState,
} from "../../controllers/robot-skills.ts";

export type RobotSkillsCapabilityState = RobotSkillsState;

export const robotSkillsCapability = {
  load: loadRobotSkills,
  toggleEnabled: toggleRobotSkillEnabled,
  upgrade: upgradeRobotSkill,
  remove: removeRobotSkill,
  install: installSkillToRobot,
} as const;

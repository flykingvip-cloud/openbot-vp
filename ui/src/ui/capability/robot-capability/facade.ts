import {
  expandCapability,
  installSkillToRobot,
  loadRobotCapabilities,
  removeCapability,
  switchCapabilityVersion,
  toggleCapabilityEnabled,
  type RobotCapabilityState,
} from "../../controllers/robot-capability.ts";

export type RobotCapabilityCapabilityState = RobotCapabilityState;

export const robotCapabilityCapability = {
  load: loadRobotCapabilities,
  toggleEnabled: toggleCapabilityEnabled,
  switchVersion: switchCapabilityVersion,
  remove: removeCapability,
  install: installSkillToRobot,
  expand: expandCapability,
} as const;

import {
  createInitialCapabilityHealthLabelState,
  projectHealthStatusToLabel,
  subscribeHealthLabel,
  type CapabilityHealthLabelState,
  type RuntimeHealthStatus,
} from "../../controllers/capability-health-label.ts";

export const capabilityHealthLabelCapability = {
  createInitialState: createInitialCapabilityHealthLabelState,
  projectStatus: projectHealthStatusToLabel,
  subscribe: subscribeHealthLabel,
} as const;

export type { CapabilityHealthLabelState, RuntimeHealthStatus };

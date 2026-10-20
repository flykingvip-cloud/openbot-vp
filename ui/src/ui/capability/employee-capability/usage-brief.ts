import {
  createInitialCapabilityUsageBriefState,
  loadUsageBrief,
  requiresUsageBriefConfirmation,
  type CapabilityUsageBriefState,
} from "../../controllers/capability-usage-brief.ts";

export const capabilityUsageBriefCapability = {
  createInitialState: createInitialCapabilityUsageBriefState,
  load: loadUsageBrief,
  requiresConfirmation: requiresUsageBriefConfirmation,
} as const;

export type { CapabilityUsageBriefState };

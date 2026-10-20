import {
  loadRuntimeOverview,
  type RuntimeOverviewState,
} from "../../controllers/agent-runtime/runtime-overview.ts";

export type AgentRuntimeCapabilityOverviewState = RuntimeOverviewState;

export const agentRuntimeCapability = {
  loadOverview: loadRuntimeOverview,
} as const;

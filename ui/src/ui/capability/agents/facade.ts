import {
  loadAgents,
  loadToolsCatalog,
  saveAgentsConfig,
  type AgentsConfigSaveState,
  type AgentsState,
} from "../../controllers/agents.ts";

export type AgentsCapabilityLoadState = Pick<
  AgentsState,
  "client" | "connected" | "agentsLoading" | "agentsError" | "agentsList" | "agentsSelectedId"
>;

export type AgentsCapabilityToolsState = Pick<
  AgentsState,
  | "client"
  | "connected"
  | "agentsSelectedId"
  | "toolsCatalogLoading"
  | "toolsCatalogError"
  | "toolsCatalogResult"
>;

export type AgentsCapabilityConfigSaveState = AgentsConfigSaveState;

export const agentsCapability = {
  load: (state: AgentsCapabilityLoadState) => loadAgents(state as unknown as AgentsState),
  loadToolsCatalog: (state: AgentsCapabilityToolsState, agentId?: string | null) =>
    loadToolsCatalog(state as unknown as AgentsState, agentId),
  saveConfig: (state: AgentsCapabilityConfigSaveState) => saveAgentsConfig(state),
} as const;

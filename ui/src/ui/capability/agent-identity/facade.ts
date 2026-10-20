import {
  loadAgentIdentities,
  loadAgentIdentity,
  type AgentIdentityLoadState,
} from "../../controllers/agent-identity.ts";

export type AgentIdentityCapabilityLoadState = AgentIdentityLoadState;

export const agentIdentityCapability = {
  load: loadAgentIdentity,
  loadMany: loadAgentIdentities,
} as const;

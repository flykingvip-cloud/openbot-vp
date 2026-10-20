import { loadAgentSkills, type AgentSkillsLoadState } from "../../controllers/agent-skills.ts";

export type AgentSkillsCapabilityLoadState = AgentSkillsLoadState;

export const agentSkillsCapability = {
  load: loadAgentSkills,
} as const;

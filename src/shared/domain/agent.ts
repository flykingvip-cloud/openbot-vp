export type AgentOwnerType = "platform" | "tenant" | "position";

export type AgentStatus = "active" | "inactive";

export type Agent = {
  agentId: string;
  name: string;
  ownerType: AgentOwnerType;
  ownerId: string;
  templateId?: string;
  status: AgentStatus;
  createdAt: number;
};

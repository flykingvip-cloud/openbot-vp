export type AgentExecutionTrigger = {
  type: "user" | "group" | "system";
  id: string;
};

export type AgentExecutionStatus = "running" | "success" | "failed";

export type AgentExecution = {
  executionId: string;
  agentId: string;
  runtimeId: string;
  triggeredBy: AgentExecutionTrigger;
  status: AgentExecutionStatus;
  startedAt: number;
};

export type TenantUsage = {
  tenantId: string;
  period: string;
  tokens: number;
  cost: number;
};

export type RuntimeType = "instance" | "session";

export type RuntimeStatus = "running" | "failed" | "stopped";

export type Runtime = {
  runtimeId: string;
  type: RuntimeType;
  status: RuntimeStatus;
  region?: string;
  startedAt: number;
  tenantId?: string;
  agentId?: string;
};

export type RuntimeSession = {
  sessionId: string;
  runtimeId: string;
  agentId: string;
  active: boolean;
};

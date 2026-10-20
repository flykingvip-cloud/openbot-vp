export type SkillInvocationOutcome = "success" | "failure" | "cancelled";

export type SkillInvocationStartedEvent = {
  type: "skill_invocation_started";
  invocationId: string;
  skillId: string;
  skillVersion: string;
  agentId: string;
  tenantId: string | null;
  userId: string | null;
  startedAt: number;
  runId: string | null;
  sessionKey: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  attributionResolution?: string | null;
};

export type SkillInvocationCompletedEvent = {
  type: "skill_invocation_completed";
  invocationId: string;
  skillId: string;
  skillVersion: string;
  agentId: string;
  tenantId: string | null;
  userId: string | null;
  startedAt: number;
  completedAt: number;
  outcome: SkillInvocationOutcome;
  latencyMs: number;
  failureCategory: string | null;
  runId: string | null;
  sessionKey: string | null;
  /** Business outcome when known; null is allowed — never fabricate success. */
  businessOutcome: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  attributionResolution?: string | null;
  experimentId?: string | null;
  applicationId?: string | null;
  /** Task attribution. Never inferred from time proximity. */
  taskId?: string | null;
};

export type SkillInvocationEvent = SkillInvocationStartedEvent | SkillInvocationCompletedEvent;

export type RecordSkillInvocationCompletedInput = {
  invocationId?: string;
  skillId: string;
  skillVersion?: string;
  agentId: string;
  tenantId?: string | null;
  userId?: string | null;
  startedAt?: number;
  completedAt?: number;
  outcome: SkillInvocationOutcome;
  latencyMs?: number;
  failureCategory?: string | null;
  runId?: string | null;
  sessionKey?: string | null;
  businessOutcome?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  attributionResolution?: string | null;
  experimentId?: string | null;
  applicationId?: string | null;
  taskId?: string | null;
};

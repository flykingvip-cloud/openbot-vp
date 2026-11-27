/**
 * Owner-scoped scheduled task create.
 *
 * Employee and frontend agents call this instead of shelling out to `openbot cron`.
 * The job is the same Gateway cron record the client「定时任务」page writes:
 * isolated agentTurn, cron schedule, ownership stamped from the signed-in actor,
 * and delivery onto the current workbench conversation. `cron.list` (personal
 * scope) and `workbench.my-tasks.list` both read this store.
 *
 * The model cannot choose another agent, another conversation, or an owner.
 */
import { ToolAuthorizationError, ToolInputError } from "../agents/tools/common.js";
import {
  resolveEmployeeWorkbenchActor,
  type EmployeeWorkbenchActor,
} from "../gateway/employee-workbench-scope.js";
import { buildKnowledgeReplyGatewayClient } from "../gateway/knowledge/reply-gateway-client.js";
import { formatValidationErrors, validateCronAddParams } from "../gateway/protocol/index.js";
import type { GatewayClient } from "../gateway/server-methods/types.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  canonicalizeWorkbenchChatSessionKey,
  parseAgentSessionKey,
} from "../sessions/session-key-utils.js";
import { computeNextRunAtMs } from "./schedule.js";
import type { CronDeliverySurface, CronJob, CronJobCreate } from "./types.js";

export const DEFAULT_SCHEDULED_TASK_TIMEZONE = "Asia/Shanghai";
export const DEFAULT_SCHEDULED_TASK_DAILY_TIME = "08:00";

const OWNER_REQUIRED = "A signed-in owner session is required to create a scheduled task.";
const AGENT_FORBIDDEN = "not authorized to create a scheduled task for this agent";
const OTHER_AGENT = "not authorized to create a scheduled task for another agent";
const OTHER_CONVERSATION = "not authorized to create a scheduled task for another conversation";
const CONVERSATION_REQUIRED = "current conversation is required to create a scheduled task";
const SERVICE_UNAVAILABLE =
  "Gateway cron service is unavailable. Do not shell out to `openbot cron` and do not write HEARTBEAT.md. Call scheduled_task again when the Gateway scheduler is running.";

export type ScheduledTaskCronPort = {
  add: (job: CronJobCreate) => Promise<CronJob>;
  list?: (opts?: { includeDisabled?: boolean }) => Promise<CronJob[]>;
};

let scheduledTaskCronPort: ScheduledTaskCronPort | null = null;

/** Registered by the Gateway when its CronService starts. Tests may install a port. */
export function registerScheduledTaskCronPort(port: ScheduledTaskCronPort | null): void {
  scheduledTaskCronPort = port;
}

export function getScheduledTaskCronPort(): ScheduledTaskCronPort | null {
  return scheduledTaskCronPort;
}

export type OwnerScheduledTaskIdentity = {
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
};

export type CreateOwnerScheduledTaskParams = OwnerScheduledTaskIdentity & {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  name: string;
  message: string;
  /** `HH:mm` in `tz`. Used when `expr` is omitted. Default 08:00. */
  dailyTime?: string;
  /** 5-field (or croner-valid) expression. Wins over `dailyTime` when set. */
  expr?: string;
  /** IANA timezone. Default Asia/Shanghai. */
  tz?: string;
  /** Echo of the current agent. A different id is rejected. */
  requestedAgentId?: string;
  /** Echo of the current conversation. A different key is rejected. */
  requestedSessionKey?: string;
};

function assertIanaTimeZone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
  } catch {
    throw new ToolInputError(`timezone must be a valid IANA name (got ${tz})`);
  }
}

export function cronExprFromDailyTime(dailyTime: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(dailyTime.trim());
  if (!match) {
    throw new ToolInputError("dailyTime must be HH:mm between 00:00 and 23:59");
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    throw new ToolInputError("dailyTime must be HH:mm between 00:00 and 23:59");
  }
  return `${minute} ${hour} * * *`;
}

function resolveSchedule(params: CreateOwnerScheduledTaskParams): {
  expr: string;
  tz: string;
} {
  const tz = params.tz?.trim() || DEFAULT_SCHEDULED_TASK_TIMEZONE;
  assertIanaTimeZone(tz);
  const expr =
    params.expr?.trim() ||
    cronExprFromDailyTime(params.dailyTime?.trim() || DEFAULT_SCHEDULED_TASK_DAILY_TIME);
  if (!expr) {
    throw new ToolInputError("schedule expression is required");
  }
  const schedule = { kind: "cron" as const, expr, tz };
  try {
    const next = computeNextRunAtMs(schedule, Date.now());
    if (next === undefined) {
      throw new ToolInputError(`schedule expression is invalid: ${expr}`);
    }
  } catch (error) {
    if (error instanceof ToolInputError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ToolInputError(`schedule expression is invalid: ${message}`);
  }
  return { expr, tz };
}

function resolveTurnAgentId(params: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  requestedAgentId?: string;
}): string {
  const fromSession = parseAgentSessionKey(params.agentSessionKey)?.agentId ?? "";
  const override = params.requesterAgentIdOverride?.trim() ?? "";
  if (fromSession && override && normalizeAgentId(fromSession) !== normalizeAgentId(override)) {
    throw new ToolAuthorizationError(OTHER_AGENT);
  }
  const requested = params.requestedAgentId?.trim() ?? "";
  const agentId = fromSession || override;
  if (!agentId) {
    throw new ToolAuthorizationError(CONVERSATION_REQUIRED);
  }
  const canonical = normalizeAgentId(agentId);
  if (requested && normalizeAgentId(requested) !== canonical) {
    throw new ToolAuthorizationError(OTHER_AGENT);
  }
  return canonical;
}

function actorOwnsAgent(actor: EmployeeWorkbenchActor, agentId: string): boolean {
  const target = normalizeAgentId(agentId);
  return actor.seatAgentIds.some((id) => normalizeAgentId(id) === target);
}

function resolveConversation(params: { agentSessionKey?: string; requestedSessionKey?: string }): {
  sessionKey: string;
  surfaces: CronDeliverySurface[];
} {
  const raw = params.agentSessionKey?.trim() ?? "";
  if (!raw) {
    throw new ToolAuthorizationError(CONVERSATION_REQUIRED);
  }
  const sessionKey = canonicalizeWorkbenchChatSessionKey(raw);
  if (!sessionKey) {
    throw new ToolAuthorizationError(CONVERSATION_REQUIRED);
  }
  const requested = params.requestedSessionKey?.trim();
  if (requested) {
    const requestedCanonical = canonicalizeWorkbenchChatSessionKey(requested);
    if (requestedCanonical !== sessionKey) {
      throw new ToolAuthorizationError(OTHER_CONVERSATION);
    }
  }
  if (sessionKey.toLowerCase().startsWith("space:")) {
    return { sessionKey, surfaces: ["workbench-collab-group"] };
  }
  return { sessionKey, surfaces: ["workbench-agent-main"] };
}

/**
 * Create one cron job for the signed-in owner of the current agent conversation.
 * Refuses when the caller is not that owner, or when the Gateway cron service
 * is not registered.
 */
export async function createOwnerScheduledTask(
  params: CreateOwnerScheduledTaskParams,
): Promise<CronJob> {
  const name = params.name.trim();
  const message = params.message.trim();
  if (!name) {
    throw new ToolInputError("name required");
  }
  if (!message) {
    throw new ToolInputError("message required");
  }

  const client = buildKnowledgeReplyGatewayClient({
    gatewayClientUser: params.gatewayClientUser,
    gatewayClientSessionDomain: params.gatewayClientSessionDomain,
    gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
    gatewayClientSessionEnterpriseId: params.gatewayClientSessionEnterpriseId,
    gatewayClientSessionMembershipId: params.gatewayClientSessionMembershipId,
  });
  if (!client) {
    throw new ToolAuthorizationError(OWNER_REQUIRED);
  }
  const actor = await resolveEmployeeWorkbenchActor(client);
  const ownerId = actor?.userId?.trim() ?? "";
  if (!actor || !ownerId) {
    throw new ToolAuthorizationError(OWNER_REQUIRED);
  }

  const agentId = resolveTurnAgentId(params);
  if (!actorOwnsAgent(actor, agentId)) {
    throw new ToolAuthorizationError(AGENT_FORBIDDEN);
  }
  const conversation = resolveConversation(params);
  const schedule = resolveSchedule(params);
  const tenantId = actor.tenantId?.trim() || undefined;

  const jobParams = {
    name,
    description: message,
    agentId,
    sessionKey: conversation.sessionKey,
    enabled: true,
    schedule: { kind: "cron" as const, expr: schedule.expr, tz: schedule.tz },
    sessionTarget: "isolated" as const,
    wakeMode: "now" as const,
    payload: { kind: "agentTurn" as const, message },
    delivery: { mode: "none" as const, surfaces: conversation.surfaces },
  };
  if (!validateCronAddParams(jobParams)) {
    throw new ToolInputError(
      `invalid scheduled task: ${formatValidationErrors(validateCronAddParams.errors)}`,
    );
  }

  const port = scheduledTaskCronPort;
  if (!port) {
    throw new ToolInputError(SERVICE_UNAVAILABLE);
  }

  const jobCreate: CronJobCreate = {
    ...jobParams,
    ownership: {
      ownerId,
      ...(tenantId ? { tenantId } : {}),
    },
  };
  return await port.add(jobCreate);
}

/**
 * List cron jobs owned by the signed-in caller (read-only).
 * Never returns jobs owned by other users or tenants.
 */
export async function listOwnerScheduledTasks(
  params: OwnerScheduledTaskIdentity & {
    includeDisabled?: boolean;
    agentId?: string;
  },
): Promise<CronJob[]> {
  const client = buildKnowledgeReplyGatewayClient({
    gatewayClientUser: params.gatewayClientUser,
    gatewayClientSessionDomain: params.gatewayClientSessionDomain,
    gatewayClientPlatformUserId: params.gatewayClientPlatformUserId,
    gatewayClientSessionEnterpriseId: params.gatewayClientSessionEnterpriseId,
    gatewayClientSessionMembershipId: params.gatewayClientSessionMembershipId,
  });
  if (!client) {
    throw new ToolAuthorizationError(OWNER_REQUIRED);
  }
  const actor = await resolveEmployeeWorkbenchActor(client);
  const ownerId = actor?.userId?.trim() ?? "";
  if (!actor || !ownerId) {
    throw new ToolAuthorizationError(OWNER_REQUIRED);
  }
  const port = scheduledTaskCronPort;
  if (!port || typeof port.list !== "function") {
    throw new ToolInputError(SERVICE_UNAVAILABLE);
  }
  const tenantId = actor.tenantId?.trim() || undefined;
  const filterAgentId = params.agentId?.trim() ? normalizeAgentId(params.agentId) : undefined;
  const jobs = await port.list({ includeDisabled: params.includeDisabled ?? true });
  return jobs.filter((job) => {
    const jobOwner = job.ownership?.ownerId?.trim();
    if (jobOwner !== ownerId) {
      return false;
    }
    if (tenantId && job.ownership?.tenantId && job.ownership.tenantId.trim() !== tenantId) {
      return false;
    }
    if (filterAgentId && normalizeAgentId(job.agentId ?? "") !== filterAgentId) {
      return false;
    }
    return true;
  });
}

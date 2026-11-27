import { Type } from "@sinclair/typebox";
import {
  createOwnerScheduledTask,
  DEFAULT_SCHEDULED_TASK_DAILY_TIME,
  DEFAULT_SCHEDULED_TASK_TIMEZONE,
  listOwnerScheduledTasks,
} from "../../cron/owner-scheduled-task.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";
import type { AnyAgentTool } from "./common.js";

/**
 * Agent tool for system scheduled tasks (client「我的任务 → 定时任务」 / `cron.add`).
 *
 * Contract:
 * - action `add` (alias `create`)
 * - `name` + `message` required. `message` is the isolated agentTurn prompt.
 * - `dailyTime` `HH:mm` (default 08:00) when `expr` is omitted.
 * - `expr` optional cron expression; when set it replaces `dailyTime`.
 * - `tz` IANA timezone, default Asia/Shanghai.
 * - `agentId` / `sessionKey`, if sent, must match this turn. Ownership is never
 *   taken from arguments. Delivery is the current conversation.
 * - Writes the Gateway cron store. Do not run `openbot cron` and do not use
 *   HEARTBEAT.md for an exact schedule.
 */
const ScheduledTaskToolSchema = Type.Object({
  action: Type.String({
    description: "list (read-only) or add (create is accepted as an alias).",
  }),
  includeDisabled: Type.Optional(
    Type.Boolean({ description: "For action=list: include disabled jobs (default true)." }),
  ),
  name: Type.Optional(Type.String({ description: "Task name shown in 我的任务." })),
  message: Type.Optional(
    Type.String({ description: "Prompt the scheduled run executes and delivers back." }),
  ),
  dailyTime: Type.Optional(
    Type.String({
      description: `Local HH:mm. Default ${DEFAULT_SCHEDULED_TASK_DAILY_TIME} when expr is omitted.`,
    }),
  ),
  expr: Type.Optional(
    Type.String({ description: "Cron expression. When set, used instead of dailyTime." }),
  ),
  tz: Type.Optional(
    Type.String({
      description: `IANA timezone. Default ${DEFAULT_SCHEDULED_TASK_TIMEZONE}.`,
    }),
  ),
  agentId: Type.Optional(
    Type.String({
      description: "Must match the current agent. Ignored when equal; rejected otherwise.",
    }),
  ),
  sessionKey: Type.Optional(
    Type.String({
      description: "Must match the current conversation. Ignored when equal; rejected otherwise.",
    }),
  ),
});

function normalizeAction(raw: string): "add" | "list" {
  const action = raw.trim().toLowerCase();
  if (action === "list") {
    return "list";
  }
  if (action === "add" || action === "create") {
    return "add";
  }
  throw new ToolInputError("action must be list or add");
}

export function createScheduledTaskTool(options?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
}): AnyAgentTool {
  return {
    name: "scheduled_task",
    label: "Scheduled Task",
    description: `List or create system scheduled tasks in 我的任务 (the same Gateway cron store as the client 定时任务 page and openbot cron). Use this tool instead of running \`openbot cron\` in the shell and instead of writing HEARTBEAT.md. action=list reads your own scheduled tasks. action=add requires name and message. dailyTime defaults to ${DEFAULT_SCHEDULED_TASK_DAILY_TIME} and tz defaults to ${DEFAULT_SCHEDULED_TASK_TIMEZONE}. The job runs as an isolated agent turn and delivers the result to the current conversation. Only the signed-in owner of this agent can call it.`,
    parameters: ScheduledTaskToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = normalizeAction(readStringParam(params, "action", { required: true }));
      if (action === "list") {
        const jobs = await listOwnerScheduledTasks({
          gatewayClientUser: options?.gatewayClientUser,
          gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
          gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
          gatewayClientSessionEnterpriseId: options?.gatewayClientSessionEnterpriseId,
          gatewayClientSessionMembershipId: options?.gatewayClientSessionMembershipId,
          includeDisabled:
            typeof params.includeDisabled === "boolean" ? params.includeDisabled : undefined,
          agentId: readStringParam(params, "agentId"),
        });
        return jsonResult({
          ok: true,
          action: "list",
          count: jobs.length,
          jobs: jobs.map((job) => ({
            id: job.id,
            name: job.name,
            enabled: job.enabled,
            agentId: job.agentId,
            sessionKey: job.sessionKey,
            schedule: job.schedule,
            state: job.state,
          })),
        });
      }
      const job = await createOwnerScheduledTask({
        agentSessionKey: options?.agentSessionKey,
        requesterAgentIdOverride: options?.requesterAgentIdOverride,
        gatewayClientUser: options?.gatewayClientUser,
        gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
        gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
        gatewayClientSessionEnterpriseId: options?.gatewayClientSessionEnterpriseId,
        gatewayClientSessionMembershipId: options?.gatewayClientSessionMembershipId,
        name: readStringParam(params, "name", { required: true }),
        message: readStringParam(params, "message", { required: true }),
        dailyTime: readStringParam(params, "dailyTime"),
        expr: readStringParam(params, "expr"),
        tz: readStringParam(params, "tz"),
        requestedAgentId: readStringParam(params, "agentId"),
        requestedSessionKey: readStringParam(params, "sessionKey"),
      });
      return jsonResult({
        ok: true,
        action: "add",
        job: {
          id: job.id,
          name: job.name,
          enabled: job.enabled,
          agentId: job.agentId,
          sessionKey: job.sessionKey,
          schedule: job.schedule,
          sessionTarget: job.sessionTarget,
          wakeMode: job.wakeMode,
          payload: job.payload,
          delivery: job.delivery,
          ownership: job.ownership,
          nextRunAtMs: job.state.nextRunAtMs,
        },
      });
    },
  };
}

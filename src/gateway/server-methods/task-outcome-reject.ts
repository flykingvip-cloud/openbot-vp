/**
 * Result-card action: 「结果不符合要求」.
 * The client must name taskId + outcomeVersion. Naming the task is not ownership.
 */
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { rejectTaskOutcomeResult } from "../../task-outcome/reject-result.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveAuthoritativeMembership } from "../tenant-context.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

export const TASK_OUTCOME_REJECT_RESULT_METHOD = "task.outcome.rejectResult" as const;

/** Operator scopes do not grant this method. A platform user id only opens the handler. */
export function authorizeTaskOutcomeRejectTransport(
  client: GatewayClient | null,
): ReturnType<typeof errorShape> | null {
  if (!client?.platformUserId?.trim()) {
    return errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized");
  }
  return null;
}

export type TaskOutcomeRejectCaller = {
  subjectRaw: string;
  tenantId: string | null;
};

async function defaultResolveCaller(
  client: GatewayClient | null,
): Promise<TaskOutcomeRejectCaller> {
  let tenantId: string | null = null;
  try {
    tenantId = (await resolveAuthoritativeMembership(client)).tenantId;
  } catch {
    tenantId = null;
  }
  return {
    // Same field chat entry prefers: authenticated platform user id.
    // client.user (often an email) and request body strings are not this identity.
    subjectRaw: client?.platformUserId?.trim() || "",
    tenantId,
  };
}

function readPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

export function createTaskOutcomeRejectHandlers(
  options: {
    cfg?: OpenBotConfig;
    resolveCaller?: (client: GatewayClient | null) => Promise<TaskOutcomeRejectCaller>;
  } = {},
): GatewayRequestHandlers {
  const resolveCaller = options.resolveCaller ?? defaultResolveCaller;
  return {
    [TASK_OUTCOME_REJECT_RESULT_METHOD]: async ({ params, client, respond }) => {
      const caller = await resolveCaller(client);
      if (!caller.subjectRaw.trim()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const taskId = typeof record.taskId === "string" ? record.taskId : "";
      const agentId = typeof record.agentId === "string" ? record.agentId : "";
      const outcomeVersion = readPositiveInt(record.outcomeVersion);
      const commandId = typeof record.commandId === "string" ? record.commandId : undefined;
      if (!taskId.trim() || !agentId.trim() || outcomeVersion == null) {
        respond(true, { ok: false, code: "task_ref_incomplete" });
        return;
      }
      let cfg = options.cfg;
      if (!cfg) {
        try {
          cfg = loadConfig();
        } catch {
          respond(true, { ok: false, code: "read_failed" });
          return;
        }
      }
      const result = rejectTaskOutcomeResult({
        cfg,
        agentId,
        taskId,
        outcomeVersion,
        callerSubjectRaw: caller.subjectRaw,
        callerTenantId: caller.tenantId,
        commandId,
      });
      respond(true, result);
    },
  };
}

export const taskOutcomeRejectHandlers: GatewayRequestHandlers = createTaskOutcomeRejectHandlers();

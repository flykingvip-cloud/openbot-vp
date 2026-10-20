import { Type } from "@sinclair/typebox";
import { resolveEmployeeWorkbenchActor } from "../../gateway/employee-workbench-scope.js";
import { buildKnowledgeReplyGatewayClient } from "../../gateway/knowledge/reply-gateway-client.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import { broadcastWorkbenchSignalsInvalidate } from "../../gateway/workbench/signals-invalidate.js";
import {
  buildManualScheduleEntry,
  cancelScheduleEntry,
  readUserScheduleEntries,
  upsertScheduleEntry,
} from "../../organization/schedule-store.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";
import type { AnyAgentTool } from "./common.js";

/**
 * Steward (大白) schedule tool (Phase A1, 场景 1). Lets the agent deterministically
 * record a dated entry the user described in conversation: the model parses the
 * natural-language time into an ISO datetime and calls `add`; the tool stamps the
 * owner/tenant from the resolved employee actor (never the model) and writes the
 * SAME per-user store the `schedule.entry.*` RPCs use. Entries then surface on the
 * employee home Today schedule card.
 *
 * Scope is the signed-in employee session (resolved from the gateway client
 * user/domain); without one the tool refuses — it never writes to an unscoped or
 * another user's schedule. NL parsing stays in the model turn (deterministic
 * write only here); richer extraction is deferred to Phase C.
 */

const ScheduleToolSchema = Type.Object({
  action: Type.String({ description: "One of: list, add, cancel." }),
  title: Type.Optional(Type.String({ description: "Schedule title (required for add)." })),
  startAt: Type.Optional(
    Type.String({
      description: "ISO 8601 start datetime (required for add), e.g. 2026-07-01T15:00:00+08:00.",
    }),
  ),
  endAt: Type.Optional(Type.String({ description: "ISO 8601 end datetime (optional)." })),
  timezone: Type.Optional(Type.String({ description: "IANA timezone label (default UTC)." })),
  kind: Type.Optional(Type.String({ description: "personal or reminder (default personal)." })),
  id: Type.Optional(
    Type.String({ description: "Entry id: required for cancel; optional update key for add." }),
  ),
});

function normalizeAction(raw: string): "list" | "add" | "cancel" {
  const action = raw.trim().toLowerCase();
  if (action === "list" || action === "add" || action === "cancel") {
    return action;
  }
  throw new ToolInputError("action must be one of: list, add, cancel");
}

function parseIsoToMs(value: string, label: string): number {
  const ms = Date.parse(value.trim());
  if (!Number.isFinite(ms)) {
    throw new ToolInputError(`${label} must be a valid ISO 8601 datetime`);
  }
  return ms;
}

export function createScheduleTool(options?: {
  gatewayClientUser?: string;
  gatewayClientSessionDomain?: GatewayClient["sessionDomain"];
  gatewayClientPlatformUserId?: string;
  gatewayClientSessionEnterpriseId?: string;
  gatewayClientSessionMembershipId?: string;
}): AnyAgentTool {
  return {
    name: "schedule",
    label: "Schedule",
    description:
      "Manage the signed-in user's deterministic schedule (steward). Before add: echo title+time and wait for explicit user confirmation. Prefer the Daibai confirmation card (schedule.entry.add) when the UI surfaces it; only call add after the user confirms. Use cancel by id and list for upcoming entries. Entries surface on the employee home Today schedule card.",
    parameters: ScheduleToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = normalizeAction(readStringParam(params, "action", { required: true }));
      const client = buildKnowledgeReplyGatewayClient({
        gatewayClientUser: options?.gatewayClientUser,
        gatewayClientSessionDomain: options?.gatewayClientSessionDomain,
        gatewayClientPlatformUserId: options?.gatewayClientPlatformUserId,
        gatewayClientSessionEnterpriseId: options?.gatewayClientSessionEnterpriseId,
        gatewayClientSessionMembershipId: options?.gatewayClientSessionMembershipId,
      });
      const actor = client ? await resolveEmployeeWorkbenchActor(client) : null;
      if (!actor) {
        throw new ToolInputError(
          "A signed-in employee session is required to manage schedule entries.",
        );
      }

      if (action === "list") {
        const entries = (await readUserScheduleEntries(actor.userId)).filter(
          (entry) => entry.status !== "cancelled",
        );
        return jsonResult({ ok: true, action, entries });
      }

      if (action === "add") {
        const title = readStringParam(params, "title", { required: true });
        const startAtMs = parseIsoToMs(
          readStringParam(params, "startAt", { required: true }),
          "startAt",
        );
        const endAtRaw = readStringParam(params, "endAt");
        let endAtMs: number | undefined;
        if (endAtRaw) {
          endAtMs = parseIsoToMs(endAtRaw, "endAt");
          if (endAtMs < startAtMs) {
            throw new ToolInputError("endAt must be the same as or after startAt");
          }
        }
        const timezone = readStringParam(params, "timezone");
        const kind = readStringParam(params, "kind");
        const entry = await upsertScheduleEntry(
          buildManualScheduleEntry({
            id: readStringParam(params, "id") ?? "",
            // Owner/tenant come from the resolved actor, never the model args.
            ownerUserId: actor.userId,
            ...(actor.tenantId !== undefined ? { tenantId: actor.tenantId } : {}),
            title,
            startAtMs,
            ...(endAtMs !== undefined ? { endAtMs } : {}),
            ...(timezone !== undefined ? { timezone } : {}),
            ...(kind !== undefined ? { kind } : {}),
          }),
        );
        broadcastWorkbenchSignalsInvalidate({
          reason: "schedule",
          userIds: [actor.userId],
        });
        return jsonResult({ ok: true, action, entry });
      }

      const id = readStringParam(params, "id", { required: true });
      const entry = await cancelScheduleEntry({ userId: actor.userId, id });
      if (entry) {
        broadcastWorkbenchSignalsInvalidate({
          reason: "schedule",
          userIds: [actor.userId],
        });
      }
      return jsonResult({ ok: true, action, cancelled: Boolean(entry), entry: entry ?? null });
    },
  };
}

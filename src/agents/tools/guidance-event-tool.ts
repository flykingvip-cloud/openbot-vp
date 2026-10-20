import { Type } from "@sinclair/typebox";
import {
  GUIDANCE_CONFIDENCE,
  GUIDANCE_EVENTS,
  parseGuidanceEventInput,
  toGuidanceSessionEvent,
  type GuidanceEventInput,
} from "../../gateway/agent-growth/guidance-event.js";
import { appendSessionEvent } from "../../gateway/asset-incubation-session-store.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";

const GuidanceEventToolSchema = Type.Object({
  event: stringEnum(GUIDANCE_EVENTS),
  scenario: Type.String({
    description: "Scenario id from skill references (e.g. wechat_oa_setup).",
  }),
  contextConfidence: stringEnum(GUIDANCE_CONFIDENCE),
  stepId: Type.Optional(
    Type.String({
      description: "Required for guidance_step_failed — YAML step id.",
    }),
  ),
  failureReason: Type.Optional(
    Type.String({
      description: "Required for guidance_step_failed. Never include secrets.",
    }),
  ),
  issueClass: Type.Optional(Type.String()),
  userAction: Type.Optional(Type.String()),
  stepsCompleted: Type.Optional(Type.Number()),
  exceptions: Type.Optional(Type.Number()),
  reusablePattern: Type.Optional(Type.Boolean()),
});

function resolveOwnerKey(user?: string | null): string {
  const trimmed = user?.trim().toLowerCase();
  return trimmed || "local";
}

/**
 * Persist a user-guidance-protocol lifecycle event into asset incubation.
 * Prefer this over inventing gateway.RPC calls — agents cannot call arbitrary RPCs.
 */
export function createGuidanceEventTool(options?: {
  agentSessionKey?: string;
  gatewayClientUser?: string;
}): AnyAgentTool {
  return {
    name: "guidance_event",
    label: "Guidance Event",
    description:
      "Record a user-guidance-protocol lifecycle event (guidance_completed / guidance_step_failed / guidance_abandoned) for asset incubation and SOP reuse. Call when a guided multi-step UI flow finishes, fails at a step, or the user abandons. Never put AppSecret/API keys into failureReason or userAction.",
    parameters: GuidanceEventToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const payload: Record<string, unknown> = {
        event: readStringParam(params, "event", { required: true }),
        scenario: readStringParam(params, "scenario", { required: true }),
        contextConfidence: readStringParam(params, "contextConfidence", { required: true }),
      };
      if (typeof params.stepId === "string") {
        payload.stepId = params.stepId;
      }
      if (typeof params.failureReason === "string") {
        payload.failureReason = params.failureReason;
      }
      if (typeof params.issueClass === "string") {
        payload.issueClass = params.issueClass;
      }
      if (typeof params.userAction === "string") {
        payload.userAction = params.userAction;
      }
      if (typeof params.stepsCompleted === "number") {
        payload.stepsCompleted = params.stepsCompleted;
      }
      if (typeof params.exceptions === "number") {
        payload.exceptions = params.exceptions;
      }
      if (typeof params.reusablePattern === "boolean") {
        payload.reusablePattern = params.reusablePattern;
      }

      const parsed = parseGuidanceEventInput(payload);
      if (!parsed) {
        throw new ToolInputError(
          "Invalid guidance event: need event + scenario + contextConfidence; step failures also need stepId + failureReason",
        );
      }
      const input: GuidanceEventInput = {
        ...parsed,
        sessionKey: options?.agentSessionKey ?? parsed.sessionKey,
      };
      const ownerKey = resolveOwnerKey(options?.gatewayClientUser ?? input.ownerKey);
      const record = toGuidanceSessionEvent(input, ownerKey);
      const events = appendSessionEvent(record);
      return jsonResult({
        ok: true,
        record: {
          id: record.id,
          clusterId: record.clusterId,
          intentKey: record.intentKey,
          label: record.label,
          suggestedAssetType: record.suggestedAssetType,
        },
        count: events.length,
      });
    },
  };
}

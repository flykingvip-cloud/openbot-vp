import crypto from "node:crypto";
import { buildExecutionPreflight } from "../agents/execution-preflight/resolve.js";
import { AGENT_LANE_NESTED } from "../agents/lanes.js";
import { callGateway } from "../gateway/call.js";
import { recordBypassEntryShadow } from "../gateway/governance/bypass-entry-shadow.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { logWarn } from "../logger.js";
import { toOrganizationAgentSessionKey } from "../sessions/session-key-utils.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import type { MentionContext, MentionMetadata } from "./mention-types.js";
import type { TaskAssignment } from "./task-assignment.js";

/**
 * Observe-only. Unset/off keeps inter-agent dispatch on today's gateway path.
 * Truthy values match isTruthyEnvValue (1, true, yes, on).
 */
export const INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV = "OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE";

export type InterAgentBusDispatchKind = "task" | "mention";

export function isInterAgentBusPreflightObserveEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isTruthyEnvValue(env[INTER_AGENT_BUS_PREFLIGHT_OBSERVE_ENV]);
}

/** Process-local trace key. Not a completion, ledger, or authorization id. */
export function interAgentBusObserveTaskId(
  kind: InterAgentBusDispatchKind,
  targetSessionKey: string,
): string {
  return `inter-agent-bus:${kind}:${targetSessionKey}`;
}

function interAgentBusObserveSourceTool(kind: InterAgentBusDispatchKind): string {
  return kind === "task" ? "organization_tasks" : "organization_mentions";
}

function observeInterAgentBusPreflight(params: {
  kind: InterAgentBusDispatchKind;
  targetSessionKey: string;
  lane: string;
}): void {
  void recordBypassEntryShadow({
    entry: "inter-agent-identity",
    reason: "bypass-shadow",
    executionId: params.targetSessionKey,
  });
  if (!isInterAgentBusPreflightObserveEnabled()) {
    return;
  }
  try {
    const sourceTool = interAgentBusObserveSourceTool(params.kind);
    // Record the existing preflight trace only. The returned tool set is unused.
    // This bus does not execute tools; kind, lane, and source are observe labels.
    buildExecutionPreflight({
      taskId: interAgentBusObserveTaskId(params.kind, params.targetSessionKey),
      sessionId: params.targetSessionKey,
      message: `${params.kind} lane=${params.lane} source=${sourceTool}`,
      skills: [],
      policyToolNames: [],
      catalogToolNames: [],
      resourceScope: [`kind:${params.kind}`, `lane:${params.lane}`, `source:${sourceTool}`],
    });
  } catch (err) {
    logWarn(`inter-agent-bus: observe preflight failed: ${String(err)}`);
  }
}

export type AgentTaskDeliveryResult = {
  status: "accepted" | "error" | "skipped";
  targetSessionKey?: string;
  runId?: string;
  error?: string;
};

/** Per-bot organization inbox. Must not reuse `:space:` (that is the group store). */
export function buildOrganizationAgentSessionKey(params: {
  agentId: string;
  organizationId: string;
}): string {
  return toOrganizationAgentSessionKey(params);
}

export function buildTaskAssignmentMessage(assignment: TaskAssignment): string {
  return [
    "Organization task assignment:",
    `Task ID: ${assignment.id}`,
    `Title: ${assignment.title}`,
    `Owner Agent ID: ${assignment.ownerAgentId}`,
    `Created By: ${assignment.createdByAgentId}`,
    `Organization ID: ${assignment.organizationId}`,
    `Status: ${assignment.status}`,
    assignment.notes ? `Notes: ${assignment.notes}` : undefined,
    "",
    'Acknowledge this task with organization_tasks(action="accept", taskId="<Task ID>").',
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildMentionMessage(params: {
  messageId: string;
  messageText: string;
  mentions: MentionMetadata[];
  mentionContext: MentionContext;
  sourceAgentId: string;
  organizationId: string;
}): string {
  return [
    "Organization mention:",
    `Message ID: ${params.messageId}`,
    `Source Agent ID: ${params.sourceAgentId}`,
    `Organization ID: ${params.organizationId}`,
    `Mention Type: ${params.mentionContext.mentionType}`,
    `Mention IDs: ${params.mentionContext.mentionIds.join(", ")}`,
    "",
    "Message:",
    params.messageText,
  ].join("\n");
}

export async function sendAgentTask(params: {
  assignment: TaskAssignment;
  sourceSessionKey?: string;
  sourceAgentId: string;
  timeoutMs?: number;
}): Promise<AgentTaskDeliveryResult> {
  const targetSessionKey = buildOrganizationAgentSessionKey({
    agentId: params.assignment.ownerAgentId,
    organizationId: params.assignment.organizationId,
  });
  try {
    observeInterAgentBusPreflight({
      kind: "task",
      targetSessionKey,
      lane: AGENT_LANE_NESTED,
    });
    const response = await callGateway<{ runId?: string }>({
      method: "agent",
      params: {
        message: buildTaskAssignmentMessage(params.assignment),
        sessionKey: targetSessionKey,
        idempotencyKey: crypto.randomUUID(),
        deliver: false,
        channel: INTERNAL_MESSAGE_CHANNEL,
        lane: AGENT_LANE_NESTED,
        inputProvenance: {
          kind: "inter_session",
          sourceSessionKey: params.sourceSessionKey,
          sourceTool: "organization_tasks",
        },
      },
      timeoutMs: params.timeoutMs ?? 10_000,
    });
    return {
      status: "accepted",
      targetSessionKey,
      ...(response?.runId ? { runId: response.runId } : {}),
    };
  } catch (err) {
    return {
      status: "error",
      targetSessionKey,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function sendAgentMention(params: {
  messageId: string;
  messageText: string;
  mentions: MentionMetadata[];
  mentionContext: MentionContext;
  sourceSessionKey?: string;
  sourceAgentId: string;
  targetAgentId: string;
  organizationId: string;
  timeoutMs?: number;
}): Promise<AgentTaskDeliveryResult> {
  const targetSessionKey = buildOrganizationAgentSessionKey({
    agentId: params.targetAgentId,
    organizationId: params.organizationId,
  });
  try {
    observeInterAgentBusPreflight({
      kind: "mention",
      targetSessionKey,
      lane: AGENT_LANE_NESTED,
    });
    const response = await callGateway<{ runId?: string }>({
      method: "agent",
      params: {
        message: buildMentionMessage(params),
        sessionKey: targetSessionKey,
        idempotencyKey: crypto.randomUUID(),
        deliver: false,
        channel: INTERNAL_MESSAGE_CHANNEL,
        lane: AGENT_LANE_NESTED,
        inputProvenance: {
          kind: "inter_session",
          sourceSessionKey: params.sourceSessionKey,
          sourceTool: "organization_mentions",
        },
      },
      timeoutMs: params.timeoutMs ?? 10_000,
    });
    return {
      status: "accepted",
      targetSessionKey,
      ...(response?.runId ? { runId: response.runId } : {}),
    };
  } catch (err) {
    return {
      status: "error",
      targetSessionKey,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

import { createHash } from "node:crypto";
import { emitAgentEvent } from "../infra/agent-events.js";
import { maybeHarvestChatInboundStage } from "./chat-inbound-depth-harvest.js";
import { listEnabledChatInboundFlags } from "./chat-inbound-flags.js";
import { observeChatInboundStage } from "./execution-router-observation.js";

export type ChatInboundStage =
  | "user_persisted"
  | "user_persist_error"
  | "dispatch_started"
  | "depth_decided"
  | "knowledge_started"
  | "knowledge_finished"
  | "knowledge_degraded"
  | "gate_started"
  | "gate_finished"
  | "model_started"
  | "first_token"
  | "model_finished"
  | "assistant_persisted"
  | "tool_policy_applied"
  | "tool_rejected"
  | "context_compiled"
  | "context_provider_boundary";

export function hashChatSessionKey(sessionKey: string): string {
  return createHash("sha256").update(sessionKey).digest("hex").slice(0, 16);
}

const FORBIDDEN_EXTRA_KEYS = new Set([
  "text",
  "body",
  "content",
  "prompt",
  "message",
  "attachment",
  "attachments",
  "token",
  "secret",
  "password",
  "apikey",
]);

function assertNoSensitiveFields(extra: Record<string, unknown>): void {
  for (const key of Object.keys(extra)) {
    if (FORBIDDEN_EXTRA_KEYS.has(key.toLowerCase())) {
      throw new Error(`chat inbound stage extra forbids field "${key}"`);
    }
  }
}

export function emitChatInboundStage(params: {
  runId: string;
  stage: ChatInboundStage;
  sessionKey?: string;
  extra?: Record<string, unknown>;
}): void {
  try {
    const extra = params.extra ?? {};
    assertNoSensitiveFields(extra);
    emitAgentEvent({
      runId: params.runId,
      stream: "lifecycle",
      sessionKey: params.sessionKey,
      data: {
        event: `chat.${params.stage}`,
        sessionKeyHash: params.sessionKey ? hashChatSessionKey(params.sessionKey) : undefined,
        flags: listEnabledChatInboundFlags(),
        ...extra,
      },
    });
    observeChatInboundStage({
      runId: params.runId,
      stage: params.stage,
      sessionKey: params.sessionKey,
      extra,
    });
    maybeHarvestChatInboundStage({
      runId: params.runId,
      stage: params.stage,
      sessionKey: params.sessionKey,
      extra,
    });
  } catch {
    // Stage events must never break chat.send.
  }
}

import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { newFencingToken, TaskOutcomeResultService } from "./result-service.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TaskOutcomeRecord, TrustedScope } from "./types.js";

export type ChatEntryIdentity = {
  agentId: string;
  runId: string;
  sessionKey?: string;
  /** Platform / gateway subject — required for personal scope authenticity. */
  subjectRef: string;
  tenantId?: string;
  authzScopeRef?: string;
  taskContractVersion?: string;
};

export function chatTurnTaskId(params: {
  agentId: string;
  runId: string;
  sessionKey?: string;
}): string {
  const session = params.sessionKey?.trim();
  if (session) {
    return `chat:${params.agentId}:${session}:${params.runId}`;
  }
  return `chat:${params.agentId}:${params.runId}`;
}

export function scopeFromChatEntry(identity: ChatEntryIdentity): TrustedScope {
  const subject = identity.subjectRef.trim() || "anonymous";
  const authz = identity.authzScopeRef?.trim() || "chat-entry";
  const tid = identity.tenantId?.trim();
  if (tid) {
    return {
      kind: "enterprise",
      enterpriseDomainId: `enterprise:${tid}`,
      tenantId: tid,
      subjectRef: subject,
      authzScopeRef: authz,
    };
  }
  return {
    kind: "personal",
    personalDomainId: `personal:${subject}`,
    subjectRef: subject,
    authzScopeRef: authz,
  };
}

/**
 * Entry-time create/restore for a chat turn. Call before the agent run starts.
 * Returns durable taskId + fencing for later attempt/acceptance/delivery writes.
 */
export function ensureChatTurnTaskOutcome(
  cfg: OpenBotConfig,
  identity: ChatEntryIdentity,
):
  | {
      ok: true;
      taskId: string;
      scope: TrustedScope;
      fencingToken: string;
      record: TaskOutcomeRecord;
    }
  | {
      ok: false;
      code: string;
      message: string;
    } {
  const taskId = chatTurnTaskId(identity);
  const scope = scopeFromChatEntry(identity);
  const root = path.join(resolveAgentDir(cfg, identity.agentId), TASK_OUTCOME_STORE_DIRNAME);
  const store = new DurableTaskOutcomeStore(root);
  const service = new TaskOutcomeResultService({
    store,
    submittedBy: "chat-entry",
  });
  const chat = new ChatTaskOutcomeAdapter(service);
  const opened = chat.createOrRestore({
    taskId,
    scope,
    taskContractVersion: identity.taskContractVersion ?? "1.0.0",
    commandId: `entry:${taskId}`,
  });
  if (!opened.ok) {
    return {
      ok: false,
      code: opened.code,
      message: opened.message,
    };
  }
  return {
    ok: true,
    taskId,
    scope,
    fencingToken: opened.fencingToken || newFencingToken(),
    record: opened.record,
  };
}

/** Chat turn contract id used when waiving external acceptance. */
export const CHAT_TURN_CONTRACT_V1 = "chat_turn_contract_v1";

/**
 * Resolve close gates from the chat-turn task contract (not runtime fallback).
 * Standard chat turns do not require an external acceptance validator; final
 * visible delivery still needs an explicit delivery receipt id.
 */
export function resolveChatTurnCloseGates(params: {
  deliveryId: string;
  /** When true, waive delivery channel (rare; prefer delivered with receipt). */
  waiveDelivery?: boolean;
}): {
  acceptance: { status: "not_required"; reason: string };
  delivery: { status: "delivered" } | { status: "not_required"; reason: string };
  deliveryId: string;
} {
  const deliveryId = params.deliveryId.trim();
  if (!deliveryId) {
    throw new Error("resolveChatTurnCloseGates requires deliveryId receipt");
  }
  return {
    acceptance: {
      status: "not_required",
      reason: `${CHAT_TURN_CONTRACT_V1}:no_external_acceptance`,
    },
    delivery: params.waiveDelivery
      ? {
          status: "not_required",
          reason: `${CHAT_TURN_CONTRACT_V1}:delivery_waived`,
        }
      : { status: "delivered" },
    deliveryId,
  };
}

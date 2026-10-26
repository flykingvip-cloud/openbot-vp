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

/** Version-pinned task close contract — never invent from runtime alone. */
export type ResolvedTurnTaskContract = {
  /** Stable contract id (e.g. chat_turn_contract_v1 or skill contract id). */
  id: string;
  version: string;
  /**
   * Classification from entry/preflight. Missing/unknown must NOT auto-downgrade
   * to chat_turn waiver.
   */
  kind: "chat_turn" | "code" | "document" | "external_action" | "execution" | "unknown";
  /** From skill/preflight; non-empty ⇒ acceptance cannot be waived. */
  requiredValidators: readonly string[];
};

export type DeliveryPhase =
  | "awaiting"
  | "delivered"
  | "failed"
  | "delivery_unknown"
  | "not_required";

/**
 * Resolve a turn close contract from entry + preflight signals.
 * Only explicit chat_turn with empty validators may waive external acceptance.
 * Missing classification → kind "unknown" (acceptance stays pending).
 */
export function resolveTurnTaskContract(params: {
  /** When true / id is CHAT_TURN_CONTRACT_V1 and no validators → chat_turn. */
  explicitChatTurn?: boolean;
  contractId?: string;
  contractVersion?: string;
  requiredValidators?: readonly string[];
  /** True when execution preflight declared validators are required. */
  validatorsRequired?: boolean;
  /** Hook/preflight already verified acceptance receipts. */
  acceptanceVerified?: boolean;
  kind?: ResolvedTurnTaskContract["kind"];
}): ResolvedTurnTaskContract & { acceptanceVerified?: boolean } {
  const validators = [...(params.requiredValidators ?? [])].map((v) => v.trim()).filter(Boolean);
  const validatorsRequired = Boolean(params.validatorsRequired) || validators.length > 0;
  if (validatorsRequired) {
    return {
      id: params.contractId?.trim() || "execution_task_contract",
      version: params.contractVersion?.trim() || "1.0.0",
      kind:
        params.kind && params.kind !== "chat_turn" && params.kind !== "unknown"
          ? params.kind
          : "execution",
      requiredValidators: validators.length > 0 ? validators : ["preflight:validators_required"],
      ...(params.acceptanceVerified ? { acceptanceVerified: true } : {}),
    };
  }
  if (params.kind && params.kind !== "chat_turn" && params.kind !== "unknown") {
    return {
      id: params.contractId?.trim() || `${params.kind}_contract`,
      version: params.contractVersion?.trim() || "1.0.0",
      kind: params.kind,
      requiredValidators: validators,
    };
  }
  const id = params.contractId?.trim() || "";
  const explicitChat =
    params.explicitChatTurn === true || id === CHAT_TURN_CONTRACT_V1 || params.kind === "chat_turn";
  if (explicitChat) {
    return {
      id: CHAT_TURN_CONTRACT_V1,
      version: params.contractVersion?.trim() || "1",
      kind: "chat_turn",
      requiredValidators: [],
    };
  }
  return {
    id: id || "unresolved_task_contract",
    version: params.contractVersion?.trim() || "0",
    kind: "unknown",
    requiredValidators: [],
  };
}

export type ResolvedCloseGates = {
  acceptance:
    | { status: "pending" }
    | { status: "passed" }
    | { status: "failed" }
    | { status: "not_required"; reason: string };
  delivery:
    | { status: "pending" }
    | { status: "delivered" }
    | { status: "failed" }
    | { status: "delivery_unknown" }
    | { status: "not_required"; reason: string };
  deliveryId: string;
};

/**
 * Resolve close gates from a version-pinned task contract (not runtime fallback).
 * - chat_turn + empty validators → acceptance not_required
 * - execution/code/document/external_action or requiredValidators → pending
 *   (or passed when acceptanceVerified)
 * - missing/unknown contract → acceptance pending (never auto chat waive)
 * - deliveryPhase awaiting → pending (must not claim delivered before send)
 */
export function resolveChatTurnCloseGates(params: {
  deliveryId: string;
  /** Resolved contract; null/undefined ⇒ unresolved ⇒ acceptance pending. */
  contract?: ResolvedTurnTaskContract | null;
  /** Prepare stage must use "awaiting"; only send callback may pass "delivered". */
  deliveryPhase?: DeliveryPhase;
  /** @deprecated prefer deliveryPhase */
  waiveDelivery?: boolean;
  /** When preflight already verified validators for this turn. */
  acceptanceVerified?: boolean;
}): ResolvedCloseGates {
  const deliveryId = params.deliveryId.trim();
  if (!deliveryId) {
    throw new Error("resolveChatTurnCloseGates requires deliveryId receipt");
  }

  const contract = params.contract;
  let acceptance: ResolvedCloseGates["acceptance"];
  if (!contract || contract.kind === "unknown") {
    acceptance = { status: "pending" };
  } else if (contract.requiredValidators.length > 0 || contract.kind !== "chat_turn") {
    if (params.acceptanceVerified) {
      acceptance = { status: "passed" };
    } else {
      acceptance = { status: "pending" };
    }
  } else if (contract.id === CHAT_TURN_CONTRACT_V1 && contract.kind === "chat_turn") {
    acceptance = {
      status: "not_required",
      reason: `${CHAT_TURN_CONTRACT_V1}:no_external_acceptance`,
    };
  } else {
    acceptance = { status: "pending" };
  }

  const phase: DeliveryPhase = params.waiveDelivery
    ? "not_required"
    : (params.deliveryPhase ?? "awaiting");
  let delivery: ResolvedCloseGates["delivery"];
  switch (phase) {
    case "delivered":
      delivery = { status: "delivered" };
      break;
    case "failed":
      delivery = { status: "failed" };
      break;
    case "delivery_unknown":
      delivery = { status: "delivery_unknown" };
      break;
    case "not_required":
      delivery = {
        status: "not_required",
        reason: `${contract?.id ?? "unresolved"}:delivery_waived`,
      };
      break;
    case "awaiting":
    default:
      delivery = { status: "pending" };
      break;
  }

  return { acceptance, delivery, deliveryId };
}

/**
 * W3: acceptance gates driven by task contract kind (任务类型验收).
 *
 * Hard rule: never invent `not_required` as a success shortcut.
 * Only explicit chat_turn + empty requiredValidators may waive external acceptance.
 */

import type { AcceptanceGate, TaskContractIdentity, TaskContractKind } from "./types.js";

export type { TaskContractIdentity, TaskContractKind };

export const CHAT_TURN_CONTRACT_ID = "chat_turn_contract_v1";

export type AssessAcceptanceByTaskTypeInput = {
  contract: TaskContractIdentity | null | undefined;
  /** Preflight / validator receipts already verified for this turn. */
  acceptanceVerified?: boolean;
  /** Explicit failed acceptance (e.g. validator mismatch). */
  acceptanceFailed?: boolean;
  failureReason?: string;
};

/**
 * Resolve acceptance gate from task type contract.
 * - missing / unknown → pending
 * - chat_turn + empty validators → not_required (with reason)
 * - execution/code/document/external_action → pending (or passed if verified; never auto not_required)
 * - any requiredValidators → pending unless verified
 */
export function assessAcceptanceByTaskType(input: AssessAcceptanceByTaskTypeInput): AcceptanceGate {
  if (input.acceptanceFailed) {
    return { status: "failed" };
  }
  const contract = input.contract;
  if (!contract || contract.kind === "unknown") {
    return { status: "pending" };
  }
  const validators = [...(contract.requiredValidators ?? [])].map((v) => v.trim()).filter(Boolean);
  if (validators.length > 0 || contract.kind !== "chat_turn") {
    if (input.acceptanceVerified) {
      return { status: "passed" };
    }
    return { status: "pending" };
  }
  // Explicit chat_turn waiver only.
  if (
    contract.kind === "chat_turn" &&
    (contract.id === CHAT_TURN_CONTRACT_ID || contract.id.trim().length > 0) &&
    validators.length === 0
  ) {
    return {
      status: "not_required",
      reason: `${contract.id || CHAT_TURN_CONTRACT_ID}:no_external_acceptance`,
    };
  }
  return { status: "pending" };
}

/** True when a gate would illegally claim success without contract waiver/evidence. */
export function isInventedNotRequiredSuccess(params: {
  contract: TaskContractIdentity | null | undefined;
  acceptance: AcceptanceGate;
}): boolean {
  if (params.acceptance.status !== "not_required") {
    return false;
  }
  const contract = params.contract;
  if (!contract || contract.kind !== "chat_turn") {
    return true;
  }
  if ((contract.requiredValidators ?? []).some((v) => v.trim())) {
    return true;
  }
  return false;
}

export function buildTaskContractIdentity(params: {
  id?: string;
  version?: string;
  kind?: TaskContractKind;
  requiredValidators?: readonly string[];
  explicitChatTurn?: boolean;
}): TaskContractIdentity {
  const validators = [...(params.requiredValidators ?? [])].map((v) => v.trim()).filter(Boolean);
  if (validators.length > 0) {
    return {
      id: params.id?.trim() || "execution_task_contract",
      version: params.version?.trim() || "1.0.0",
      kind:
        params.kind && params.kind !== "chat_turn" && params.kind !== "unknown"
          ? params.kind
          : "execution",
      requiredValidators: validators,
    };
  }
  if (params.kind && params.kind !== "chat_turn" && params.kind !== "unknown") {
    return {
      id: params.id?.trim() || `${params.kind}_contract`,
      version: params.version?.trim() || "1.0.0",
      kind: params.kind,
      requiredValidators: [],
    };
  }
  const explicitChat =
    params.explicitChatTurn === true ||
    params.kind === "chat_turn" ||
    params.id?.trim() === CHAT_TURN_CONTRACT_ID;
  if (explicitChat) {
    return {
      id: CHAT_TURN_CONTRACT_ID,
      version: params.version?.trim() || "1",
      kind: "chat_turn",
      requiredValidators: [],
    };
  }
  return {
    id: params.id?.trim() || "unresolved_task_contract",
    version: params.version?.trim() || "0",
    kind: "unknown",
    requiredValidators: [],
  };
}

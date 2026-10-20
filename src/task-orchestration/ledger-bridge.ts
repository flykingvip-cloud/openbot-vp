/**
 * Orchestration Plane — Progress Ledger bridge types (P4.5).
 *
 * Thin typing only: orchestrator outputs that *would* become ledger events
 * must use Progress Ledger event/evidence types. This module does **not**
 * call `appendLedgerEvent` / `appendLedgerEvents`. Todos in orchestrator
 * memory are not authority; the Ledger remains authority.
 *
 * Ack ≠ delivery. Forbidden evidence (assistant_text / model_claim / …) is
 * rejected here the same way Ledger I1 rejects it.
 */

import { isForbiddenEvidenceType } from "../progress-ledger/evidence.js";
import type {
  EvidenceType,
  ExecutionEventType,
  ForbiddenEvidenceType,
} from "../progress-ledger/types.js";
import { OrchestrationInvariantError } from "./errors.js";
import { ORCH_REASON } from "./reason-codes.js";

export type OrchestratorLedgerIntent = {
  eventType: ExecutionEventType;
  evidenceType?: EvidenceType | ForbiddenEvidenceType;
  /** True when this is an ack beat, which must never be treated as delivery. */
  ackOnly?: boolean;
  toolName?: string;
};

export function isForbiddenLedgerEvidence(type: string): type is ForbiddenEvidenceType {
  return isForbiddenEvidenceType(type);
}

/**
 * Validate a would-be ledger output. Does not write. Throws on forbidden
 * evidence or on using ack as a completion event.
 */
export function assertLedgerBridgeOutput(intent: OrchestratorLedgerIntent): void {
  if (intent.evidenceType && isForbiddenLedgerEvidence(intent.evidenceType)) {
    throw new OrchestrationInvariantError(
      "ORCH7",
      `${ORCH_REASON.FORBIDDEN_EVIDENCE}: ${intent.evidenceType}`,
    );
  }
  if (intent.ackOnly && intent.eventType === "STEP_COMPLETED") {
    throw new OrchestrationInvariantError("ORCH7", ORCH_REASON.ACK_IS_NOT_DELIVERY);
  }
}

/**
 * Map a tool result (future invoke PR) onto an allowed ledger intent.
 * Skill expand must not go through this helper — use skill-binder instead.
 */
export function toolResultLedgerIntent(toolName: string): OrchestratorLedgerIntent {
  return {
    eventType: "TOOL_SUCCEEDED",
    evidenceType: "tool_result",
    toolName,
    ackOnly: false,
  };
}

export function ackLedgerIntent(): OrchestratorLedgerIntent {
  return {
    eventType: "MEANINGFUL_PROGRESS",
    ackOnly: true,
  };
}

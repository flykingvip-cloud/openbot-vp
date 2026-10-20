/**
 * Employee Decision Surface view models.
 *
 * Projection types come straight from the evolution-core decision surface
 * (through the browser-safe contract boundary) so the UI cannot drift from
 * the contract. Only the UI receipt is defined here.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */

export type {
  EvolutionEmployeeActionUnavailableCode,
  EvolutionEmployeeDecisionHistory,
  EvolutionEmployeeDecisionRow,
  EvolutionEmployeeDecisionSnapshot,
  EvolutionEmployeeDecisionStatusCounts,
  EvolutionEmployeeDecisionSurfaceView,
  EvolutionEmployeeDecisionTransition,
  EvolutionEmployeeDecisionUiStatus,
  EvolutionEmployeeEvidenceSummary,
  EvolutionEmployeeWeekOverWeekSummary,
} from "../../../evolution-decision-contract.ts";

/**
 * Machine receipt kept by the section. Its fields go to `data-*` attributes;
 * the employee only sees the Chinese sentence built from it. It records an
 * admissibility judgement, never an effect.
 */
export type EvolutionEmployeeDecisionSubmitReceipt = {
  commandId: string;
  decisionId: string;
  action: string;
  outcome: string;
  code: string;
  executed: false;
  effectProof: false;
  writes: readonly never[];
  auditReceiptRef: string;
};

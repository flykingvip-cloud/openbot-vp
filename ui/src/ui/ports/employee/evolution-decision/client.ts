/**
 * Code-present employee Decision Surface adapter.
 *
 * Loads and submits through the D1/D2 pure functions, imported through the
 * browser-safe contract boundary (`ui/src/ui/evolution-decision-contract.ts`).
 * Does not call Gateway mutation RPCs, Adapter, or Perception write paths.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */

import type { AuthorityGrantView } from "@openbot/evolution-core";
import {
  EVOLUTION_DECISION_ENDPOINT_ACTIONS,
  evolutionEmployeeDecisionLoadFailView,
  projectEvolutionEmployeeDecisionSurface,
  submitEvolutionEmployeeDecisionCommand,
  type EvolutionDecisionAuthorityFacts,
  type EvolutionDecisionCommand,
  type EvolutionDecisionCommandRecord,
  type EvolutionDecisionItem,
  type EvolutionDecisionPrincipal,
  type EvolutionDecisionRouteInput,
  type EvolutionEmployeeDecisionHistory,
} from "../../../evolution-decision-contract.ts";
import type {
  EvolutionEmployeeDecisionSubmitReceipt,
  EvolutionEmployeeDecisionSurfaceView,
} from "./types.ts";

export const EVOLUTION_DECISION_EMPLOYEE_ACTIONS = EVOLUTION_DECISION_ENDPOINT_ACTIONS.employee;

/**
 * Read-only current / prior snapshots for one employee.
 *
 * D2 ships no runtime implementation; tests inject one. A runtime source
 * must be a server-side read projection of the existing Timeline/Ledger that
 * applies D1 visibility before facts leave the server. It must not add a
 * history store.
 */
export type EvolutionDecisionHistorySource = {
  loadHistory(): Promise<EvolutionEmployeeDecisionHistory>;
};

export type EvolutionDecisionSubmitContext = {
  item: EvolutionDecisionItem;
  routeInput: EvolutionDecisionRouteInput;
  principal: EvolutionDecisionPrincipal;
  grant: AuthorityGrantView | { status: "missing" };
  facts: EvolutionDecisionAuthorityFacts;
  prior: readonly EvolutionDecisionCommandRecord[];
  now: string;
};

/**
 * Load both snapshots and project them for the employee. Any failure while
 * loading or projecting is `load-fail`, never an empty healthy list.
 */
export async function loadEvolutionEmployeeDecisionSurface(input: {
  source: EvolutionDecisionHistorySource;
  principal: EvolutionDecisionPrincipal;
  perceptionFactIdsByControlPlaneRef?: ReadonlyMap<string, readonly string[]>;
}): Promise<EvolutionEmployeeDecisionSurfaceView> {
  try {
    const history = await input.source.loadHistory();
    return projectEvolutionEmployeeDecisionSurface({
      history,
      principal: input.principal,
      perceptionFactIdsByControlPlaneRef: input.perceptionFactIdsByControlPlaneRef,
    });
  } catch {
    return evolutionEmployeeDecisionLoadFailView();
  }
}

/**
 * Submit a D1-mapped employee action. Server-resolved principal / ownership /
 * version / route binding are required on the context; the client command may
 * only carry commandId, decisionId, action, expectedVersion.
 */
export function submitEvolutionEmployeeDecisionAction(input: {
  command: EvolutionDecisionCommand;
  context: EvolutionDecisionSubmitContext;
}): EvolutionEmployeeDecisionSubmitReceipt {
  const result = submitEvolutionEmployeeDecisionCommand({
    command: input.command,
    item: input.context.item,
    principal: input.context.principal,
    grant: input.context.grant,
    facts: input.context.facts,
    routeInput: input.context.routeInput,
    now: input.context.now,
    prior: input.context.prior,
  });
  return {
    commandId: result.judgement.receipt.commandId,
    decisionId: result.judgement.receipt.decisionId,
    action: result.judgement.receipt.action,
    outcome: result.judgement.receipt.outcome,
    code: result.judgement.code,
    executed: false,
    effectProof: false,
    writes: [],
    auditReceiptRef: result.judgement.receipt.auditReceiptRef,
  };
}

/** Guard: UI must never invent actions outside the employee command-map matrix. */
export function isEmployeeDecisionActionAllowedByMap(action: string): boolean {
  return (EVOLUTION_DECISION_EMPLOYEE_ACTIONS as readonly string[]).includes(action);
}

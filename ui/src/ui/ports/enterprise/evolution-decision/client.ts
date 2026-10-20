/**
 * Code-present enterprise Decision Surface adapter.
 *
 * Loads and submits through the D1 / D3 pure functions only, imported
 * through the browser-safe contract boundary
 * (`ui/src/ui/evolution-decision-contract.ts`). No Gateway RPC, HTTP request,
 * file read, control-plane call, or Adapter call happens here, and nothing is
 * stored.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */

import {
  EVOLUTION_DECISION_ENDPOINT_ACTIONS,
  evolutionEnterpriseDecisionDenial,
  evolutionEnterpriseDecisionLoadFailView,
  projectEvolutionEnterpriseDecisionSurface,
  submitEvolutionEnterpriseDecisionCommand,
  type EvolutionDecisionCommand,
  type EvolutionDecisionPrincipal,
  type EvolutionEnterpriseDecisionHistory,
} from "../../../evolution-decision-contract.ts";
import type {
  EvolutionEnterpriseDecisionHistorySource,
  EvolutionEnterpriseDecisionSubmitContext,
  EvolutionEnterpriseDecisionSubmitReceipt,
  EvolutionEnterpriseDecisionSurfaceView,
} from "./types.ts";

export const EVOLUTION_DECISION_ENTERPRISE_ACTIONS = EVOLUTION_DECISION_ENDPOINT_ACTIONS.enterprise;

/** Nothing to read: the projection answers a denied principal before any snapshot. */
const NO_HISTORY: EvolutionEnterpriseDecisionHistory = Object.freeze({
  current: Object.freeze({ asOf: "", facts: Object.freeze([]) }),
  prior: null,
});

/**
 * Whether the server-resolved principal carries the enterprise identity the
 * surface needs: a trusted tenant and the enterprise admin role.
 */
export function hasEnterpriseDecisionIdentity(
  principal: EvolutionDecisionPrincipal | null | undefined,
): boolean {
  return principal != null && evolutionEnterpriseDecisionDenial(principal) === null;
}

/**
 * Load both snapshots and project them for the enterprise admin. A denied
 * principal never reads the source. Any failure while loading or projecting
 * is `load-fail`, never an empty healthy list.
 */
export async function loadEvolutionEnterpriseDecisionSurface(input: {
  source: EvolutionEnterpriseDecisionHistorySource;
  principal: EvolutionDecisionPrincipal;
}): Promise<EvolutionEnterpriseDecisionSurfaceView> {
  if (!hasEnterpriseDecisionIdentity(input.principal)) {
    return projectEvolutionEnterpriseDecisionSurface({
      history: NO_HISTORY,
      principal: input.principal,
    });
  }
  try {
    const history = await input.source.loadHistory();
    return projectEvolutionEnterpriseDecisionSurface({ history, principal: input.principal });
  } catch {
    return evolutionEnterpriseDecisionLoadFailView();
  }
}

/**
 * Submit one enterprise action through the D1 judge. The command goes in as
 * the raw client body, so anything besides commandId, decisionId, action,
 * and expectedVersion is refused. Principal, grant, participation facts,
 * route, and history come only from the server-resolved context.
 */
export function submitEvolutionEnterpriseDecisionAction(input: {
  command: EvolutionDecisionCommand;
  context: EvolutionEnterpriseDecisionSubmitContext;
}): EvolutionEnterpriseDecisionSubmitReceipt {
  const result = submitEvolutionEnterpriseDecisionCommand({
    payload: { ...input.command },
    item: input.context.item,
    principal: input.context.principal,
    grant: input.context.grant,
    facts: input.context.facts,
    routeInput: input.context.routeInput,
    now: input.context.now,
    prior: input.context.prior,
  });
  const { receipt } = result.judgement;
  return {
    commandId: receipt.commandId,
    decisionId: receipt.decisionId,
    action: receipt.action,
    outcome: receipt.outcome,
    code: result.judgement.code,
    executed: false,
    effectProof: false,
    writes: [],
    auditReceiptRef: receipt.auditReceiptRef,
  };
}

/** Guard: the page never offers an action outside the enterprise command map. */
export function isEnterpriseDecisionActionAllowedByMap(action: string): boolean {
  return (EVOLUTION_DECISION_ENTERPRISE_ACTIONS as readonly string[]).includes(action);
}

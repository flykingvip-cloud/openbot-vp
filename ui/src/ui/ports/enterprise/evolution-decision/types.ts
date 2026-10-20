/**
 * Enterprise Decision Surface view models.
 *
 * Projection types come straight from the evolution-core decision surface
 * (through the browser-safe contract boundary) so the UI cannot drift from
 * the D3 contract. Only the injected source, the submit context, the command
 * id factory, and the UI receipt are defined here.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */

import type { AuthorityGrantView } from "@openbot/evolution-core";
import type {
  EvolutionDecisionAction,
  EvolutionDecisionAuthorityFacts,
  EvolutionDecisionCommandRecord,
  EvolutionDecisionItem,
  EvolutionDecisionPrincipal,
  EvolutionDecisionRouteInput,
  EvolutionEnterpriseDecisionHistory,
} from "../../../evolution-decision-contract.ts";

export type {
  EvolutionEnterpriseDecisionDenial,
  EvolutionEnterpriseDecisionHistory,
  EvolutionEnterpriseDecisionRow,
  EvolutionEnterpriseDecisionSnapshot,
  EvolutionEnterpriseDecisionStatusCounts,
  EvolutionEnterpriseDecisionSurfaceView,
  EvolutionEnterpriseDecisionTransition,
  EvolutionEnterpriseDecisionUiStatus,
  EvolutionEnterpriseEvidenceSummary,
  EvolutionEnterpriseWeekOverWeekSummary,
} from "../../../evolution-decision-contract.ts";

/**
 * Read-only current / prior snapshots for the enterprise admin of one tenant.
 *
 * D3.3 ships no implementation; tests inject one. A runtime source must be a
 * server-side read projection of the existing Timeline/Ledger. It must not
 * add a history store, copy Proposals or the Ledger, or make the page call a
 * Gateway RPC of its own.
 */
export type EvolutionEnterpriseDecisionHistorySource = {
  loadHistory(): Promise<EvolutionEnterpriseDecisionHistory>;
};

/**
 * Server-resolved facts for submitting on one decision. Every field comes
 * from the server; the page never builds or overrides any of them.
 */
export type EvolutionEnterpriseDecisionSubmitContext = {
  item: EvolutionDecisionItem;
  routeInput: EvolutionDecisionRouteInput;
  principal: EvolutionDecisionPrincipal;
  grant: AuthorityGrantView | { status: "missing" };
  facts: EvolutionDecisionAuthorityFacts;
  prior: readonly EvolutionDecisionCommandRecord[];
  now: string;
};

/**
 * Idempotency key for one submit. Injected by tests or a future runtime
 * host; without one the component refuses to submit.
 */
export type EvolutionEnterpriseDecisionCommandIdFactory = (input: {
  decisionId: string;
  action: EvolutionDecisionAction;
}) => string;

/**
 * Machine receipt kept by the component. Its fields go to `data-*`
 * attributes; the admin only reads the Chinese sentence built from it. It
 * records an admissibility judgement, never an effect.
 */
export type EvolutionEnterpriseDecisionSubmitReceipt = {
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

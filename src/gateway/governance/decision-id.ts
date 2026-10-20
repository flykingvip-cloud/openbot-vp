/**
 * decisionId rules (governance closure plan v1.0 §4.2, ADR-10).
 *
 * Every envelope has its own `decisionId`. Only the commercial-run envelope reuses the
 * commercial gate's `authorizationDecisionId` (the billing foreign key). Every other
 * source gets a fresh `gd-` id and carries the commercial id in
 * `commercialAuthorizationId`, so a model decision and a commercial decision never
 * share one id.
 */

import { randomUUID } from "node:crypto";
import type { GovernanceSource } from "./decision.js";

export const GOVERNANCE_DECISION_ID_PREFIX = "gd-";

export function newGovernanceDecisionId(uuid: () => string = randomUUID): string {
  return `${GOVERNANCE_DECISION_ID_PREFIX}${uuid()}`;
}

export function isGovernanceDecisionId(value: string | undefined): boolean {
  return (
    typeof value === "string" &&
    value.startsWith(GOVERNANCE_DECISION_ID_PREFIX) &&
    value.length > GOVERNANCE_DECISION_ID_PREFIX.length
  );
}

export type GovernanceDecisionIds = {
  decisionId: string;
  commercialAuthorizationId?: string;
};

/**
 * Resolves the id fields for a new envelope.
 *  - `commercial-run`: `decisionId` = `authorizationDecisionId` (fresh `gd-` id only
 *    when the gate produced none, e.g. `skipped`).
 *  - any other source: fresh `gd-` id; `commercialAuthorizationId` = the commercial id.
 */
export function resolveGovernanceDecisionIds(params: {
  source: GovernanceSource;
  authorizationDecisionId?: string;
  uuid?: () => string;
}): GovernanceDecisionIds {
  const commercialId = params.authorizationDecisionId?.trim() || undefined;
  if (params.source === "commercial-run") {
    return commercialId
      ? { decisionId: commercialId, commercialAuthorizationId: commercialId }
      : { decisionId: newGovernanceDecisionId(params.uuid) };
  }
  return {
    decisionId: newGovernanceDecisionId(params.uuid),
    ...(commercialId ? { commercialAuthorizationId: commercialId } : {}),
  };
}

/**
 * Mount gate for the enterprise Decision Surface.
 *
 * Reads only the reviewed contract constant from the evolution-core
 * decision surface, through the browser-safe contract boundary.
 * It takes no argument on purpose: a URL, query string, hash, browser
 * storage, cookie, form field, page global, environment value, or a field a
 * Gateway response reports about itself has no way to reach it. D3 is
 * code-present, so the gate is closed and no enterprise page mounts the
 * surface.
 */

import { EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED } from "../../../evolution-decision-contract.ts";

export function enterpriseEvolutionDecisionSurfaceMountEnabled(): boolean {
  return EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED;
}

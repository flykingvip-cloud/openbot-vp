/**
 * Mount gate for the employee Decision Surface on the settings page.
 *
 * Reads only the reviewed contract constant from the evolution-core
 * decision surface, through the browser-safe contract boundary.
 * It takes no argument on purpose: a URL, query string, browser storage,
 * form input, or client claim has no way to reach it. D2 is code-present,
 * so the gate is closed and the settings page does not mount the surface.
 */

import { EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED } from "../../../evolution-decision-contract.ts";

export function employeeEvolutionDecisionSurfaceMountEnabled(): boolean {
  return EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED;
}

/**
 * Track I / M2 — InterventionCase RPC method name constants (leaf module).
 * Kept free of gateway/dispatch imports so report-query-api can re-export
 * without forming a cycle through production-cutover.
 */
export const DIAGNOSIS_INTERVENTION_LIST_METHOD = "diagnosis.intervention.list" as const;
export const DIAGNOSIS_INTERVENTION_GET_METHOD = "diagnosis.intervention.get" as const;
export const DIAGNOSIS_INTERVENTION_DISPATCH_METHOD = "diagnosis.intervention.dispatch" as const;
export const DIAGNOSIS_INTERVENTION_EXPAND_METHOD = "diagnosis.intervention.expand" as const;
export const DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD =
  "diagnosis.intervention.materialize" as const;

export const DIAGNOSIS_INTERVENTION_METHODS = [
  DIAGNOSIS_INTERVENTION_LIST_METHOD,
  DIAGNOSIS_INTERVENTION_GET_METHOD,
  DIAGNOSIS_INTERVENTION_DISPATCH_METHOD,
  DIAGNOSIS_INTERVENTION_EXPAND_METHOD,
  DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD,
] as const;

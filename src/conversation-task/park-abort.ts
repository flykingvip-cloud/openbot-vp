/**
 * Live safety predicate for an in-flight run.
 * Gateway uses this. It is not classifyTurnRelation and it does not grant
 * that classifier policy authority.
 */
export function shouldTaskParkAbortInFlight(cutContext: boolean, abortInFlight?: boolean): boolean {
  return cutContext || abortInFlight === true;
}

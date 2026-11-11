/**
 * First verifiable diagnosis handling-loop RPC names (leaf module).
 * Kept free of store/job imports so report-query-api can re-export
 * without forming a cycle.
 *
 * This is not production enablement or live repair.
 */
export const DIAGNOSIS_HANDLING_PREVIEW_METHOD = "diagnosis.handling.preview" as const;
export const DIAGNOSIS_HANDLING_SUBMIT_METHOD = "diagnosis.handling.submit" as const;
export const DIAGNOSIS_HANDLING_APPROVE_METHOD = "diagnosis.handling.approve" as const;
export const DIAGNOSIS_HANDLING_REJECT_METHOD = "diagnosis.handling.reject" as const;
export const DIAGNOSIS_HANDLING_CANCEL_METHOD = "diagnosis.handling.cancel" as const;
export const DIAGNOSIS_HANDLING_EXECUTE_METHOD = "diagnosis.handling.execute" as const;
export const DIAGNOSIS_HANDLING_RECHECK_METHOD = "diagnosis.handling.recheck" as const;
export const DIAGNOSIS_HANDLING_GET_METHOD = "diagnosis.handling.get" as const;
export const DIAGNOSIS_HANDLING_LIST_METHOD = "diagnosis.handling.list" as const;

export const DIAGNOSIS_HANDLING_METHODS = [
  DIAGNOSIS_HANDLING_PREVIEW_METHOD,
  DIAGNOSIS_HANDLING_SUBMIT_METHOD,
  DIAGNOSIS_HANDLING_APPROVE_METHOD,
  DIAGNOSIS_HANDLING_REJECT_METHOD,
  DIAGNOSIS_HANDLING_CANCEL_METHOD,
  DIAGNOSIS_HANDLING_EXECUTE_METHOD,
  DIAGNOSIS_HANDLING_RECHECK_METHOD,
  DIAGNOSIS_HANDLING_GET_METHOD,
  DIAGNOSIS_HANDLING_LIST_METHOD,
] as const;

export const DIAGNOSIS_HANDLING_READ_METHODS = [
  DIAGNOSIS_HANDLING_PREVIEW_METHOD,
  DIAGNOSIS_HANDLING_GET_METHOD,
  DIAGNOSIS_HANDLING_LIST_METHOD,
] as const;

export const DIAGNOSIS_HANDLING_WRITE_METHODS = [
  DIAGNOSIS_HANDLING_SUBMIT_METHOD,
  DIAGNOSIS_HANDLING_CANCEL_METHOD,
  DIAGNOSIS_HANDLING_EXECUTE_METHOD,
  DIAGNOSIS_HANDLING_RECHECK_METHOD,
] as const;

export const DIAGNOSIS_HANDLING_APPROVAL_METHODS = [
  DIAGNOSIS_HANDLING_APPROVE_METHOD,
  DIAGNOSIS_HANDLING_REJECT_METHOD,
] as const;

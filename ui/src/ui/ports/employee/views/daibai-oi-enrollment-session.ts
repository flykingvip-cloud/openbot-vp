/**
 * In-memory Stage B OI submit state for the 大白 create-success panel.
 * Survives re-renders; reset with the onboarding test helper.
 */

export type DaibaiOiEnrollmentSubmitRecord = {
  approvalId: string;
  identityScope: "personal" | "enterprise";
  identityId: string;
  targetAgentId: string;
  catalogId: string;
};

export type DaibaiOiEnrollmentUiState = {
  submittedByKey: Record<string, DaibaiOiEnrollmentSubmitRecord>;
  submitErrorByKey: Record<string, string>;
  submittingKey: string | null;
};

let state: DaibaiOiEnrollmentUiState = {
  submittedByKey: {},
  submitErrorByKey: {},
  submittingKey: null,
};

export function daibaiOiEnrollmentKey(agentId: string, gapKey: string): string {
  return `${agentId.trim()}\0${gapKey.trim()}`;
}

export function getDaibaiOiEnrollmentUiState(): DaibaiOiEnrollmentUiState {
  return state;
}

export function resetDaibaiOiEnrollmentUiForTests(): void {
  state = {
    submittedByKey: {},
    submitErrorByKey: {},
    submittingKey: null,
  };
}

export function beginDaibaiOiEnrollmentSubmit(key: string): void {
  const nextErrors = { ...state.submitErrorByKey };
  delete nextErrors[key];
  state = {
    ...state,
    submittingKey: key,
    submitErrorByKey: nextErrors,
  };
}

export function completeDaibaiOiEnrollmentSubmit(
  key: string,
  record: DaibaiOiEnrollmentSubmitRecord,
): void {
  const nextErrors = { ...state.submitErrorByKey };
  delete nextErrors[key];
  state = {
    ...state,
    submittingKey: state.submittingKey === key ? null : state.submittingKey,
    submittedByKey: { ...state.submittedByKey, [key]: record },
    submitErrorByKey: nextErrors,
  };
}

export function failDaibaiOiEnrollmentSubmit(key: string, message: string): void {
  state = {
    ...state,
    submittingKey: state.submittingKey === key ? null : state.submittingKey,
    submitErrorByKey: { ...state.submitErrorByKey, [key]: message },
  };
}

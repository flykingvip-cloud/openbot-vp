import {
  loadExecApprovals,
  removeExecApprovalsFormValue,
  saveExecApprovals,
  updateExecApprovalsFormValue,
  type ExecApprovalsState,
  type ExecApprovalsTarget,
} from "../../controllers/exec-approvals.ts";

export type ExecApprovalsCapabilityLoadState = Pick<
  ExecApprovalsState,
  | "client"
  | "connected"
  | "execApprovalsLoading"
  | "execApprovalsDirty"
  | "execApprovalsSnapshot"
  | "execApprovalsForm"
  | "lastError"
>;

export type ExecApprovalsCapabilitySaveState = Pick<
  ExecApprovalsState,
  | "client"
  | "connected"
  | "execApprovalsLoading"
  | "execApprovalsSaving"
  | "execApprovalsDirty"
  | "execApprovalsSnapshot"
  | "execApprovalsForm"
  | "lastError"
>;

export type ExecApprovalsCapabilityFormState = Pick<
  ExecApprovalsState,
  "execApprovalsDirty" | "execApprovalsSnapshot" | "execApprovalsForm"
>;

export type ExecApprovalsCapabilityTarget = ExecApprovalsTarget;

export const execApprovalsCapability = {
  load: (state: ExecApprovalsCapabilityLoadState, target?: ExecApprovalsCapabilityTarget | null) =>
    loadExecApprovals(state as unknown as ExecApprovalsState, target),
  save: (state: ExecApprovalsCapabilitySaveState, target?: ExecApprovalsCapabilityTarget | null) =>
    saveExecApprovals(state as unknown as ExecApprovalsState, target),
  updateFormValue: (
    state: ExecApprovalsCapabilityFormState,
    path: Array<string | number>,
    value: unknown,
  ) => updateExecApprovalsFormValue(state as unknown as ExecApprovalsState, path, value),
  removeFormValue: (state: ExecApprovalsCapabilityFormState, path: Array<string | number>) =>
    removeExecApprovalsFormValue(state as unknown as ExecApprovalsState, path),
} as const;

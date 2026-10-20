import {
  addExecApproval,
  parseExecApprovalRequested,
  parseExecApprovalResolved,
  removeExecApproval,
  type ExecApprovalRequest,
} from "../../controllers/exec-approval.ts";

export type ExecApprovalCapabilityEventState = {
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalError: string | null;
};

export type ExecApprovalCapabilityQueueEntry = ExecApprovalRequest;

export const execApprovalCapability = {
  parseRequested: parseExecApprovalRequested,
  parseResolved: parseExecApprovalResolved,
  addQueueEntry: (
    state: ExecApprovalCapabilityEventState,
    entry: ExecApprovalCapabilityQueueEntry,
  ) => {
    state.execApprovalQueue = addExecApproval(state.execApprovalQueue, entry);
    state.execApprovalError = null;
  },
  removeQueueEntry: (state: ExecApprovalCapabilityEventState, id: string) => {
    state.execApprovalQueue = removeExecApproval(state.execApprovalQueue, id);
  },
} as const;

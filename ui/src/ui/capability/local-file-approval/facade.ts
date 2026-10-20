import {
  addLocalFileApproval,
  parseLocalFileApprovalRequested,
  parseLocalFileApprovalResolved,
  removeLocalFileApproval,
  type LocalFileApprovalRequest,
} from "../../controllers/local-file-approval.ts";

export type LocalFileApprovalCapabilityEventState = {
  localFileApprovalQueue: LocalFileApprovalRequest[];
  localFileApprovalError: string | null;
};

export type LocalFileApprovalCapabilityQueueEntry = LocalFileApprovalRequest;

export const localFileApprovalCapability = {
  parseRequested: parseLocalFileApprovalRequested,
  parseResolved: parseLocalFileApprovalResolved,
  addQueueEntry: (
    state: LocalFileApprovalCapabilityEventState,
    entry: LocalFileApprovalCapabilityQueueEntry,
  ) => {
    state.localFileApprovalQueue = addLocalFileApproval(state.localFileApprovalQueue, entry);
    state.localFileApprovalError = null;
  },
  removeQueueEntry: (state: LocalFileApprovalCapabilityEventState, id: string) => {
    state.localFileApprovalQueue = removeLocalFileApproval(state.localFileApprovalQueue, id);
  },
} as const;

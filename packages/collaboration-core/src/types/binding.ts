export type CollaborationBindingStatus = "linked" | "stale" | "broken";

export type CollaborationBinding = {
  bindingId: string;
  channel: string;
  accountId?: string;
  entryKind: "group" | "channel";
  entryId: string;
  name?: string;
  status: CollaborationBindingStatus;
  lastVerifiedAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
};

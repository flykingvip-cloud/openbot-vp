export type DeliverableStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "published"
  | "superseded"
  | "archived";

export type Deliverable = {
  deliverableId: string;
  groupId: string;
  taskId?: string;
  title: string;
  description?: string;
  content?: string;
  contentType?: string;
  sourceLineageId?: string;
  status: DeliverableStatus;
  version: number;
  previousVersionId?: string;
  finalDeciderMemberId?: string;
  submittedBy?: string;
  approvedBy?: string;
  publishedBy?: string;
  submittedAtMs?: number;
  approvedAtMs?: number;
  publishedAtMs?: number;
  createdBy?: string;
  updatedBy?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

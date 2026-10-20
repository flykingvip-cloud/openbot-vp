export type ReviewStatus = "requested" | "submitted" | "acknowledged" | "resolved";
export type ReviewVerdict = "approve" | "revise" | "reject";
export type ReviewDisposition = "accepted" | "partially_accepted" | "rejected";

export type Review = {
  reviewId: string;
  groupId: string;
  deliverableId: string;
  taskId?: string;
  status: ReviewStatus;
  verdict?: ReviewVerdict;
  reviewerMemberId: string;
  comments?: string;
  suggestions?: string[];
  disposition?: ReviewDisposition;
  dispositionSummary?: string[];
  requestedBy?: string;
  submittedBy?: string;
  acknowledgedBy?: string;
  resolvedBy?: string;
  requestedAtMs: number;
  submittedAtMs?: number;
  acknowledgedAtMs?: number;
  resolvedAtMs?: number;
  createdBy?: string;
  updatedBy?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

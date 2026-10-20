/** Enterprise submission statuses from capability-install-governance-store. */
export type EnterpriseSubmissionStatus =
  | "pending-review"
  | "reviewing"
  | "published"
  | "rejected"
  | "returned-for-modification"
  | "enterprise-only";

export type EnterpriseSubmissionListItem = {
  submissionId: string;
  capabilityId: string;
  capabilityName: string;
  enterpriseId: string;
  enterpriseName: string;
  submittedAt: number;
  status: EnterpriseSubmissionStatus;
  sanitized: boolean;
  sanitizationFindings: number;
  sanitizedPackageId: string | null;
  artifactHash: string | null;
};

export type EnterpriseSubmissionDetail = EnterpriseSubmissionListItem & {
  sourceProvenance: string;
  reviewerId: string | null;
  reviewedAt: number | null;
  rejectionReason: string | null;
};

export type EnterpriseSubmissionsListResponse = {
  submissions: EnterpriseSubmissionListItem[];
  total: number;
  pendingCount: number;
  reviewingCount: number;
};

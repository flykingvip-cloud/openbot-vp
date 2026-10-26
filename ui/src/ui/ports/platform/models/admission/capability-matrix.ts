/**
 * Capability matrix view helpers for the model detail drawer.
 */

import {
  sourceLabel,
  statusLabel,
  summarizeCapabilityEvidence,
  type CapabilityEvidenceItem,
  type CapabilityEvidenceSummary,
} from "../capability-evidence.ts";
import type { CapabilityVerificationTask } from "../model-admission-store.ts";

export type CapabilityMatrixRow = {
  id: string;
  label: string;
  sourceLabel: string;
  statusLabel: string;
  status: CapabilityEvidenceItem["status"];
  sourceNote?: string;
  failureReason?: string;
  verifiedAt?: number;
  expiresAt?: number;
  testVersion?: string;
  isSuggested: boolean;
  isVerified: boolean;
  isExpired: boolean;
};

export type CapabilityMatrixView = {
  rows: CapabilityMatrixRow[];
  summary: CapabilityEvidenceSummary;
  activeTask: CapabilityVerificationTask | null;
  history: CapabilityVerificationTask[];
};

export function buildCapabilityMatrixRows(
  evidence: CapabilityEvidenceItem[],
): CapabilityMatrixRow[] {
  return evidence.map((item) => ({
    id: item.id,
    label: item.label,
    sourceLabel: sourceLabel(item.source),
    statusLabel: statusLabel(item.status),
    status: item.status,
    sourceNote: item.sourceNote,
    failureReason: item.failureReason,
    verifiedAt: item.verifiedAt,
    expiresAt: item.expiresAt,
    testVersion: item.testVersion,
    isSuggested: item.status === "suggested" || item.status === "untested",
    isVerified: item.status === "passed",
    isExpired: item.status === "expired",
  }));
}

export function buildCapabilityMatrixView(input: {
  evidence: CapabilityEvidenceItem[];
  tasks?: CapabilityVerificationTask[];
}): CapabilityMatrixView {
  const history = (input.tasks ?? []).toSorted((a, b) => b.updatedAt - a.updatedAt);
  const active = history.find((t) => t.status === "queued" || t.status === "running") ?? null;
  return {
    rows: buildCapabilityMatrixRows(input.evidence),
    summary: summarizeCapabilityEvidence(input.evidence),
    activeTask: active,
    history,
  };
}

export function verificationTaskStatusLabel(status: CapabilityVerificationTask["status"]): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "验证中";
    case "succeeded":
      return "已通过";
    case "failed":
      return "未通过";
    case "cancelled":
      return "已取消";
    case "partial":
      return "部分通过";
  }
}

/** Batch: one model success must not imply whole-batch routing eligibility. */
export function summarizeBatchVerification(tasks: CapabilityVerificationTask[]): {
  succeededModelRefs: string[];
  failedModelRefs: string[];
  partialModelRefs: string[];
  /** Always false — batch never auto-enables routing. */
  batchRoutingEligible: false;
  perModel: Array<{
    modelRef: string;
    taskId: string;
    status: CapabilityVerificationTask["status"];
  }>;
} {
  const succeededModelRefs: string[] = [];
  const failedModelRefs: string[] = [];
  const partialModelRefs: string[] = [];
  for (const task of tasks) {
    if (task.status === "succeeded") {
      succeededModelRefs.push(task.modelRef);
    } else if (task.status === "partial") {
      partialModelRefs.push(task.modelRef);
    } else if (task.status === "failed") {
      failedModelRefs.push(task.modelRef);
    }
  }
  return {
    succeededModelRefs,
    failedModelRefs,
    partialModelRefs,
    batchRoutingEligible: false,
    perModel: tasks.map((task) => ({
      modelRef: task.modelRef,
      taskId: task.taskId,
      status: task.status,
    })),
  };
}

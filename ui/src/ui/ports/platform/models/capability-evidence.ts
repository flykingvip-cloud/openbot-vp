import {
  capabilityLabel,
  normalizeCapabilityIds,
  type CanonicalCapabilityId,
} from "./capability-ids.ts";

export type CapabilityEvidenceSource =
  | "name_inferred"
  | "provider_declared"
  | "catalog_declared"
  | "admin_declared"
  | "protocol_probe"
  | "specialized_eval";

export type CapabilityVerificationStatus =
  | "untested"
  | "pending"
  | "suggested"
  | "passed"
  | "failed"
  | "expired"
  /** Checker was not executed / not available — must not overwrite valid evidence. */
  | "checker_unavailable";

export type CapabilityEvidenceItem = {
  id: CanonicalCapabilityId;
  label: string;
  source: CapabilityEvidenceSource;
  status: CapabilityVerificationStatus;
  /** Human-readable origin note, e.g. "名称含 code". */
  sourceNote?: string;
  verifiedAt?: number;
  expiresAt?: number;
  failureReason?: string;
  /** Test / probe version that produced this evidence. */
  testVersion?: string;
  /** Optional quality score from specialized evaluation (0–1). */
  qualityScore?: number;
};

export type CapabilityEvidenceSummary = {
  suggested: CapabilityEvidenceItem[];
  verified: CapabilityEvidenceItem[];
  failed: CapabilityEvidenceItem[];
  expired: CapabilityEvidenceItem[];
  untested: CapabilityEvidenceItem[];
};

export function sourceLabel(source: CapabilityEvidenceSource): string {
  switch (source) {
    case "name_inferred":
      return "名称推断";
    case "provider_declared":
      return "提供方声明";
    case "catalog_declared":
      return "目录声明";
    case "admin_declared":
      return "管理员填写";
    case "protocol_probe":
      return "协议探测";
    case "specialized_eval":
      return "专项评测";
  }
}

export function statusLabel(status: CapabilityVerificationStatus): string {
  switch (status) {
    case "untested":
      return "未测试";
    case "pending":
      return "验证中";
    case "suggested":
      return "待确认";
    case "passed":
      return "已通过";
    case "failed":
      return "未通过";
    case "expired":
      return "已过期";
    case "checker_unavailable":
      return "检查器不可用";
  }
}

/** Build suggested evidence from inferred/legacy capability tags. Never marks passed. */
export function suggestedEvidenceFromInferred(
  capabilities: string[],
  notes?: Partial<Record<string, string>>,
): CapabilityEvidenceItem[] {
  return normalizeCapabilityIds(capabilities).map((id) => ({
    id,
    label: capabilityLabel(id),
    source: "name_inferred" as const,
    status: "suggested" as const,
    sourceNote: notes?.[id] ?? "由名称／提供方／元数据推断，待确认",
  }));
}

export function summarizeCapabilityEvidence(
  items: CapabilityEvidenceItem[],
): CapabilityEvidenceSummary {
  const summary: CapabilityEvidenceSummary = {
    suggested: [],
    verified: [],
    failed: [],
    expired: [],
    untested: [],
  };
  for (const item of items) {
    if (item.status === "passed") {
      summary.verified.push(item);
    } else if (item.status === "failed") {
      summary.failed.push(item);
    } else if (item.status === "expired") {
      summary.expired.push(item);
    } else if (item.status === "suggested" || item.status === "pending") {
      summary.suggested.push(item);
    } else if (item.status === "checker_unavailable") {
      summary.untested.push(item);
    } else {
      summary.untested.push(item);
    }
  }
  return summary;
}

export function verifiedCapabilityIds(items: CapabilityEvidenceItem[]): CanonicalCapabilityId[] {
  return items.filter((item) => item.status === "passed").map((item) => item.id);
}

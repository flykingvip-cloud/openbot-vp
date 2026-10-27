/**
 * Specialized evaluation display helpers (batch 3).
 * Formal specialized eval is not backend-wired yet — demo results stay in
 * demoCapabilityEvidence and must never enter verified / routing admission.
 */

import type { CapabilityEvidenceItem } from "./capability-evidence.ts";
import { capabilityLabel, type CanonicalCapabilityId } from "./capability-ids.ts";
import { getModelAdmission, upsertModelAdmission } from "./model-admission-store.ts";

export const SPECIALIZED_EVAL_DEMO_VERSION = "specialized-eval-demo-v1";
export const SPECIALIZED_EVAL_BACKEND_STATUS = "not_wired" as const;

export type SpecializedEvalDisplay = {
  id: CanonicalCapabilityId;
  label: string;
  status: CapabilityEvidenceItem["status"];
  testVersion?: string;
  verifiedAt?: number;
  verifiedAtLabel: string;
  qualityScore?: number;
  qualityScoreLabel: string;
  sourceNote?: string;
  isDemo: boolean;
};

export function formatVerifiedAt(ts?: number): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) {
    return "未记录时间";
  }
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(ts);
  }
}

export function formatQualityScore(score?: number): string {
  if (score == null || !Number.isFinite(score)) {
    return "无评分";
  }
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  return `${pct}%`;
}

export function isSpecializedEvalEvidence(item: CapabilityEvidenceItem): boolean {
  return item.source === "specialized_eval";
}

export function isDemoSpecializedEval(item: CapabilityEvidenceItem): boolean {
  const version = (item.testVersion ?? "").toLowerCase();
  const note = `${item.sourceNote ?? ""} ${item.failureReason ?? ""}`;
  return version.includes("demo") || version.includes("stub") || /模拟|演示/.test(note);
}

/** Rows for drawer: formal specialized_eval evidence + isolated demo evidence. */
export function buildSpecializedEvalDisplay(params: {
  formal: CapabilityEvidenceItem[];
  demo?: CapabilityEvidenceItem[];
}): SpecializedEvalDisplay[] {
  const rows: SpecializedEvalDisplay[] = [];
  for (const item of params.formal.filter(isSpecializedEvalEvidence)) {
    rows.push({
      id: item.id,
      label: item.label || capabilityLabel(item.id),
      status: item.status,
      testVersion: item.testVersion,
      verifiedAt: item.verifiedAt,
      verifiedAtLabel: formatVerifiedAt(item.verifiedAt),
      qualityScore: item.qualityScore,
      qualityScoreLabel: formatQualityScore(item.qualityScore),
      sourceNote: item.sourceNote,
      isDemo: false,
    });
  }
  for (const item of (params.demo ?? []).filter(isSpecializedEvalEvidence)) {
    rows.push({
      id: item.id,
      label: item.label || capabilityLabel(item.id),
      status: item.status,
      testVersion: item.testVersion ?? SPECIALIZED_EVAL_DEMO_VERSION,
      verifiedAt: item.verifiedAt,
      verifiedAtLabel: formatVerifiedAt(item.verifiedAt),
      qualityScore: item.qualityScore,
      qualityScoreLabel: formatQualityScore(item.qualityScore),
      sourceNote: item.sourceNote ?? "模拟结果，不代表真实能力",
      isDemo: true,
    });
  }
  return rows;
}

/**
 * UI-only demo specialized eval. Writes ONLY to demoCapabilityEvidence.
 * Never marks formal verified / never enables auto-routing.
 */
export function runDemoSpecializedEval(params: {
  modelRef: string;
  capabilityIds: CanonicalCapabilityId[];
  /** Optional scores 0–1 keyed by capability id. */
  scores?: Partial<Record<CanonicalCapabilityId, number>>;
}): CapabilityEvidenceItem[] {
  const now = Date.now();
  const items: CapabilityEvidenceItem[] = params.capabilityIds.map((id) => {
    const score = params.scores?.[id] ?? 0.72;
    const passed = score >= 0.6;
    return {
      id,
      label: capabilityLabel(id),
      source: "specialized_eval",
      status: passed ? "passed" : "failed",
      verifiedAt: now,
      testVersion: SPECIALIZED_EVAL_DEMO_VERSION,
      qualityScore: score,
      sourceNote: "模拟结果，不代表真实能力 · 专项评测尚未接入后端",
      ...(passed ? {} : { failureReason: "演示失败：评分低于阈值 · 模拟结果，不代表真实能力" }),
    };
  });
  const admission = getModelAdmission(params.modelRef);
  const prevDemo = (admission.demoCapabilityEvidence ?? []).filter(
    (item) => !params.capabilityIds.includes(item.id) || item.source !== "specialized_eval",
  );
  upsertModelAdmission(params.modelRef, {
    demoCapabilityEvidence: [...prevDemo, ...items],
  });
  return items;
}

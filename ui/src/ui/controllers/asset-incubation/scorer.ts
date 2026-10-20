import {
  createEmptyEvidence,
  DEFAULT_INCUBATION_THRESHOLDS,
  type AssetAdoptionEvidence,
  type AssetEvidence,
  type AssetIncubationDecision,
  type AssetIncubationLevel,
  type AssetIncubationSource,
  type AssetIncubationThresholds,
  type AssetSignalTraceEntry,
} from "./types.ts";

export type SessionQualityInput = {
  hasStructuredOutput: boolean;
  hasArtifact: boolean;
  hasWorkflowLanguage: boolean;
  hasTemplateOrReportLanguage: boolean;
};

export function computeSessionQuality(input: SessionQualityInput): number {
  let score = 0;
  if (input.hasStructuredOutput) {
    score += 0.3;
  }
  if (input.hasArtifact) {
    score += 0.35;
  }
  if (input.hasWorkflowLanguage) {
    score += 0.15;
  }
  if (input.hasTemplateOrReportLanguage) {
    score += 0.25;
  }
  return Math.min(1, score);
}

export function meetsL4Adoption(
  adoption: AssetAdoptionEvidence,
  thresholds: AssetIncubationThresholds = DEFAULT_INCUBATION_THRESHOLDS,
): boolean {
  return (
    adoption.distinctMemberCount >= thresholds.adoptionMemberCountForL4 ||
    adoption.sharedToGroup ||
    adoption.adminRecommended ||
    adoption.enterpriseSubmitted
  );
}

function meetsL3StabilityEvidence(
  evidence: AssetEvidence,
  thresholds: AssetIncubationThresholds,
): boolean {
  return (
    evidence.recurrenceCount >= thresholds.recurrenceForL3 ||
    evidence.userInitiatedSaveCount >= thresholds.userInitiatedSaveForL3 ||
    evidence.externalizationCount >= thresholds.externalizationForL3 ||
    evidence.collaborationReuseCount >= thresholds.collaborationReuseForL3 ||
    evidence.editPatternStabilityCount >= thresholds.editPatternStabilityForL3 ||
    evidence.reviewEngineStableCluster
  );
}

function deriveScorerMaxLevel(
  evidence: AssetEvidence,
  thresholds: AssetIncubationThresholds,
): AssetIncubationLevel {
  if (meetsL3StabilityEvidence(evidence, thresholds)) {
    return "L3";
  }

  const isReusableSingleSession =
    evidence.sessionQuality >= thresholds.sessionQualityForL2 &&
    (evidence.sessionQuality >= 0.65 ||
      evidence.externalizationCount >= 1 ||
      evidence.userInitiatedSaveCount >= 1);

  if (isReusableSingleSession) {
    return "L2";
  }

  if (evidence.sessionQuality >= thresholds.sessionQualityForL1) {
    return "L1";
  }

  return "L1";
}

export function deriveLevelFromEvidence(
  evidence: AssetEvidence,
  thresholds: AssetIncubationThresholds = DEFAULT_INCUBATION_THRESHOLDS,
): AssetIncubationLevel {
  const scorerMax = deriveScorerMaxLevel(evidence, thresholds);
  if (scorerMax === "L3" && meetsL4Adoption(evidence.adoption, thresholds)) {
    return "L4";
  }
  return scorerMax;
}

function buildReason(evidence: AssetEvidence, level: AssetIncubationLevel): string {
  if (level === "L4") {
    const parts: string[] = ["已具备稳定模式与组织采用证据"];
    if (
      evidence.adoption.distinctMemberCount >=
      DEFAULT_INCUBATION_THRESHOLDS.adoptionMemberCountForL4
    ) {
      parts.push(`${evidence.adoption.distinctMemberCount} 位成员使用`);
    }
    if (evidence.adoption.sharedToGroup) {
      parts.push("已团队共享");
    }
    if (evidence.adoption.adminRecommended) {
      parts.push("管理员推荐");
    }
    return parts.join("；");
  }
  if (level === "L3") {
    if (evidence.recurrenceCount >= DEFAULT_INCUBATION_THRESHOLDS.recurrenceForL3) {
      return `同类任务已重复 ${evidence.recurrenceCount} 次，形成稳定模式`;
    }
    if (evidence.userInitiatedSaveCount >= DEFAULT_INCUBATION_THRESHOLDS.userInitiatedSaveForL3) {
      return `你已主动整理 ${evidence.userInitiatedSaveCount} 次，模式趋于稳定`;
    }
    if (evidence.externalizationCount >= DEFAULT_INCUBATION_THRESHOLDS.externalizationForL3) {
      return `内容已被引用 ${evidence.externalizationCount} 次（复制/下载/分享）`;
    }
    if (evidence.collaborationReuseCount >= DEFAULT_INCUBATION_THRESHOLDS.collaborationReuseForL3) {
      return `协作流程段已复用 ${evidence.collaborationReuseCount} 次`;
    }
    if (
      evidence.editPatternStabilityCount >= DEFAULT_INCUBATION_THRESHOLDS.editPatternStabilityForL3
    ) {
      return `检测到 ${evidence.editPatternStabilityCount} 次稳定修改模式`;
    }
    if (evidence.reviewEngineStableCluster) {
      return "长期行为回顾发现重复工作模式";
    }
    return "已满足稳定模式条件";
  }
  if (level === "L2") {
    return "本次输出具备可复用结构或交付物";
  }
  if (level === "L1") {
    return "本次输出有结构化迹象，证据尚不足";
  }
  return "";
}

function computeScore(level: AssetIncubationLevel, evidence: AssetEvidence): number {
  const levelBase = { L1: 0.25, L2: 0.5, L3: 0.78, L4: 0.92 }[level];
  const stabilityBoost = Math.min(
    0.08,
    evidence.recurrenceCount * 0.02 +
      evidence.externalizationCount * 0.015 +
      evidence.userInitiatedSaveCount * 0.01,
  );
  return Math.min(1, levelBase + stabilityBoost + evidence.sessionQuality * 0.05);
}

export function buildSignalTrace(
  evidence: AssetEvidence,
  sessionInput?: SessionQualityInput,
): AssetSignalTraceEntry[] {
  const now = Date.now();
  const trace: AssetSignalTraceEntry[] = [];
  if (sessionInput?.hasStructuredOutput) {
    trace.push({ kind: "structured_output", weight: 0.3, at: now });
  }
  if (sessionInput?.hasArtifact) {
    trace.push({ kind: "artifact", weight: 0.35, at: now });
  }
  if (sessionInput?.hasWorkflowLanguage) {
    trace.push({ kind: "workflow_language", weight: 0.15, at: now });
  }
  if (sessionInput?.hasTemplateOrReportLanguage) {
    trace.push({ kind: "template_or_report", weight: 0.25, at: now });
  }
  if (evidence.recurrenceCount > 0) {
    trace.push({ kind: "recurrence", weight: evidence.recurrenceCount * 0.1, at: now });
  }
  if (evidence.userInitiatedSaveCount > 0) {
    trace.push({
      kind: "user_initiated_save",
      weight: evidence.userInitiatedSaveCount * 0.12,
      at: now,
    });
  }
  if (evidence.externalizationCount > 0) {
    trace.push({ kind: "externalization", weight: evidence.externalizationCount * 0.1, at: now });
  }
  if (evidence.collaborationReuseCount > 0) {
    trace.push({
      kind: "collaboration_reuse",
      weight: evidence.collaborationReuseCount * 0.1,
      at: now,
    });
  }
  if (evidence.editPatternStabilityCount > 0) {
    trace.push({
      kind: "edit_pattern_stability",
      weight: evidence.editPatternStabilityCount * 0.08,
      at: now,
    });
  }
  if (evidence.reviewEngineStableCluster) {
    trace.push({ kind: "review_engine_cluster", weight: 0.2, at: now });
  }
  if (meetsL4Adoption(evidence.adoption)) {
    trace.push({ kind: "adoption", weight: 0.25, at: now });
  }
  return trace;
}

export function deriveIncubationDecision(params: {
  evidence?: Partial<AssetEvidence>;
  sessionInput?: SessionQualityInput;
  source?: AssetIncubationSource;
  contextId?: string | null;
  thresholds?: AssetIncubationThresholds;
}): AssetIncubationDecision {
  const thresholds = params.thresholds ?? DEFAULT_INCUBATION_THRESHOLDS;
  const base = createEmptyEvidence();
  const evidence: AssetEvidence = {
    ...base,
    ...params.evidence,
    adoption: {
      ...base.adoption,
      ...params.evidence?.adoption,
    },
    sessionQuality:
      params.evidence?.sessionQuality ??
      (params.sessionInput ? computeSessionQuality(params.sessionInput) : base.sessionQuality),
  };

  const level = deriveLevelFromEvidence(evidence, thresholds);
  return {
    evidence,
    level,
    score: computeScore(level, evidence),
    reason: buildReason(evidence, level),
    signalTrace: buildSignalTrace(evidence, params.sessionInput),
    source: params.source ?? "session-detector",
    contextId: params.contextId ?? null,
  };
}

/** UI: system-suggested primary CTA requires L3+ */
export function shouldShowSystemSuggestCta(decision: AssetIncubationDecision): boolean {
  return decision.level === "L3" || decision.level === "L4";
}

/** UI: weak hint for L2 */
export function shouldShowWeakHint(decision: AssetIncubationDecision): boolean {
  return decision.level === "L2";
}

/** Scorer alone cannot reach L4 — adoption required */
export function isL4WithoutAdoption(evidence: AssetEvidence): boolean {
  const scorerMax = deriveScorerMaxLevel(evidence, DEFAULT_INCUBATION_THRESHOLDS);
  return scorerMax === "L3" && !meetsL4Adoption(evidence.adoption);
}

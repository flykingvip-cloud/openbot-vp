/**
 * Human-gated: only **approved** pattern candidates may become draft skill assets.
 * Draft skills are NOT auto-installed / NOT materialised into the agent runtime.
 */

import { saveSkillAsset, type EmployeeSkillDetail } from "../skill-lifecycle-store.js";
import { getPatternCandidate, updateCandidatePublished } from "./store.js";
import type { PatternCandidate } from "./types.js";

export type PublishPatternCandidateResult = {
  candidate: PatternCandidate;
  skillId: string;
  detail: EmployeeSkillDetail;
};

/**
 * Requires candidate.status === "approved".
 * Creates a draft capability skill with lineage; does NOT create robot relation
 * (autoInstallEnabled: false) so it cannot enter SkillExecutionBinding until
 * explicit install + lifecycle promotion (private/approved/published).
 */
export function publishPatternCandidateAsDraftSkill(params: {
  candidateId: string;
  sourceAgentId?: string | null;
  ownerUserId?: string | null;
}): PublishPatternCandidateResult {
  const candidateId = params.candidateId.trim();
  if (!candidateId) {
    throw new Error("candidateId is required");
  }
  let candidate = getPatternCandidate(candidateId);
  if (!candidate) {
    throw new Error(`pattern candidate ${candidateId} not found`);
  }
  if (candidate.status === "rejected") {
    throw new Error(`pattern candidate ${candidateId} is rejected`);
  }
  if (candidate.status === "published") {
    throw new Error(`pattern candidate ${candidateId} already published`);
  }
  // Hard gate: must be human-approved before any skill asset is created.
  if (candidate.status !== "approved") {
    throw new Error(
      `pattern candidate ${candidateId} must be approved before publish (status=${candidate.status})`,
    );
  }
  if (candidate.independentTaskCount < 3) {
    throw new Error(
      `pattern candidate ${candidateId} lacks independent task evidence (need ≥3, got ${candidate.independentTaskCount})`,
    );
  }

  const lineageId = `pattern-candidate:${candidate.candidateId}`;
  const contract = candidate.contract;
  const prompts = [
    `Reusable skill distilled from ${candidate.independentTaskCount} independent tasks.`,
    `Evidence lineage: ${lineageId}`,
    `Structure key: ${candidate.lineage.structureKey}`,
    candidate.suggestedSummary,
    contract
      ? `Quality: successRate=${contract.quality.successRate ?? "n/a"}, editRate=${contract.quality.humanEditRate ?? "n/a"}, spanMs=${contract.quality.timeSpanMs}`
      : "",
  ].filter(Boolean);

  const saved = saveSkillAsset({
    // Lineage only — do not auto-install onto the robot.
    sourceAgentId: null,
    contextId: lineageId,
    ownerUserId: params.ownerUserId ?? null,
    lifecycle: "draft",
    autoInstallEnabled: false,
    profile: {
      name: candidate.suggestedName || "稳定工作模式",
      summary: candidate.suggestedSummary || "跨多次独立任务沉淀的可执行能力",
      assetType: "capability",
      usageExamples: [
        `基于 ${candidate.independentTaskCount} 次独立任务样本`,
        `候选 ID: ${candidate.candidateId}`,
        ...(contract?.quality.successRate != null
          ? [`样本成功率 ${(contract.quality.successRate * 100).toFixed(0)}%`]
          : []),
      ],
      inputDescription: contract?.inputDescription ?? "与历史稳定任务类似的业务输入",
      outputDescription: contract?.outputDescription ?? "与历史稳定结构一致的业务输出",
      tags: ["pattern-candidate", "evolution", contract?.riskLevel ?? "medium"],
      category: "稳定模式",
      visibility: "private",
    },
    runtimeDefinition: {
      prompts,
      tools: contract?.toolsRequired ?? [],
      workflow: {
        kind: "pattern-candidate",
        candidateId: candidate.candidateId,
        sampleIds: candidate.sampleIds,
        independentRunIds: candidate.independentRunIds,
        contract,
        sourceAgentId: params.sourceAgentId ?? candidate.agentId,
      },
      memoryStrategy: null,
      routingHints: null,
      dependencies: contract?.dependencies ?? [],
      modelPreferences: null,
      executionPolicies: {
        riskLevel: contract?.riskLevel ?? "medium",
        requiresApproval: true,
        source: "pattern-detection",
        replaySampleIds: candidate.sampleIds,
      },
    },
  });

  candidate = updateCandidatePublished(candidateId, saved.skillId);
  return {
    candidate,
    skillId: saved.skillId,
    detail: saved.detail,
  };
}

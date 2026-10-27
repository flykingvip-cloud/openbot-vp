/**
 * 经验有效性策展：反复被 **outcome_verified** 证明有效的经验 → 自动沉淀为**技能草稿**（待人工审核）。
 *
 * W4 口径修正（曝光 ≠ verified）：
 *  - **outcome_verified** = 注入后关联 TaskOutcome closed+eligible 成功（`learning-recall` 阶段记账）；
 *  - 提示词注入只算曝光（injected），**不能**单独触发策展；
 *  - 同一条经验反复出现（多个资产同源）仍可走 occurrence 阈值；
 *  - 达阈值 → 生成 `draft` 状态技能，**不自动发布**，等人工审核（既有 skill lifecycle）。
 * 普通偏好/事实更新不走本策展，也不走实验晋升。
 */

import type { AgentLearningAsset } from "@openbot/collaboration-core";
import { stringValue } from "../records.js";

/** 累计 outcome_verified 次数阈值（跨簇求和）。 */
export const DEFAULT_REUSE_THRESHOLD = 3;
/** @deprecated W4 alias — same as DEFAULT_REUSE_THRESHOLD (verified, not exposure). */
export const DEFAULT_OUTCOME_VERIFIED_THRESHOLD = DEFAULT_REUSE_THRESHOLD;
/** 同一条经验重复出现的资产数阈值。 */
export const DEFAULT_OCCURRENCE_THRESHOLD = 3;

export type SkillDraftCandidate = {
  /** 稳定簇标识，用于幂等（同一簇只策展一次）。 */
  clusterKey: string;
  assetIds: string[];
  botId: string;
  assetType: NonNullable<AgentLearningAsset["assetType"]>;
  /** 触发条件命中的原因，进入草稿说明便于审核者判断。 */
  trigger: "outcome_verified_threshold" | "occurrence_threshold";
  /** Sum of outcomeVerifiedCount across the cluster (not injection/exposure). */
  totalReuse: number;
  occurrences: number;
  title: string;
  lesson: string;
  capabilities: string[];
};

function readText(value: unknown): string | null {
  return stringValue(value);
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

/**
 * 簇标识：优先用结构化的失败原因（同一根因的经验应归为一簇），
 * 否则回落到归一化后的教训正文。
 */
export function resolveClusterKey(asset: AgentLearningAsset): string | null {
  const content = asset.abstractedContent ?? {};
  const source = (content.source ?? {}) as Record<string, unknown>;
  const assetType = asset.assetType ?? "lesson";
  const reason = readText(source.reason);
  if (reason) {
    return `${assetType}::reason::${reason.toLowerCase()}`;
  }
  const lesson = readText(content.lesson) ?? readText(content.title) ?? readText(content.summary);
  if (!lesson) {
    return null;
  }
  const normalized = lesson
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .slice(0, 80);
  return normalized ? `${assetType}::lesson::${normalized}` : null;
}

function isCuratable(asset: AgentLearningAsset): boolean {
  if (asset.status !== undefined && asset.status !== "active") {
    return false;
  }
  // 已策展过的资产不再参与（幂等）。
  return !asset.curatedSkillId;
}

/**
 * 纯函数：从学习资产推导出应当沉淀为技能草稿的候选簇。
 *
 * 只要满足**累计 outcome_verified**或**重复出现**任一阈值即毕业；两个阈值都不满足则不产出，
 * 避免把偶发经验或仅提示词曝光包装成"能力"。
 * `reuseThreshold` 参数名保留兼容，语义已改为 verified 阈值。
 */
export function deriveSkillDraftCandidates(
  assets: AgentLearningAsset[],
  opts?: { reuseThreshold?: number; occurrenceThreshold?: number },
): SkillDraftCandidate[] {
  const reuseThreshold = Math.max(1, opts?.reuseThreshold ?? DEFAULT_REUSE_THRESHOLD);
  const occurrenceThreshold = Math.max(
    1,
    opts?.occurrenceThreshold ?? DEFAULT_OCCURRENCE_THRESHOLD,
  );

  const clusters = new Map<string, AgentLearningAsset[]>();
  for (const asset of assets) {
    if (!isCuratable(asset)) {
      continue;
    }
    const key = resolveClusterKey(asset);
    if (!key) {
      continue;
    }
    // 簇按 bot 隔离：技能是归属到具体机器人的资产。
    const scopedKey = `${asset.botId}::${key}`;
    const bucket = clusters.get(scopedKey);
    if (bucket) {
      bucket.push(asset);
    } else {
      clusters.set(scopedKey, [asset]);
    }
  }

  const candidates: SkillDraftCandidate[] = [];
  for (const [clusterKey, bucket] of clusters) {
    // W4: curation metric is outcome_verified, not prompt injection / legacy reuseCount.
    const totalReuse = bucket.reduce(
      (sum, asset) => sum + Math.max(0, Math.floor(asset.outcomeVerifiedCount ?? 0)),
      0,
    );
    const occurrences = bucket.length;
    const meetsVerified = totalReuse >= reuseThreshold;
    const meetsOccurrence = occurrences >= occurrenceThreshold;
    if (!meetsVerified && !meetsOccurrence) {
      continue;
    }
    const newest = bucket.toSorted(
      (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
    )[0];
    if (!newest) {
      continue;
    }
    const content = newest.abstractedContent ?? {};
    const lesson =
      readText(content.lesson) ?? readText(content.summary) ?? readText(content.title) ?? "";
    if (!lesson) {
      continue;
    }
    candidates.push({
      clusterKey,
      assetIds: bucket.map((asset) => asset.assetId),
      botId: newest.botId,
      assetType: newest.assetType ?? "lesson",
      trigger: meetsVerified ? "outcome_verified_threshold" : "occurrence_threshold",
      totalReuse,
      occurrences,
      title: readText(content.title) ?? lesson.slice(0, 60),
      lesson,
      capabilities: [
        ...new Set([
          ...readStringList(content.capabilities),
          ...readStringList(newest.metadata?.skills),
        ]),
      ],
    });
  }
  return candidates.toSorted((left, right) => right.totalReuse - left.totalReuse);
}

/** 由候选簇构造技能草稿的 profile（纯函数，便于单测与审核预览）。 */
export function buildSkillDraftProfile(candidate: SkillDraftCandidate): {
  name: string;
  summary: string;
  visibility: "private";
  assetType: "skill";
  tags: string[];
  usageExamples: string[];
  inputDescription: string;
  outputDescription: string;
} {
  const reasonLabel =
    candidate.trigger === "outcome_verified_threshold"
      ? `累计验证有效 ${candidate.totalReuse} 次`
      : `重复出现 ${candidate.occurrences} 次`;
  return {
    name: `经验沉淀：${candidate.title}`.slice(0, 120),
    summary: `${candidate.lesson}（${reasonLabel}，由学习资产自动策展，待人工审核）`.slice(0, 500),
    visibility: "private",
    assetType: "skill",
    tags: [...new Set(["经验沉淀", candidate.assetType, ...candidate.capabilities])].slice(0, 10),
    usageExamples: [candidate.lesson].slice(0, 3),
    inputDescription: "触发同类任务时自动参考本经验",
    outputDescription: "遵循该经验的执行结果",
  };
}

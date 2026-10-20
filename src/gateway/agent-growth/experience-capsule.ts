/**
 * 经验提炼：从**失败与驳回**产出候选经验胶囊（Candidate Capsule）。
 *
 * 补齐此前缺失的触发源。原实现只有一条路径——「压缩前 memory flush 完成」——那本质是
 * 顺手存档，不是复盘；仓库里没有任何 failure/rejection → capsule 的通路，也就没有
 * 「我犯了错会被记成别这样干」的实现。
 *
 * 本模块是纯函数（无 I/O），落盘与治理在 `capsule-governance.ts` / backflow 侧。
 * 产出的胶囊一律是 `status: "candidate"`，**不自动晋升**，必须经审批。
 */

import type {
  CapsuleSensitivity,
  CapsuleSourceType,
  GroupMemoryCapsule,
  GroupMemoryCapsuleType,
  ParticipationConfidentialityTier,
} from "@openbot/collaboration-core";
import { redactSecretText } from "../../infra/redact-secret-text.js";

/** 触发经验提炼的事件类型。 */
export type ExperienceTrigger =
  /** 任务执行失败（runner 报错、上下文溢出、资源不可用等）。 */
  | "task_failure"
  /** 交付被评审驳回。 */
  | "review_rejected"
  /** 人类接管——最强的"我干得不好"信号。 */
  | "human_takeover";

export type DeriveCandidateCapsuleInput = {
  trigger: ExperienceTrigger;
  /** 存储作用域：协作群 groupId，或单聊的 `agent:<agentId>` 个人作用域。 */
  scopeId: string;
  botId: string;
  /** 机器可读的失败原因（如 `context_overflow`）。 */
  reason: string;
  /** 人类可读细节；会被截断且不进入提示词以外的地方。 */
  detail?: string | null;
  confidentialityTier?: ParticipationConfidentialityTier;
  sourceIds?: string[];
  participationId?: string;
  capsuleId?: string;
  atMs?: number;
};

const TRIGGER_LABEL: Record<ExperienceTrigger, string> = {
  task_failure: "任务失败",
  review_rejected: "评审驳回",
  human_takeover: "人工接管",
};

/**
 * 失败与驳回记为 `anti_pattern`（"别这样干"）；接管记为 `lesson`（"这里我不够好"）。
 */
const TRIGGER_CAPSULE_TYPE: Record<ExperienceTrigger, GroupMemoryCapsuleType> = {
  task_failure: "anti_pattern",
  review_rejected: "anti_pattern",
  human_takeover: "lesson",
};

const TRIGGER_SOURCE_TYPE: Record<ExperienceTrigger, CapsuleSourceType> = {
  task_failure: "task",
  review_rejected: "review",
  human_takeover: "session",
};

const DETAIL_MAX_CHARS = 600;
const REASON_MAX_CHARS = 120;

function mapTierToSensitivity(
  tier: ParticipationConfidentialityTier | undefined,
): CapsuleSensitivity {
  switch (tier) {
    case "public":
      return "public";
    case "restricted":
      return "restricted";
    case "secret":
      return "secret";
    default:
      return "internal";
  }
}

/**
 * Collapse whitespace, redact secrets, then truncate.
 *
 * Redaction matters here because `detail` is raw runner/provider error text: it is
 * persisted in the capsule, rendered into the agent's system prompt on recall, and
 * in group scopes can be projected into another bot's learning assets. Only
 * transient-HTTP errors are sanitized upstream, so non-transient messages arrive raw.
 * Redaction runs before truncation so a cut mid-token cannot leave a partial key.
 */
function normalizeText(value: string | null | undefined, max: number): string {
  return redactSecretText((value ?? "").replace(/\s+/g, " ").trim()).slice(0, max);
}

/** 由触发信息构造一句话教训（进提示词的就是这句）。 */
export function buildExperienceLesson(params: {
  trigger: ExperienceTrigger;
  reason: string;
  detail?: string | null;
}): string {
  const reason = normalizeText(params.reason, REASON_MAX_CHARS) || "unknown";
  const detail = normalizeText(params.detail, DETAIL_MAX_CHARS);
  const head = `${TRIGGER_LABEL[params.trigger]}（${reason}）`;
  return detail ? `${head}：${detail}` : head;
}

/**
 * 产出候选经验胶囊。
 *
 * 返回 `null` 表示输入不足以形成可复盘的经验（缺作用域/主体/原因），不写垃圾数据。
 */
export function deriveCandidateCapsule(
  input: DeriveCandidateCapsuleInput,
): GroupMemoryCapsule | null {
  const scopeId = input.scopeId.trim();
  const botId = input.botId.trim();
  const reason = normalizeText(input.reason, REASON_MAX_CHARS);
  if (!scopeId || !botId || !reason) {
    return null;
  }
  const now = input.atMs ?? Date.now();
  const summary = buildExperienceLesson({
    trigger: input.trigger,
    reason,
    detail: input.detail,
  });
  const sensitivity = mapTierToSensitivity(input.confidentialityTier);

  return {
    capsuleId: input.capsuleId ?? `experience:${input.trigger}:${now}:${reason}`,
    groupId: scopeId,
    sourceType: TRIGGER_SOURCE_TYPE[input.trigger],
    ...(input.sourceIds && input.sourceIds.length > 0
      ? { sourceIds: [...new Set(input.sourceIds.filter(Boolean))] }
      : {}),
    capsuleType: TRIGGER_CAPSULE_TYPE[input.trigger],
    title: `${TRIGGER_LABEL[input.trigger]}复盘：${reason}`,
    summary,
    structuredContent: {
      trigger: input.trigger,
      reason,
      ...(normalizeText(input.detail, DETAIL_MAX_CHARS)
        ? { detail: normalizeText(input.detail, DETAIL_MAX_CHARS) }
        : {}),
    },
    sensitivity,
    // 失败经验默认可晋升为个人资产；secret 场景不外流。
    reusability: sensitivity === "secret" ? "group_only" : "promotable",
    confidentialityScope: sensitivity === "secret" ? "group" : "tenant",
    createdBy: botId,
    // 关键：候选态。不写 approvedBy/approvedAt —— 自审自批是原实现的问题所在。
    status: "candidate",
    createdAt: now,
    updatedAt: now,
    metadata: {
      origin: "experience_derivation",
      trigger: input.trigger,
      ...(input.participationId ? { sourceParticipationId: input.participationId } : {}),
    },
  };
}

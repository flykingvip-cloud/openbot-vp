/**
 * 企业能力中心 — 审核流程规则（Review Flow Rules）
 *
 * 本模块实现 design.md 中的三条审核流程不变量：
 *
 * - Property 4（Review opinion minimum length）：
 *   审核结果为"拒绝"或"需修改"时，审核意见长度必须 ≥ 10 个字符；
 *   "通过"无最小长度要求。字符长度按 Unicode code point 计（不是 UTF-16 单元），
 *   以避免代理对（emoji 等）被错误地双倍计数。
 *
 * - Property 5（Duplicate review submission rejection）：
 *   同一能力（capabilityId）在审核队列中已存在状态为
 *   "待审核"或"审核中"的任务时，再次提交应被拒绝。
 *
 * - Property 6（Approval requires scope and domain）：
 *   "通过"必须同时携带 `applicableScope` 与 `domain`；
 *   缺一不可。
 *
 * 设计要点：
 * - 全部为纯函数，不依赖任何外部状态或副作用
 * - 严格 TypeScript，禁止使用 any
 * - 仅判定与原因描述，不修改输入
 *
 * Validates: Requirements 14.4, 14.5, 14.9, 19.2
 */

import type {
  ReviewApprovalPayload,
  ReviewQueueItem,
} from "../../capability/enterprise-capability/types.ts";

/**
 * 审核规则统一返回类型。
 *
 * - `ok: true` — 通过校验
 * - `ok: false` — 拒绝；`reason` 为业务语言原因，可直接展示
 */
export type ReviewValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Property 4 最小意见长度（字符）。
 *
 * 与需求 14.5 一致：拒绝/需修改时审核意见至少 10 个字符。
 */
const MIN_OPINION_LENGTH = 10;

/**
 * 计算用户可感知字符数量（grapheme cluster 计数）。
 *
 * String.prototype.length 返回 UTF-16 单元数，会把部分 emoji 或组合字符拆开；
 * Intl.Segmenter 按 grapheme 切分，更符合"审核意见字符数"的业务语义。
 */
function countVisibleCharacters(value: string): number {
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
  let count = 0;
  for (const _segment of segmenter.segment(value)) {
    count += 1;
  }
  return count;
}

/**
 * Property 4 — 审核意见最小长度。
 *
 * - `result === "通过"` → 不校验长度（即使为空亦可）
 * - `result === "拒绝"` 或 `"需修改"` → 意见长度必须 ≥ 10 字符
 *
 * 字符串前后空白会被 trim 后再计数，避免靠空格凑长度的情况。
 */
export function validateReviewOpinion(
  result: "通过" | "拒绝" | "需修改",
  opinion: string,
): ReviewValidationResult {
  if (result === "通过") {
    return { ok: true };
  }

  const trimmed = typeof opinion === "string" ? opinion.trim() : "";
  if (countVisibleCharacters(trimmed) < MIN_OPINION_LENGTH) {
    return {
      ok: false,
      reason: `审核意见至少需要 ${MIN_OPINION_LENGTH} 个字符`,
    };
  }
  return { ok: true };
}

/**
 * Property 5 — 重复提交审核校验。
 *
 * 当 `existingTasks` 中已存在与 `capabilityId` 匹配且状态为
 * "待审核"或"审核中"的任务时，拒绝再次提交。
 *
 * 返回 `{ ok: true }` 表示允许新建审核任务；
 * 返回 `{ ok: false }` 表示拒绝并应向员工提示"当前已有审核任务进行中"。
 */
export function isDuplicateReviewAllowed(
  existingTasks: ReviewQueueItem[],
  capabilityId: string,
): ReviewValidationResult {
  const hasOngoing = existingTasks.some(
    (task) =>
      task.capabilityId === capabilityId && (task.status === "待审核" || task.status === "审核中"),
  );

  if (hasOngoing) {
    return { ok: false, reason: "当前已有审核任务进行中" };
  }
  return { ok: true };
}

/**
 * 判定 ApplicableScope 是否被视为"已指定"。
 *
 * - `enterprise` 视为已指定
 * - `department / group / role` 必须有非空的 `id` 才视为已指定
 */
function isScopeFilled(payload: ReviewApprovalPayload): boolean {
  const scope = payload.applicableScope;
  if (!scope || typeof scope.kind !== "string") {
    return false;
  }
  if (scope.kind === "enterprise") {
    return true;
  }
  return typeof scope.id === "string" && scope.id.trim().length > 0;
}

/**
 * Property 6 — 审核通过必须同时指定 ApplicableScope 与 CapabilityDomain。
 *
 * 当 payload 为 null/undefined，或缺少 scope/domain 任一字段时拒绝。
 * 调用方应在管理员点击"通过"时调用本函数，作为发布前的最后校验。
 */
export function validateApprovalPayload(
  payload: ReviewApprovalPayload | null | undefined,
): ReviewValidationResult {
  if (!payload) {
    return { ok: false, reason: "请先指定适用范围与能力领域后再通过" };
  }

  const missing: string[] = [];
  if (!isScopeFilled(payload)) {
    missing.push("适用范围");
  }
  if (typeof payload.domain !== "string" || payload.domain.length === 0) {
    missing.push("能力领域");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `审核通过缺少必填项：${missing.join("、")}`,
    };
  }

  return { ok: true };
}

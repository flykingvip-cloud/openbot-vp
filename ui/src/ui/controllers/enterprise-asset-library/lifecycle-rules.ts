/**
 * 企业能力中心 — 生命周期与溯源规则（Lifecycle & Source Rules）
 *
 * 本模块实现 design.md 中两条核心不变量：
 *
 * - Property 2（Lifecycle source completeness guard）：
 *   能力资产进入 `published` 生命周期前，溯源信息必须完整：
 *   `source.employee`、`source.robot`、`source.task` 全部具备 id，
 *   且 `contributionHistory` 至少包含一条记录。任一条件不满足则拒绝。
 *
 * - Property 3（Source immutability invariant）：
 *   一旦写入，`source.employee`、`source.robot`、`source.task` 与已有
 *   `contributionHistory` 条目均不可修改或删除；仅允许追加新的贡献记录。
 *   贡献记录通过 `id` 字段进行身份比对。
 *
 * 设计要点：
 * - 全部为纯函数，不依赖任何外部状态或副作用
 * - 严格 TypeScript，禁止使用 any
 * - 仅负责"判定与原因"，不负责状态变更或 I/O
 *
 * Validates: Requirements 1.2, 1.3, 1.6
 */

import type {
  ContributionRecord,
  EnterpriseCapabilityAsset,
} from "../../capability/enterprise-capability/types.ts";

/**
 * 生命周期/溯源规则的统一返回类型。
 *
 * - `ok: true` — 规则通过
 * - `ok: false` — 规则拒绝；`reason` 为业务语言原因，可直接展示给管理员
 * - `missing` — 仅 Property 2 在缺失溯源字段时填充，便于 UI 高亮指示
 */
export type LifecycleValidationResult =
  | { ok: true }
  | { ok: false; reason: string; missing?: string[] };

/** 校验"溯源完整性"所需的资产投影 */
export type SourceCompletenessInput = Pick<
  EnterpriseCapabilityAsset,
  "source" | "contributionHistory"
>;

/**
 * 判定单个 id 字符串是否被视为"已填充"。
 *
 * 空串、纯空白都视为未填充，与"必填字段"的业务语义保持一致。
 */
function isFilledId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Property 2 — 转换至 `published` 状态前的溯源完整性守卫。
 *
 * 检查以下字段，任一缺失即拒绝：
 *
 * - `source.employee.id`（来源员工）
 * - `source.robot.id`（来源机器人）
 * - `source.task.id`（来源任务）
 * - `contributionHistory` 至少包含一条记录
 *
 * 当存在缺失时，`missing` 数组列出缺失字段的业务标签，
 * 调用方可据此组装"以下溯源字段缺失：xxx、yyy"形式的提示。
 *
 * 当上述全部满足时，本函数返回 `{ ok: true }`；
 * 注意：仅判定溯源完整性，不判定生命周期当前是否已是 `published`。
 */
export function canTransitionToPublished(
  asset: SourceCompletenessInput,
): LifecycleValidationResult {
  const missing: string[] = [];

  if (!isFilledId(asset.source.employee?.id)) {
    missing.push("来源员工");
  }
  if (!isFilledId(asset.source.robot?.id)) {
    missing.push("来源机器人");
  }
  if (!isFilledId(asset.source.task?.id)) {
    missing.push("来源任务");
  }
  if (!Array.isArray(asset.contributionHistory) || asset.contributionHistory.length === 0) {
    missing.push("贡献记录");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `溯源信息不完整：${missing.join("、")}`,
      missing,
    };
  }

  return { ok: true };
}

/** 校验"溯源不可变性"所需的资产投影 */
export type SourceImmutabilityInput = Pick<
  EnterpriseCapabilityAsset,
  "source" | "contributionHistory"
>;

/**
 * 比对两个 ContributionRecord 是否在不可变字段上完全一致。
 *
 * 由于条目一旦写入即不可变更，所有可见字段都必须严格相等。
 */
function isSameContributionRecord(a: ContributionRecord, b: ContributionRecord): boolean {
  return (
    a.id === b.id &&
    a.employeeId === b.employeeId &&
    a.employeeName === b.employeeName &&
    a.timestamp === b.timestamp &&
    a.type === b.type &&
    a.summary === b.summary
  );
}

/**
 * Property 3 — 溯源不可变性约束。
 *
 * 比对 `existing` 与 `incoming`，在以下任一情形下拒绝：
 *
 * - `source.employee` / `source.robot` / `source.task` 任一字段被修改
 *   （比对 id 与 name，以及 task 的 summary）
 * - `existing.contributionHistory` 中的任意条目在 `incoming` 中被
 *   删除或被修改（按 `id` 进行身份匹配）
 *
 * 仅在 `incoming.contributionHistory` 中**追加**新条目（id 不在 existing 中）
 * 是被允许的。
 */
export function enforceSourceImmutability(
  existing: SourceImmutabilityInput,
  incoming: SourceImmutabilityInput,
): LifecycleValidationResult {
  // 1. source.employee 不可变
  if (
    existing.source.employee.id !== incoming.source.employee.id ||
    existing.source.employee.name !== incoming.source.employee.name
  ) {
    return { ok: false, reason: "来源员工信息不可修改" };
  }

  // 2. source.robot 不可变
  if (
    existing.source.robot.id !== incoming.source.robot.id ||
    existing.source.robot.name !== incoming.source.robot.name
  ) {
    return { ok: false, reason: "来源机器人信息不可修改" };
  }

  // 3. source.task 不可变（含 summary）
  if (
    existing.source.task.id !== incoming.source.task.id ||
    existing.source.task.summary !== incoming.source.task.summary
  ) {
    return { ok: false, reason: "来源任务信息不可修改" };
  }

  // 4. 贡献历史：已有条目不可删除/修改，仅允许追加
  const incomingById = new Map<string, ContributionRecord>();
  for (const record of incoming.contributionHistory) {
    incomingById.set(record.id, record);
  }

  for (const original of existing.contributionHistory) {
    const matched = incomingById.get(original.id);
    if (!matched) {
      return {
        ok: false,
        reason: `贡献记录不可删除：${original.id}`,
      };
    }
    if (!isSameContributionRecord(original, matched)) {
      return {
        ok: false,
        reason: `贡献记录不可修改：${original.id}`,
      };
    }
  }

  return { ok: true };
}

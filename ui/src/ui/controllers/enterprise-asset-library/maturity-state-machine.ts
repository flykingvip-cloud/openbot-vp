/**
 * 企业能力中心 — 成熟度状态机（Maturity State Machine）
 *
 * 本模块实现 design.md 中的三条核心不变量：
 *
 * - Property 9（Level calculation）：
 *   基于 5 个度量指标（累计使用次数 / 使用员工数 / 复用率 / 成功率 / 企业采用率），
 *   `calculateMaturity` 返回所有阈值同时被满足的最高自动等级。
 *   "企业认证(4)" 与 "企业标准(5)" 为管理员主动授予的手动等级，
 *   自动计算上限为 "多人复用(3)"；当指标继续达到 "核心资产(6)" 阈值后，
 *   自动计算可越过手动段直达 "核心资产"。
 *
 * - Property 10a（Certified promotion gate）：
 *   `canPromoteToCertified` — 仅当资产当前成熟度为 "稳定使用" 或 "多人复用"
 *   时才允许标记为 "企业认证"；
 *   未达 "稳定使用" 或已超出（自动达到 "核心资产"）均被拒绝。
 *
 * - Property 10b（Standard promotion gate）：
 *   `canPromoteToStandard` — 仅当资产当前成熟度为 "企业认证" 时才允许
 *   标记为 "企业标准"，确保不可跳级。
 *
 * - Property 11 辅助：`compareMaturity` 提供 6 级序数比较，
 *   遵循 `初步形成(1) < 稳定使用(2) < 多人复用(3) < 企业认证(4) < 企业标准(5) < 核心资产(6)`
 *   的全序关系，供排序与守卫共用。
 *
 * 设计要点：
 * - 全部为纯函数，不依赖任何外部状态或副作用
 * - 严格 TypeScript，禁止使用 any
 * - 仅判定与原因描述，不修改输入
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.9, 5.10, 19.3
 */

import type {
  CapabilityMaturity,
  EnterpriseCapabilityAsset,
} from "../../capability/enterprise-capability/types.ts";

/**
 * 自动计算所需的成熟度度量指标。
 *
 * - `usageCount` — 累计使用次数（非负整数）
 * - `userCount` — 使用过该能力的员工总数（非负整数）
 * - `reuseRate` — 复用率（0–100，单位 %），即被不同机器人安装的比例
 * - `successRate` — 成功率（0–100，单位 %），最近窗口内调用成功比例
 * - `adoptionRate` — 企业采用率（0–100，单位 %），覆盖部门或角色的比例
 */
export type MaturityMetrics = {
  usageCount: number;
  userCount: number;
  reuseRate: number;
  successRate: number;
  adoptionRate: number;
};

/**
 * 单一成熟度等级所需的最低阈值。
 *
 * 当 `MaturityMetrics` 的全部 5 个字段同时大于等于对应的 `min*` 字段时，
 * 视为满足该等级的自动晋升条件。
 */
export type MaturityThreshold = {
  minUsageCount: number;
  minUserCount: number;
  minReuseRate: number;
  minSuccessRate: number;
  minAdoptionRate: number;
};

/**
 * 6 级成熟度阈值表（与 design.md 对齐）。
 *
 * 注意：
 * - "企业认证" 与 "企业标准" 标注为手动等级，阈值仅用于参考校验；
 *   自动计算流程（calculateMaturity）会跳过这两级。
 * - "核心资产" 的指标必须在自动段（达到 "多人复用" 之后）继续放大，
 *   方可由系统自动晋升。
 */
export const MATURITY_THRESHOLDS: Record<CapabilityMaturity, MaturityThreshold> = {
  初步形成: {
    minUsageCount: 0,
    minUserCount: 0,
    minReuseRate: 0,
    minSuccessRate: 0,
    minAdoptionRate: 0,
  },
  稳定使用: {
    minUsageCount: 30,
    minUserCount: 3,
    minReuseRate: 0,
    minSuccessRate: 80,
    minAdoptionRate: 0,
  },
  多人复用: {
    minUsageCount: 100,
    minUserCount: 10,
    minReuseRate: 30,
    minSuccessRate: 85,
    minAdoptionRate: 10,
  },
  // 手动等级：企业管理员主动授予，自动计算流程不会返回该等级
  企业认证: {
    minUsageCount: 300,
    minUserCount: 20,
    minReuseRate: 40,
    minSuccessRate: 90,
    minAdoptionRate: 20,
  },
  // 手动等级：企业管理员主动授予，前置条件为已达 "企业认证"
  企业标准: {
    minUsageCount: 500,
    minUserCount: 30,
    minReuseRate: 50,
    minSuccessRate: 92,
    minAdoptionRate: 30,
  },
  核心资产: {
    minUsageCount: 1_000,
    minUserCount: 40,
    minReuseRate: 60,
    minSuccessRate: 95,
    minAdoptionRate: 50,
  },
};

/**
 * 成熟度等级的 1–6 序数映射，用于全序比较。
 *
 * 与 `ui/src/ui/controllers/enterprise-asset-library/ordering-utils.ts`
 * 中的 `MATURITY_ORDER` 在数值上保持完全一致；此处独立定义以让
 * 状态机模块自包含，避免跨模块循环依赖。
 */
const MATURITY_RANK: Record<CapabilityMaturity, number> = {
  初步形成: 1,
  稳定使用: 2,
  多人复用: 3,
  企业认证: 4,
  企业标准: 5,
  核心资产: 6,
};

/**
 * 自动计算的等级遍历顺序（由高到低，已剔除手动授予等级）。
 *
 * "企业认证" 与 "企业标准" 由管理员主动授予，不参与自动计算；
 * 顺序与 `MATURITY_RANK` 倒序对齐，便于 `calculateMaturity` 取"首个满足全部阈值"的等级。
 */
const AUTO_LEVELS_DESCENDING: readonly CapabilityMaturity[] = ["核心资产", "多人复用", "稳定使用"];

/**
 * 提升类规则的统一返回类型。
 *
 * - `ok: true` — 通过校验
 * - `ok: false` — 拒绝；`reason` 为业务语言原因，可直接展示给管理员
 */
export type PromotionResult = { ok: true } | { ok: false; reason: string };

/**
 * 判定单组指标是否满足某等级的全部阈值。
 *
 * 任何一项未达 `min*` 都视为不满足；用 `>=` 进行比较，与"达到阈值即合格"的语义一致。
 */
function meetsThreshold(metrics: MaturityMetrics, threshold: MaturityThreshold): boolean {
  return (
    metrics.usageCount >= threshold.minUsageCount &&
    metrics.userCount >= threshold.minUserCount &&
    metrics.reuseRate >= threshold.minReuseRate &&
    metrics.successRate >= threshold.minSuccessRate &&
    metrics.adoptionRate >= threshold.minAdoptionRate
  );
}

/**
 * Property 9 — 基于度量指标自动计算成熟度等级。
 *
 * 算法步骤：
 *
 * 1. 按照 `AUTO_LEVELS_DESCENDING`（核心资产 → 多人复用 → 稳定使用）遍历自动等级；
 * 2. 对每个等级，调用 `meetsThreshold` 判定指标是否满足全部阈值；
 * 3. 命中的第一个等级即为结果（保证返回所有阈值同时被满足的最高自动等级）；
 * 4. 若无任何自动等级被满足，回落到默认值 "初步形成"。
 *
 * 注意：自动计算永远不会返回 "企业认证" 或 "企业标准"，
 * 即便指标已达到对应阈值——这两级必须由管理员手动授予。
 */
export function calculateMaturity(metrics: MaturityMetrics): CapabilityMaturity {
  for (const level of AUTO_LEVELS_DESCENDING) {
    if (meetsThreshold(metrics, MATURITY_THRESHOLDS[level])) {
      return level;
    }
  }
  return "初步形成";
}

/**
 * 比较两个成熟度等级的高低。
 *
 * 返回值与 `Array.prototype.sort` 比较器约定一致：
 *
 * - 负数：`a < b`
 * - 零：`a === b`
 * - 正数：`a > b`
 *
 * 例如：`compareMaturity("稳定使用", "核心资产") < 0`。
 */
export function compareMaturity(a: CapabilityMaturity, b: CapabilityMaturity): number {
  return MATURITY_RANK[a] - MATURITY_RANK[b];
}

/**
 * Property 10a — "企业认证" 提升守卫。
 *
 * 仅当资产当前成熟度处于自动晋升的中段（"稳定使用" 或 "多人复用"）时，
 * 才允许管理员将其手动标记为 "企业认证"：
 *
 * - "初步形成" — 指标未达 "稳定使用"，拒绝晋升以防越级；
 * - "企业认证 / 企业标准 / 核心资产" — 已超出 "企业认证" 入口，
 *   不应再次执行该晋升动作。
 *
 * 拒绝时返回 design.md 错误处理表中给定的标准业务语言原因，
 * 便于上层 UI 直接展示。
 */
export function canPromoteToCertified(
  asset: Pick<EnterpriseCapabilityAsset, "maturity">,
): PromotionResult {
  if (asset.maturity === "稳定使用" || asset.maturity === "多人复用") {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "能力尚未达到稳定使用等级，无法标记为企业认证",
  };
}

/**
 * Property 10b — "企业标准" 提升守卫。
 *
 * 仅当资产当前成熟度恰好为 "企业认证" 时才允许晋升至 "企业标准"，
 * 确保管理员无法跳过 "企业认证" 直接将能力标记为 "企业标准"。
 *
 * 拒绝时返回 design.md 错误处理表中给定的标准业务语言原因。
 */
export function canPromoteToStandard(
  asset: Pick<EnterpriseCapabilityAsset, "maturity">,
): PromotionResult {
  if (asset.maturity === "企业认证") {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "能力尚未达到企业认证等级，无法标记为企业标准",
  };
}

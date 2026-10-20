/**
 * 企业能力中心 — 健康状态映射（Health Status Mapping）
 *
 * 本模块实现两条核心规则（design.md 中的 Property 15 与 Property 16）：
 *
 * - Property 16：将运行时健康遥测数据映射为业务效果语言（EnterpriseHealthStatus）。
 *   严禁向企业管理员暴露任何工程术语（healthy/warning/broken/error rate 等）；
 *   输出仅使用业务效果标签："效果稳定 / 偶尔结果不理想 / 建议重新整理 / 已不适合继续推广"。
 *
 * - Property 15：当能力的 healthManualLock 为 true 时，自动遥测映射不得覆盖
 *   管理员手动设置的健康状态，直到锁定被显式释放。
 *
 * 设计要点：
 * - 全部为纯函数，不依赖外部状态
 * - 严格 TypeScript，禁止使用 any
 * - 标签字符串与 ../../capability/enterprise-capability/types.ts 中的
 *   EnterpriseHealthStatus 联合类型保持完全一致
 *
 * Validates: Requirements 6.3, 6.6, 6.7, 20.1
 */

import type { EnterpriseHealthStatus } from "../../capability/enterprise-capability/types.ts";

/**
 * 24 小时窗口内的运行时健康遥测数据。
 *
 * - successRate24h：近 24 小时成功率，百分比，取值范围 0–100
 * - consecutiveFailures：当前连续失败次数（≥ 0）
 * - hasCriticalDependencyIssue：关键依赖是否持续不可用
 * - hasKnownImprovablePattern：是否存在已知可改进模式（如重复性低质量输出）
 */
export type HealthTelemetry = {
  successRate24h: number;
  consecutiveFailures: number;
  hasCriticalDependencyIssue: boolean;
  hasKnownImprovablePattern: boolean;
};

/**
 * Property 16 — 健康遥测 → 业务效果状态映射。
 *
 * 优先级（从最严重到最稳定）：
 *  1. 关键依赖持续不可用 → "已不适合继续推广"
 *  2. successRate24h < 50%        → "已不适合继续推广"
 *  3. 存在已知可改进模式            → "建议重新整理"
 *  4. 50% ≤ successRate24h < 70%   → "建议重新整理"
 *  5. 70% ≤ successRate24h < 95% 且 consecutiveFailures < 3 → "偶尔结果不理想"
 *  6. 70% ≤ successRate24h < 95% 且 consecutiveFailures ≥ 3 → "建议重新整理"
 *  7. successRate24h ≥ 95% 且 consecutiveFailures = 0       → "效果稳定"
 *  8. 默认兜底（极少触发）         → "偶尔结果不理想"
 *
 * 严格按照设计文档的优先级顺序判定，一旦命中即返回，不再向下匹配。
 */
export function mapTelemetryToHealthStatus(telemetry: HealthTelemetry): EnterpriseHealthStatus {
  const {
    successRate24h,
    consecutiveFailures,
    hasCriticalDependencyIssue,
    hasKnownImprovablePattern,
  } = telemetry;

  // 1. 关键依赖不可用 — 最高严重级别
  if (hasCriticalDependencyIssue) {
    return "已不适合继续推广";
  }

  // 2. 成功率低于 50% — 已不适合继续推广
  if (successRate24h < 50) {
    return "已不适合继续推广";
  }

  // 3. 存在已知可改进模式 — 建议重新整理
  if (hasKnownImprovablePattern) {
    return "建议重新整理";
  }

  // 4. 成功率 50%–69% — 建议重新整理
  if (successRate24h >= 50 && successRate24h < 70) {
    return "建议重新整理";
  }

  // 5–6. 成功率 70%–94%：根据连续失败次数细分
  if (successRate24h >= 70 && successRate24h < 95) {
    return consecutiveFailures < 3 ? "偶尔结果不理想" : "建议重新整理";
  }

  // 7. 成功率 ≥ 95% 且无连续失败 — 效果稳定
  if (successRate24h >= 95 && consecutiveFailures === 0) {
    return "效果稳定";
  }

  // 8. 兜底：例如 successRate24h ≥ 95% 但仍有偶发失败
  return "偶尔结果不理想";
}

/**
 * Property 15 — 手动锁定覆盖。
 *
 * 当 manualLock 为 true，管理员手动设置的状态必须保留，自动映射结果不得生效；
 * 当 manualLock 为 false，返回自动映射结果。
 *
 * 该函数是纯转换器：调用方负责管理 manualLock 的生命周期（由管理员显式释放）。
 */
export function applyManualLockOverride(
  autoMapped: EnterpriseHealthStatus,
  manualStatus: EnterpriseHealthStatus,
  manualLock: boolean,
): EnterpriseHealthStatus {
  return manualLock ? manualStatus : autoMapped;
}

/**
 * 无遥测数据时的默认健康状态。
 *
 * 适用场景：能力新上架或从未被调用，尚无任何运行时遥测数据。
 *
 * 注意：调用方应同时在对应的 EnterpriseCapabilityAsset 上设置
 * `healthNoTelemetry: true`，以便展示层呈现"暂无运行数据"标识。
 * 本函数仅返回基础状态，标识字段由调用方维护。
 */
export function defaultStatusWhenNoTelemetry(): EnterpriseHealthStatus {
  return "效果稳定";
}

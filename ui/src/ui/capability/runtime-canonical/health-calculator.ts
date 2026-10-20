/**
 * Runtime Health Calculator — 将 `RuntimeTelemetry` 映射为 `RuntimeHealth` 的纯函数。
 *
 * 该计算器是企业端 `EnterpriseHealthStatus` 与员工端 `CapabilityHealthLabel`
 * 数据流的源头：所有下游层都不应自行计算健康状态，必须通过本计算器输出
 * `RuntimeHealth`，再经 `projection.ts` 投影到下游业务标签。
 *
 * 算法概述（保证单调性 — Property 4）：
 * 1. 当成功率显著低于阈值（< 50%）或队列严重阻塞 → `unavailable`
 * 2. 当成功率介于 50%–70% 或内存压力极高 → `unhealthy`
 * 3. 当成功率介于 70%–95% 或平均延迟超阈值 → `degraded`
 * 4. 其余情况 → `healthy`
 *
 * 阈值采用"由严到宽"短路判断顺序：先检测最严重的状况，命中即返回。这样能
 * 保证 successRate 单调上升时，输出健康度也单调上升（不会跳转回更差的状态）。
 *
 * 阈值可由调用方传入 `Partial<HealthThresholds>` 覆盖默认值（`DEFAULT_HEALTH_THRESHOLDS`），
 * 便于不同业务场景调优；未提供的字段保持默认。
 */

import type { RuntimeHealth, RuntimeTelemetry } from "./types.ts";

/**
 * 健康计算阈值。
 *
 * 字段语义（默认值见 {@link DEFAULT_HEALTH_THRESHOLDS}）：
 * - `healthySuccessRate`     成功率上界，≥ 此值且无其他劣化项 → `healthy`
 * - `degradedSuccessRate`    成功率下界（degraded 区间），[此值, healthySuccessRate) → `degraded`
 * - `unhealthySuccessRate`   成功率最低线，[此值, degradedSuccessRate) → `unhealthy`，< 此值 → `unavailable`
 * - `latencyThresholdMs`     平均延迟上限，超过此值且 successRate ≥ degraded 但 < healthy → `degraded`
 * - `unavailableQueueDepth`  队列堆积上限，超过即视为 `unavailable`（外部依赖异常导致请求积压）
 * - `unhealthyMemoryPressure` 内存压力上限 [0, 1]，超过即视为 `unhealthy`
 */
export type HealthThresholds = {
  healthySuccessRate: number;
  degradedSuccessRate: number;
  unhealthySuccessRate: number;
  latencyThresholdMs: number;
  unavailableQueueDepth: number;
  unhealthyMemoryPressure: number;
};

/**
 * 默认阈值。所有阈值均为闭/开区间端点（详见 {@link calculateRuntimeHealth} 中的判定顺序）。
 *
 * 选择理由：
 * - 0.95 / 0.70 / 0.50 与企业端 `EnterpriseCapabilityProjection` 中健康标签
 *   定义保持口径一致，便于跨层一致性比对。
 * - 5000ms 平均延迟在多数 LLM 场景下为可接受上限。
 * - 队列深度 1000 为典型异步处理场景的告警水位。
 * - 内存压力 0.9 表示已逼近 OOM。
 */
export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  healthySuccessRate: 0.95,
  degradedSuccessRate: 0.7,
  unhealthySuccessRate: 0.5,
  latencyThresholdMs: 5_000,
  unavailableQueueDepth: 1_000,
  unhealthyMemoryPressure: 0.9,
};

/**
 * 计算 RuntimeHealth。纯函数：相同输入永远返回相同输出，不依赖外部状态。
 *
 * 单调性保证（Property 4）：
 * 当其他指标固定，仅 `successRate7d` 上升时，输出健康度只会单调向 `healthy`
 * 方向移动（healthy > degraded > unhealthy > unavailable，按"更健康"排序）。
 * 这是因为本函数对 successRate 采用阶梯阈值，且不存在反向条件。
 *
 * @param telemetry  Runtime 遥测样本
 * @param overrides  可选的阈值覆盖；未指定的字段使用 {@link DEFAULT_HEALTH_THRESHOLDS}
 * @returns          运行时健康状态
 */
export function calculateRuntimeHealth(
  telemetry: RuntimeTelemetry,
  overrides?: Partial<HealthThresholds>,
): RuntimeHealth {
  const t: HealthThresholds = { ...DEFAULT_HEALTH_THRESHOLDS, ...overrides };

  // 第 1 级：unavailable —— 只要满足下列任一最严重条件即立刻返回。
  if (telemetry.successRate7d < t.unhealthySuccessRate) {
    return "unavailable";
  }
  if (telemetry.queueDepth > t.unavailableQueueDepth) {
    return "unavailable";
  }

  // 第 2 级：unhealthy —— 成功率仍未恢复到 degraded 区间，或内存压力过高。
  if (telemetry.successRate7d < t.degradedSuccessRate) {
    return "unhealthy";
  }
  if (telemetry.memoryPressure > t.unhealthyMemoryPressure) {
    return "unhealthy";
  }

  // 第 3 级：degraded —— 成功率尚未达到健康线，或平均延迟超阈值。
  if (telemetry.successRate7d < t.healthySuccessRate) {
    return "degraded";
  }
  if (telemetry.avgLatencyMs > t.latencyThresholdMs) {
    return "degraded";
  }

  // 第 4 级：healthy —— 所有阈值均通过。
  return "healthy";
}

/**
 * RuntimeHealth 严重度排序（数值越大越健康）。可用于比较两个状态的相对位置，
 * 例如属性测试中验证单调性。
 *
 * 排序：unavailable(0) < unhealthy(1) < degraded(2) < healthy(3)
 */
export const RUNTIME_HEALTH_RANK: Readonly<Record<RuntimeHealth, number>> = {
  unavailable: 0,
  unhealthy: 1,
  degraded: 2,
  healthy: 3,
} as const;

/** 比较两个 RuntimeHealth：a 是否至少和 b 一样健康。 */
export function isAtLeastAsHealthy(a: RuntimeHealth, b: RuntimeHealth): boolean {
  return RUNTIME_HEALTH_RANK[a] >= RUNTIME_HEALTH_RANK[b];
}

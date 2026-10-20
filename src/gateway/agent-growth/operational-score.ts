/**
 * Agent Growth OS — operationalScore（spec: agent-growth-lifecycle, P2 任务 12.1/12.2）。
 *
 * 实战表现分（0–100），与 activationScore（配置完成度）正交（design §4）。
 * 仅在有真实信号时计算；无任何信号时返回 null（保持 P0/P1 的 null 契约，不伪造数据）。
 *
 * 权重（P2 文档化，design §4.1）：
 *  - 任务成功率 taskSuccessRate     0.40
 *  - 工具成功率 toolSuccessRate     0.30
 *  - 满意度     satisfaction        0.20
 *  - 人工接管率 humanTakeoverRate   0.10（反向：接管越多分越低，计入 1 - rate）
 * 实际按「出现的信号」归一化，缺失信号不拉低分母。
 */

export type OperationalScoreSignals = {
  /** 任务成功率 0–1。 */
  taskSuccessRate?: number | null;
  /** 工具调用成功率 0–1。 */
  toolSuccessRate?: number | null;
  /** 用户满意度 0–1。 */
  satisfaction?: number | null;
  /** 人工接管率 0–1（越高越差）。 */
  humanTakeoverRate?: number | null;
};

const WEIGHTS = {
  taskSuccessRate: 0.4,
  toolSuccessRate: 0.3,
  satisfaction: 0.2,
  humanTakeoverRate: 0.1,
} as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function present(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 计算 operationalScore（0–100）。无任何信号 → null。
 * humanTakeoverRate 反向计入（贡献 1 - rate）。
 */
export function computeOperationalScore(signals?: OperationalScoreSignals): number | null {
  if (!signals) {
    return null;
  }
  let weighted = 0;
  let totalWeight = 0;

  if (present(signals.taskSuccessRate)) {
    weighted += clamp01(signals.taskSuccessRate) * WEIGHTS.taskSuccessRate;
    totalWeight += WEIGHTS.taskSuccessRate;
  }
  if (present(signals.toolSuccessRate)) {
    weighted += clamp01(signals.toolSuccessRate) * WEIGHTS.toolSuccessRate;
    totalWeight += WEIGHTS.toolSuccessRate;
  }
  if (present(signals.satisfaction)) {
    weighted += clamp01(signals.satisfaction) * WEIGHTS.satisfaction;
    totalWeight += WEIGHTS.satisfaction;
  }
  if (present(signals.humanTakeoverRate)) {
    weighted += (1 - clamp01(signals.humanTakeoverRate)) * WEIGHTS.humanTakeoverRate;
    totalWeight += WEIGHTS.humanTakeoverRate;
  }

  if (totalWeight <= 0) {
    return null;
  }
  return Math.round((weighted / totalWeight) * 100);
}

/**
 * 三阶自调：把二阶反馈(行为改变有效性统计)反哺为 operationalScore 的有界调整量（分）。
 * 净有效性 =(improved-regressed)/assessed ∈[-1,1] → 线性映射到 [-MAX, +MAX]。样本不足则返回 0。
 */
export const ADAPTIVITY_MAX_ADJUST = 6;
export const ADAPTIVITY_MIN_SAMPLES = 3;

export function computeAdaptivityAdjustment(stats?: {
  improvedCount: number;
  regressedCount: number;
  assessedCount: number;
}): number {
  if (!stats || stats.assessedCount < ADAPTIVITY_MIN_SAMPLES) {
    return 0;
  }
  const net = (stats.improvedCount - stats.regressedCount) / stats.assessedCount;
  const clampedNet = Math.max(-1, Math.min(1, net));
  return Math.round(clampedNet * ADAPTIVITY_MAX_ADJUST);
}

/** false-ready 阈值（design §16）：配置满分但实战很差。 */
export const FALSE_READY_ACTIVATION_MIN = 90;
export const FALSE_READY_OPERATIONAL_MAX = 30;

/**
 * 检测「虚假就绪」：activationScore 很高但 operationalScore 很低。
 * operationalScore 为 null（无数据）时不判定（返回 false），避免无数据误报。
 */
export function detectFalseReady(
  activationScore: number,
  operationalScore: number | null,
): boolean {
  if (operationalScore === null) {
    return false;
  }
  return (
    activationScore >= FALSE_READY_ACTIVATION_MIN && operationalScore < FALSE_READY_OPERATIONAL_MAX
  );
}

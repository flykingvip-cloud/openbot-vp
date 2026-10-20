// ui/src/ui/controllers/enterprise-incubation/incubation-score.ts

export type ScoreInput = {
  /** 使用机器人数 */
  robotCount: number;
  /** 使用员工数 */
  employeeCount: number;
  /** 近 30 天成功率 (0-1) */
  successRate30d: number;
  /** 成功率波动幅度 (标准差) */
  successRateStdDev: number;
  /** 覆盖机器人数（字段名 departmentCount 为兼容） */
  departmentCount: number;
  /** 覆盖角色数 */
  roleCount: number;
  /** 员工主动安装率 (0-1)，null 表示无数据 */
  installRate: number | null;
  /** 持续使用天数 */
  continuousUsageDays: number | null;
};

export type ScoreDimension = {
  value: number; // 0-100
  available: boolean; // 是否有足够数据
};

export type IncubationScore = {
  reuseBreath: ScoreDimension;
  effectStability: ScoreDimension;
  businessCoverage: ScoreDimension;
  employeeSatisfaction: ScoreDimension;
  compositeScore: number;
};

export const WEIGHTS = {
  reuseBreath: 0.3,
  effectStability: 0.3,
  businessCoverage: 0.2,
  employeeSatisfaction: 0.2,
} as const;

/**
 * 计算复用广度分数 (0-100)
 * 基于使用机器人数与使用员工数加权计算
 */
export function calcReuseBreath(robotCount: number, employeeCount: number): number {
  const robotScore = Math.min(100, robotCount * 10);
  const employeeScore = Math.min(100, employeeCount * 5);
  return Math.round(robotScore * 0.4 + employeeScore * 0.6);
}

/**
 * 计算效果稳定性分数 (0-100)
 * 基于近 30 天成功率与成功率波动幅度计算
 */
export function calcEffectStability(successRate: number, stdDev: number): number {
  const rateScore = Math.min(100, successRate * 100);
  const stabilityPenalty = Math.min(50, stdDev * 200);
  return Math.round(Math.max(0, rateScore - stabilityPenalty));
}

/**
 * 计算业务覆盖度分数 (0-100)
 * 基于覆盖机器人数与覆盖角色数计算
 */
export function calcBusinessCoverage(departmentCount: number, roleCount: number): number {
  const deptScore = Math.min(100, departmentCount * 20);
  const roleScore = Math.min(100, roleCount * 15);
  return Math.round(deptScore * 0.6 + roleScore * 0.4);
}

/**
 * 计算员工满意度分数 (0-100)
 * 基于员工主动安装率与持续使用天数计算
 */
export function calcEmployeeSatisfaction(
  installRate: number | null,
  continuousUsageDays: number | null,
): ScoreDimension {
  if (installRate === null && continuousUsageDays === null) {
    return { value: 0, available: false };
  }
  const installScore = installRate !== null ? Math.min(100, installRate * 100) : 50;
  const usageScore = continuousUsageDays !== null ? Math.min(100, continuousUsageDays * 3) : 50;
  return { value: Math.round(installScore * 0.5 + usageScore * 0.5), available: true };
}

/**
 * 计算综合分（加权平均）
 * 当某维度数据不足时，排除该维度并重新分配权重
 */
export function calcCompositeScore(dimensions: Record<string, ScoreDimension>): number {
  const entries = Object.entries(WEIGHTS);
  const available = entries.filter(([key]) => dimensions[key]?.available);
  if (available.length === 0) {
    return 0;
  }
  const totalWeight = available.reduce((sum, [, w]) => sum + w, 0);
  const weightedSum = available.reduce(
    (sum, [key, w]) => sum + (dimensions[key]?.value ?? 0) * (w / totalWeight),
    0,
  );
  return Math.round(weightedSum);
}

/**
 * 完整评分计算入口
 */
export function calculateIncubationScore(input: ScoreInput): IncubationScore {
  const reuseBreath: ScoreDimension = {
    value: calcReuseBreath(input.robotCount, input.employeeCount),
    available: true,
  };
  const effectStability: ScoreDimension = {
    value: calcEffectStability(input.successRate30d, input.successRateStdDev),
    available: true,
  };
  const businessCoverage: ScoreDimension = {
    value: calcBusinessCoverage(input.departmentCount, input.roleCount),
    available: true,
  };
  const employeeSatisfaction = calcEmployeeSatisfaction(
    input.installRate,
    input.continuousUsageDays,
  );

  const dimensions = { reuseBreath, effectStability, businessCoverage, employeeSatisfaction };
  const compositeScore = calcCompositeScore(dimensions);

  return { reuseBreath, effectStability, businessCoverage, employeeSatisfaction, compositeScore };
}

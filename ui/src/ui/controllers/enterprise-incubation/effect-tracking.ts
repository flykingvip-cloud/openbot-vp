export type EffectComparison = {
  before30dAvgCalls: number;
  after30dAvgCalls: number;
  before30dDeptCount: number;
  after30dDeptCount: number;
  before30dSuccessRate: number;
  after30dSuccessRate: number;
  callsDeclineRate: number;
  deptDeclineRate: number;
  hasDeclineWarning: boolean;
  trackingDaysAfter: number;
  isTrackingComplete: boolean;
};

export const DECLINE_THRESHOLD = 0.2; // 20%

/**
 * 计算效果下降率
 * 返回负数表示下降，正数表示增长
 */
export function calcDeclineRate(before: number, after: number): number {
  if (before === 0) {
    return 0;
  }
  return (after - before) / before;
}

/**
 * 判断是否触发效果下降警告
 * 当调用量或覆盖机器人数下降超过 20% 时触发
 */
export function hasEffectDeclineWarning(
  callsDeclineRate: number,
  deptDeclineRate: number,
): boolean {
  return callsDeclineRate < -DECLINE_THRESHOLD || deptDeclineRate < -DECLINE_THRESHOLD;
}

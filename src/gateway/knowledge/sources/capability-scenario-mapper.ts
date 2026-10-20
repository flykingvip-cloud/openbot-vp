/** KU-09-3: capabilityKey → employee-facing scenario labels. */
const CAPABILITY_SCENARIO_MAP: Record<string, string[]> = {
  "customer.profile": ["客户分析", "销售跟进", "客户画像"],
  "sales.churn-risk": ["流失预警", "客户留存", "销售预测"],
  "order.status": ["订单跟踪", "履约监控", "供应链协同"],
  "sales.analysis": ["销售分析", "业绩洞察", "区域对比"],
};

export function mapCapabilityScenarios(capabilityKey: string): string[] {
  const mapped = CAPABILITY_SCENARIO_MAP[capabilityKey.trim().toLowerCase()];
  if (mapped?.length) {
    return [...mapped];
  }
  return ["通用分析"];
}

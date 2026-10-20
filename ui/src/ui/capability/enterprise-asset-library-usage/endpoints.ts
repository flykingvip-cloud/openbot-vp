/**
 * RPC endpoint contracts for Enterprise Capability Usage Management.
 *
 * This module owns the `enterprise-usage.*` namespace. Keeping these
 * contracts outside `enterprise-capability/*` prevents the asset library
 * projection boundary from absorbing usage/runtime-facing concerns.
 */

import type { PaginationState } from "../enterprise-capability/types.ts";
import type {
  GovernanceConfig,
  GovernanceIssue,
  RobotCapabilityUsageView,
  RobotDetail,
} from "../runtime-projection/types.ts";

export const ENTERPRISE_USAGE_ENDPOINTS = {
  listRobotCapabilityViews: "enterprise-usage.list-robot-capability-views",
  getRobotDetail: "enterprise-usage.get-robot-detail",
  getAnalytics: "enterprise-usage.get-analytics",
  detectGovernance: "enterprise-usage.detect-governance",
  acknowledgeGovernance: "enterprise-usage.acknowledge-governance",
  updateGovernanceConfig: "enterprise-usage.update-governance-config",
} as const;

export type EnterpriseUsageEndpoint =
  (typeof ENTERPRISE_USAGE_ENDPOINTS)[keyof typeof ENTERPRISE_USAGE_ENDPOINTS];

export type AnalyticsWindow = 7 | 30 | 90;

export type PaginationInput = {
  page: number;
  pageSize: 10 | 20 | 50;
};

export type AnalyticsKpis = {
  totalMonthlyExecutions: {
    current: number;
    previousMonthChange: number;
    previousMonthPercentage: number;
  };
  coveredRobots: {
    current: number;
    previousMonthChange: number;
    previousMonthPercentage: number;
  };
  coveredEmployees: {
    current: number;
    previousMonthChange: number;
    previousMonthPercentage: number;
  };
  averageSuccessRate: {
    current: number;
    previousMonthChange: number;
    previousMonthPercentage: number;
  };
};

export type AnalyticsTrendSeries = {
  dates: string[];
  values: number[];
};

export type AnalyticsTopCapability = {
  capabilityId: string;
  capabilityName: string;
  monthlyExecutions: number;
  successRate: number;
  coveredRobots: number;
};

export type ListRobotCapabilityViewsRequest = {
  filters: {
    nameQuery: string;
    healthStatus: string | null;
    monthlyExecutionsRange: string;
  };
  sorting: {
    field: "monthlyExecutions" | "capabilityCount" | "employeeCoverage" | "successRate";
    direction: "asc" | "desc";
  };
  pagination: PaginationInput;
};

export type ListRobotCapabilityViewsResponse = {
  items: RobotCapabilityUsageView[];
  pagination: PaginationState;
  kpis: {
    totalRobots: number;
    totalMonthlyExecutions: number;
    totalEmployeeCoverage: number;
    averageSuccessRate: number;
  };
};

export type GetRobotDetailRequest = {
  robotId: string;
};

export type GetRobotDetailResponse = {
  basic: Pick<RobotDetail, "robotId" | "robotName" | "healthStatus" | "lastActiveAt">;
  capabilities: RobotDetail["capabilities"];
  trend30d: RobotDetail["trend30d"];
  employeeCoverage: number;
  topCapabilities: RobotDetail["topCapabilities"];
};

export type GetAnalyticsRequest = {
  window: AnalyticsWindow;
};

export type GetAnalyticsResponse = {
  kpis: AnalyticsKpis;
  trendExecutions: AnalyticsTrendSeries;
  trendCapabilityReuse: AnalyticsTrendSeries;
  topCapabilities: AnalyticsTopCapability[];
};

export type DetectGovernanceRequest = {
  config: GovernanceConfig;
};

export type DetectGovernanceResponse = {
  lowEfficiency: GovernanceIssue[];
  zombie: GovernanceIssue[];
  conflict: GovernanceIssue[];
};

export type AcknowledgeGovernanceRequest = {
  issueId: string;
};

export type AcknowledgeGovernanceResponse = {
  acknowledged: true;
};

export type UpdateGovernanceConfigRequest = {
  config: Partial<GovernanceConfig>;
};

export type UpdateGovernanceConfigResponse = {
  config: GovernanceConfig;
};

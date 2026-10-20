/**
 * Gateway client for Enterprise Capability Usage Management.
 *
 * The usage module owns `enterprise-usage.*` endpoints and consumes projected
 * runtime data in business language. It intentionally stays separate from the
 * enterprise capability asset-library gateway.
 */

import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  ENTERPRISE_USAGE_ENDPOINTS,
  type AcknowledgeGovernanceRequest,
  type AcknowledgeGovernanceResponse,
  type DetectGovernanceRequest,
  type DetectGovernanceResponse,
  type GetAnalyticsRequest,
  type GetAnalyticsResponse,
  type GetRobotDetailRequest,
  type GetRobotDetailResponse,
  type ListRobotCapabilityViewsRequest,
  type ListRobotCapabilityViewsResponse,
  type UpdateGovernanceConfigRequest,
  type UpdateGovernanceConfigResponse,
} from "./endpoints.ts";

export function createEnterpriseUsageGateway(client: GatewayBrowserClient) {
  return {
    async listRobotCapabilityViews(
      req: ListRobotCapabilityViewsRequest,
    ): Promise<ListRobotCapabilityViewsResponse> {
      return client.request<ListRobotCapabilityViewsResponse>(
        ENTERPRISE_USAGE_ENDPOINTS.listRobotCapabilityViews,
        req,
      );
    },
    async getRobotDetail(req: GetRobotDetailRequest): Promise<GetRobotDetailResponse> {
      return client.request<GetRobotDetailResponse>(ENTERPRISE_USAGE_ENDPOINTS.getRobotDetail, req);
    },
    async getAnalytics(req: GetAnalyticsRequest): Promise<GetAnalyticsResponse> {
      return client.request<GetAnalyticsResponse>(ENTERPRISE_USAGE_ENDPOINTS.getAnalytics, req);
    },
    async detectGovernance(req: DetectGovernanceRequest): Promise<DetectGovernanceResponse> {
      return client.request<DetectGovernanceResponse>(
        ENTERPRISE_USAGE_ENDPOINTS.detectGovernance,
        req,
      );
    },
    async acknowledgeGovernance(
      req: AcknowledgeGovernanceRequest,
    ): Promise<AcknowledgeGovernanceResponse> {
      return client.request<AcknowledgeGovernanceResponse>(
        ENTERPRISE_USAGE_ENDPOINTS.acknowledgeGovernance,
        req,
      );
    },
    async updateGovernanceConfig(
      req: UpdateGovernanceConfigRequest,
    ): Promise<UpdateGovernanceConfigResponse> {
      return client.request<UpdateGovernanceConfigResponse>(
        ENTERPRISE_USAGE_ENDPOINTS.updateGovernanceConfig,
        req,
      );
    },
  };
}

export type EnterpriseUsageGateway = ReturnType<typeof createEnterpriseUsageGateway>;

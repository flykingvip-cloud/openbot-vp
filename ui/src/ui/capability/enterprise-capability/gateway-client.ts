/**
 * Typed wrapper around `GatewayBrowserClient` for the enterprise capability
 * center's 14 RPC endpoints (`enterprise-capability.*` namespace).
 *
 * Architectural role — projection at the gateway boundary:
 * Every response returned by this client is passed through
 * `projectToEnterpriseView()` BEFORE it leaves the gateway layer. This
 * enforces the EnterpriseCapabilityProjection invariant at the single
 * narrowest seam between backend data and enterprise-side controllers, so
 * no controller, view, or downstream consumer ever observes raw API data
 * carrying runtime fields (prompt, workflowJson, toolchain, modelRouting,
 * provider, memoryStrategy, executionPolicy, routingHints, modelPreferences).
 *
 * In other words: projection is a property of the gateway itself, not
 * something callers must remember to apply. See design.md → Property 1
 * (EnterpriseCapabilityProjection 投影正确性) for the full guarantee.
 *
 * The shape of this object is the contract that the enterprise capability
 * gateway exposes at the UI boundary — identical to the employee-capability
 * gateway pattern, with the addition of the projection pipe on every
 * response.
 */

import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  ENTERPRISE_CAPABILITY_ENDPOINTS,
  type AssetDetailRequest,
  type AssetDetailResponse,
  type AssetListRequest,
  type AssetListResponse,
  type CertifyRequest,
  type CertifyResponse,
  type ContributionPerformanceRequest,
  type ContributionPerformanceResponse,
  type ContributionRecordsRequest,
  type ContributionRecordsResponse,
  type DomainDistributionRequest,
  type DomainDistributionResponse,
  type InstallManagementRequest,
  type InstallManagementResponse,
  type InstallToRobotsRequest,
  type InstallToRobotsResponse,
  type PromoteToStandardRequest,
  type PromoteToStandardResponse,
  type PushToPositionsRequest,
  type PushToPositionsResponse,
  type ReviewQueueRequest,
  type ReviewQueueResponse,
  type ReviewRequest,
  type ReviewResponse,
  type StatsRequest,
  type StatsResponse,
  type UninstallRequest,
  type UninstallResponse,
  type UpdateHealthStatusRequest,
  type UpdateHealthStatusResponse,
} from "./endpoints.ts";
import { projectToEnterpriseView } from "./projection.ts";

export function createEnterpriseCapabilityGateway(client: GatewayBrowserClient) {
  return {
    async list(req: AssetListRequest): Promise<AssetListResponse> {
      const raw = await client.request<AssetListResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.list,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async detail(req: AssetDetailRequest): Promise<AssetDetailResponse> {
      const raw = await client.request<AssetDetailResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.detail,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async review(req: ReviewRequest): Promise<ReviewResponse> {
      const raw = await client.request<ReviewResponse>(ENTERPRISE_CAPABILITY_ENDPOINTS.review, req);
      return projectToEnterpriseView(raw);
    },
    async reviewQueue(req: ReviewQueueRequest): Promise<ReviewQueueResponse> {
      const raw = await client.request<ReviewQueueResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.reviewQueue,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async installToRobots(req: InstallToRobotsRequest): Promise<InstallToRobotsResponse> {
      const raw = await client.request<InstallToRobotsResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.installToRobots,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async pushToPositions(req: PushToPositionsRequest): Promise<PushToPositionsResponse> {
      const raw = await client.request<PushToPositionsResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.pushToPositions,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async uninstall(req: UninstallRequest): Promise<UninstallResponse> {
      const raw = await client.request<UninstallResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.uninstall,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async stats(req: StatsRequest): Promise<StatsResponse> {
      const raw = await client.request<StatsResponse>(ENTERPRISE_CAPABILITY_ENDPOINTS.stats, req);
      return projectToEnterpriseView(raw);
    },
    async contributionRecords(
      req: ContributionRecordsRequest,
    ): Promise<ContributionRecordsResponse> {
      const raw = await client.request<ContributionRecordsResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.contributionRecords,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async installManagement(req: InstallManagementRequest): Promise<InstallManagementResponse> {
      const raw = await client.request<InstallManagementResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.installManagement,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async contributionPerformance(
      req: ContributionPerformanceRequest,
    ): Promise<ContributionPerformanceResponse> {
      const raw = await client.request<ContributionPerformanceResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.contributionPerformance,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async certify(req: CertifyRequest): Promise<CertifyResponse> {
      const raw = await client.request<CertifyResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.certify,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async promoteToStandard(req: PromoteToStandardRequest): Promise<PromoteToStandardResponse> {
      const raw = await client.request<PromoteToStandardResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.promoteToStandard,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async updateHealthStatus(req: UpdateHealthStatusRequest): Promise<UpdateHealthStatusResponse> {
      const raw = await client.request<UpdateHealthStatusResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.updateHealthStatus,
        req,
      );
      return projectToEnterpriseView(raw);
    },
    async domainDistribution(req: DomainDistributionRequest): Promise<DomainDistributionResponse> {
      const raw = await client.request<DomainDistributionResponse>(
        ENTERPRISE_CAPABILITY_ENDPOINTS.domainDistribution,
        req,
      );
      return projectToEnterpriseView(raw);
    },
  };
}

export type EnterpriseCapabilityGateway = ReturnType<typeof createEnterpriseCapabilityGateway>;

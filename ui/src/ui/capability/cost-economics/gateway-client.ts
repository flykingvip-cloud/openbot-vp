import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  COST_ECONOMICS_ENDPOINTS,
  type CostVersion,
  type CostVersionOverviewResponse,
  type EconomicsOverviewResponse,
  type EconomicsLedgerResponse,
  type PlatformConsumptionForecastOverview,
} from "./endpoints.ts";

export function createCostEconomicsGateway(client: GatewayBrowserClient) {
  return {
    costVersionOverview(): Promise<CostVersionOverviewResponse> {
      return client.request<CostVersionOverviewResponse>(
        COST_ECONOMICS_ENDPOINTS.costVersionOverview,
        {},
      );
    },
    createCostVersionFromCatalog(): Promise<{ version: CostVersion }> {
      return client.request(COST_ECONOMICS_ENDPOINTS.costVersionCreateFromCatalog, {});
    },
    activateCostVersion(versionId: string): Promise<{ version: CostVersion }> {
      return client.request(COST_ECONOMICS_ENDPOINTS.costVersionActivate, { versionId });
    },
    economicsOverview(input?: {
      startTime?: string;
      endTime?: string;
    }): Promise<EconomicsOverviewResponse> {
      return client.request(COST_ECONOMICS_ENDPOINTS.economicsOverview, input ?? {});
    },
    economicsLedger(input?: {
      startTime?: string;
      endTime?: string;
      planId?: string;
      enterpriseId?: string;
      limit?: number;
    }): Promise<EconomicsLedgerResponse> {
      return client.request(COST_ECONOMICS_ENDPOINTS.economicsLedger, input ?? {});
    },
    consumptionForecastPlatformOverview(): Promise<PlatformConsumptionForecastOverview> {
      return client.request(COST_ECONOMICS_ENDPOINTS.consumptionForecastPlatformOverview, {});
    },
  };
}

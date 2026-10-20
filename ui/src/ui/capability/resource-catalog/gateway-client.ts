import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  RESOURCE_CATALOG_ENDPOINTS,
  type CreditWeight,
  type ResourceCatalogFailoverUpsertRequest,
  type ResourceCatalogModelsUpsertRequest,
  type ResourceCatalogOverviewResponse,
  type ResourceCatalogResolveTiersResponse,
  type ResourceCatalogSeedResponse,
  type ResourceCatalogTierUpsertRequest,
  type ResourceModelCatalogEntry,
  type ResourceTier,
  type TierFailoverRule,
} from "./endpoints.ts";

export function createResourceCatalogGateway(client: GatewayBrowserClient) {
  return {
    overview(): Promise<ResourceCatalogOverviewResponse> {
      return client.request<ResourceCatalogOverviewResponse>(
        RESOURCE_CATALOG_ENDPOINTS.overview,
        {},
      );
    },
    seedFromConfig(): Promise<ResourceCatalogSeedResponse> {
      return client.request<ResourceCatalogSeedResponse>(
        RESOURCE_CATALOG_ENDPOINTS.modelsSeedFromConfig,
        {},
      );
    },
    upsertModel(
      req: ResourceCatalogModelsUpsertRequest,
    ): Promise<{ model: ResourceModelCatalogEntry }> {
      return client.request(RESOURCE_CATALOG_ENDPOINTS.modelsUpsert, req);
    },
    upsertCreditWeight(input: {
      tier: string;
      creditCost: number;
    }): Promise<{ creditWeight: CreditWeight }> {
      return client.request(RESOURCE_CATALOG_ENDPOINTS.creditWeightsUpsert, input);
    },
    upsertFailoverRule(
      req: ResourceCatalogFailoverUpsertRequest,
    ): Promise<{ failoverRule: TierFailoverRule }> {
      return client.request(RESOURCE_CATALOG_ENDPOINTS.failoverRulesUpsert, req);
    },
    upsertTier(req: ResourceCatalogTierUpsertRequest): Promise<{ tier: ResourceTier }> {
      return client.request(RESOURCE_CATALOG_ENDPOINTS.tiersUpsert, req);
    },
    resolveTiers(input: {
      tierIds: string[];
      allowedModelIds?: string[];
    }): Promise<ResourceCatalogResolveTiersResponse> {
      return client.request(RESOURCE_CATALOG_ENDPOINTS.resolveTiers, input);
    },
  };
}

export type ResourceCatalogGateway = ReturnType<typeof createResourceCatalogGateway>;

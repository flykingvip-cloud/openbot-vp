import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  ENTERPRISE_MODEL_CATALOG_ENDPOINTS,
  ENTERPRISE_MODEL_PROVIDER_ENDPOINTS,
  type CatalogListResponse,
  type DiscoveredModel,
  type EnterpriseModelAsset,
  type EnterpriseModelPublicConnection,
  type ProviderListResponse,
} from "./endpoints.ts";

export function createEnterpriseModelProviderGateway(client: GatewayBrowserClient) {
  return {
    list(params: { tenantId?: string; enterpriseId?: string } = {}): Promise<ProviderListResponse> {
      return client.request(ENTERPRISE_MODEL_PROVIDER_ENDPOINTS.list, params);
    },
    create(params: {
      tenantId?: string;
      enterpriseId?: string;
      providerType: string;
      displayName: string;
      baseUrl?: string;
      protocol?: string;
      apiKey?: string;
    }): Promise<{ connection: EnterpriseModelPublicConnection }> {
      return client.request(ENTERPRISE_MODEL_PROVIDER_ENDPOINTS.create, params);
    },
    update(params: {
      tenantId?: string;
      enterpriseId?: string;
      connectionId: string;
      displayName?: string;
      baseUrl?: string | null;
      protocol?: string;
    }): Promise<{
      connection: EnterpriseModelPublicConnection;
      endpointInvalidated?: boolean;
      degradedAssets?: number;
    }> {
      return client.request(ENTERPRISE_MODEL_PROVIDER_ENDPOINTS.update, params);
    },
    test(params: { tenantId?: string; enterpriseId?: string; connectionId: string }): Promise<{
      ok: boolean;
      code: string;
      message?: string;
      discoveredModels: DiscoveredModel[];
      connection: EnterpriseModelPublicConnection;
    }> {
      return client.request(ENTERPRISE_MODEL_PROVIDER_ENDPOINTS.test, params);
    },
    rotateCredential(params: {
      tenantId?: string;
      enterpriseId?: string;
      connectionId: string;
      apiKey: string;
    }): Promise<{
      connection: EnterpriseModelPublicConnection;
      discoveredModels: DiscoveredModel[];
    }> {
      return client.request(ENTERPRISE_MODEL_PROVIDER_ENDPOINTS.rotateCredential, params);
    },
    disable(params: {
      tenantId?: string;
      enterpriseId?: string;
      connectionId: string;
    }): Promise<{ connection: EnterpriseModelPublicConnection }> {
      return client.request(ENTERPRISE_MODEL_PROVIDER_ENDPOINTS.disable, params);
    },
    delete(params: {
      tenantId?: string;
      enterpriseId?: string;
      connectionId: string;
      force?: boolean;
    }): Promise<{ deleted: boolean; connectionId: string; removedAssets: number }> {
      return client.request(ENTERPRISE_MODEL_PROVIDER_ENDPOINTS.delete, params);
    },
    listCatalog(
      params: {
        tenantId?: string;
        enterpriseId?: string;
        connectionId?: string;
        enabledOnly?: boolean;
      } = {},
    ): Promise<CatalogListResponse> {
      return client.request(ENTERPRISE_MODEL_CATALOG_ENDPOINTS.list, params);
    },
    discover(params: {
      tenantId?: string;
      enterpriseId?: string;
      connectionId: string;
    }): Promise<{ connectionId: string; discoveredModels: DiscoveredModel[] }> {
      return client.request(ENTERPRISE_MODEL_CATALOG_ENDPOINTS.discover, params);
    },
    register(params: {
      tenantId?: string;
      enterpriseId?: string;
      connectionId: string;
      upstreamModelId: string;
      displayName?: string;
      tier?: string;
      capabilities?: string[];
      enabled?: boolean;
      cost?: {
        inputPer1kCents?: number;
        outputPer1kCents?: number;
        currency?: string;
      };
      budget?: {
        monthlySpendCapCents?: number;
      };
    }): Promise<{ asset: EnterpriseModelAsset }> {
      return client.request(ENTERPRISE_MODEL_CATALOG_ENDPOINTS.register, params);
    },
    updateAsset(params: {
      tenantId?: string;
      enterpriseId?: string;
      assetId: string;
      displayName?: string;
      tier?: string | null;
      capabilities?: string[];
      contextWindow?: number | null;
      cost?: {
        inputPer1kCents?: number;
        outputPer1kCents?: number;
        currency?: string;
      } | null;
      budget?: {
        monthlySpendCapCents?: number;
      } | null;
    }): Promise<{ asset: EnterpriseModelAsset }> {
      return client.request(ENTERPRISE_MODEL_CATALOG_ENDPOINTS.update, params);
    },
    enableAsset(params: {
      tenantId?: string;
      enterpriseId?: string;
      assetId: string;
    }): Promise<{ asset: EnterpriseModelAsset }> {
      return client.request(ENTERPRISE_MODEL_CATALOG_ENDPOINTS.enable, params);
    },
    disableAsset(params: {
      tenantId?: string;
      enterpriseId?: string;
      assetId: string;
    }): Promise<{ asset: EnterpriseModelAsset }> {
      return client.request(ENTERPRISE_MODEL_CATALOG_ENDPOINTS.disable, params);
    },
  };
}

export type EnterpriseModelProviderGateway = ReturnType<
  typeof createEnterpriseModelProviderGateway
>;

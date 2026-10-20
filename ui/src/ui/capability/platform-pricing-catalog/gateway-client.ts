import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  PLATFORM_PRICING_CATALOG_ENDPOINTS,
  type PlatformPricingCatalogResponse,
} from "./endpoints.ts";

export function createPlatformPricingCatalogGateway(client: GatewayBrowserClient) {
  return {
    catalog(): Promise<PlatformPricingCatalogResponse> {
      return client.request(PLATFORM_PRICING_CATALOG_ENDPOINTS.catalog, {});
    },
  };
}

export type PlatformPricingCatalogGateway = ReturnType<typeof createPlatformPricingCatalogGateway>;

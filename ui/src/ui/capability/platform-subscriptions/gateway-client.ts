import type { GatewayBrowserClient } from "../../gateway.ts";
import { PLATFORM_SUBSCRIPTIONS_ENDPOINTS, type PlatformCommercialSummary } from "./endpoints.ts";

export function createPlatformSubscriptionsGateway(client: GatewayBrowserClient) {
  return {
    summary(): Promise<PlatformCommercialSummary> {
      return client.request<PlatformCommercialSummary>(
        PLATFORM_SUBSCRIPTIONS_ENDPOINTS.summary,
        {},
      );
    },
  };
}

export type {
  PlatformCommercialSummary,
  PlatformPricingActivityItem,
  PlatformPricingActivityKind,
} from "./endpoints.ts";

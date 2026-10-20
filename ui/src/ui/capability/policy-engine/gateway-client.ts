import type { GatewayBrowserClient } from "../../gateway.ts";
import { POLICY_ENGINE_ENDPOINTS, type RoutingPolicy } from "./endpoints.ts";

export function createPolicyEngineGateway(client: GatewayBrowserClient) {
  return {
    overview(): Promise<{ policies: RoutingPolicy[] }> {
      return client.request(POLICY_ENGINE_ENDPOINTS.overview, {});
    },
    list(): Promise<{ policies: RoutingPolicy[] }> {
      return client.request(POLICY_ENGINE_ENDPOINTS.list, {});
    },
  };
}

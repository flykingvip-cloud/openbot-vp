/**
 * 平台「套餐⇄模型」类型化 RPC 客户端（P6）。
 */

import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  PLATFORM_MODEL_BINDING_ENDPOINTS,
  type BindingSetRequest,
  type BindingSetResponse,
  type OverviewResponse,
} from "./endpoints.ts";

export function createPlatformModelBindingGateway(client: GatewayBrowserClient) {
  return {
    overview(): Promise<OverviewResponse> {
      return client.request<OverviewResponse>(PLATFORM_MODEL_BINDING_ENDPOINTS.overview, {});
    },
    setBinding(req: BindingSetRequest): Promise<BindingSetResponse> {
      return client.request<BindingSetResponse>(PLATFORM_MODEL_BINDING_ENDPOINTS.set, req);
    },
  };
}

export type PlatformModelBindingGateway = ReturnType<typeof createPlatformModelBindingGateway>;

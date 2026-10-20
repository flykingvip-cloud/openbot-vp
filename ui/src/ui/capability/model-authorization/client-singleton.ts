/**
 * 模型授权 RPC 客户端单例。
 *
 * 与 ai-workforce-governance 的 `setGovernanceApiClient` 同构：surface 渲染入口
 * （持有 `props.client` / `state.client`）在渲染前注入网关客户端，自包含的授权区块
 * 组件即可在没有逐层透传 client 的情况下完成数据加载（员工工作台等深层表面）。
 */

import type { GatewayBrowserClient } from "../../gateway.ts";

let modelAuthorizationClient: GatewayBrowserClient | null = null;

export function setModelAuthorizationClient(client: GatewayBrowserClient | null | undefined): void {
  modelAuthorizationClient = client ?? null;
}

export function getModelAuthorizationClient(): GatewayBrowserClient | null {
  return modelAuthorizationClient;
}

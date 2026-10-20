import type { GatewayBrowserClient } from "../../../gateway.ts";

/** Gateway hello 完成、WebSocket OPEN 后才允许 billing RPC。 */
export function isCostBudgetGatewayReady(
  client: GatewayBrowserClient | null | undefined,
): client is GatewayBrowserClient {
  return Boolean(client?.connected);
}

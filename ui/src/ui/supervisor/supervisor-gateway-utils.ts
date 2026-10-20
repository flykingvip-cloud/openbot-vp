import type { GatewayBrowserClient } from "../gateway.ts";

/** WS 尚未 OPEN 时 client.request 会抛出的瞬时错误。 */
export function isTransientGatewayError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not connected|gateway closed/i.test(message);
}

export function isGatewayReady(client: GatewayBrowserClient | null | undefined): boolean {
  return Boolean(client?.connected);
}

/** 等待 Control UI 与 Gateway 完成握手（首屏竞态）。 */
export async function whenGatewayReady(
  client: GatewayBrowserClient | null | undefined,
  maxAttempts = 8,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (client?.connected) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  return false;
}

export function resolvePanelError(
  err: unknown,
  options?: { connectionManaged?: boolean },
): string | null {
  if (options?.connectionManaged && isTransientGatewayError(err)) {
    return null;
  }
  return err instanceof Error ? err.message : String(err);
}

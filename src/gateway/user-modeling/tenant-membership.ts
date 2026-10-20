import type { GatewayClient } from "../server-methods/types.js";

/**
 * Resolve tenant id for user modeling keys. Prefers authoritative membership when
 * tenant-context is wired; otherwise returns null (non-tenant scoped storage).
 */
export async function resolveUserModelingTenantId(
  client: GatewayClient | null,
): Promise<string | null> {
  if (!client?.user?.trim()) {
    return null;
  }
  try {
    const { resolveAuthoritativeMembership } = await import("../tenant-context.js");
    const { tenantId } = await resolveAuthoritativeMembership(client);
    return tenantId?.trim() || null;
  } catch {
    return null;
  }
}

import { buildEmployeeAccessSnapshot } from "./enterprise-seat-assets-store.js";
import { loadSeatAssetsStoreForTenantId } from "./platform-auth/seat-store-loader.js";

/** Resolve peer access from the tenant control plane, never a model-provided grant. */
export async function conversationSeatAgentIds(
  tenantId: string,
  userId: string,
): Promise<string[]> {
  if (!tenantId.trim() || !userId.trim()) {
    return [];
  }
  try {
    const store = await loadSeatAssetsStoreForTenantId(tenantId);
    return buildEmployeeAccessSnapshot({ store, tenantId, employeeId: userId }).agentIds;
  } catch {
    return [];
  }
}

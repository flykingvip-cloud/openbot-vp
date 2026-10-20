import type { GatewayBrowserClient } from "../gateway.ts";
import type { MeshOwnershipListResult } from "../types.ts";

export type MeshOwnershipState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  meshOwnershipLoading: boolean;
  meshOwnershipList: MeshOwnershipListResult | null;
  meshOwnershipError: string | null;
  platformAuthState?: {
    session?: { tenantId?: string | null } | null;
  } | null;
  hello?: { auth?: { tenantId?: string | null } | null } | null;
  bootstrapAuthSession?: { tenantId?: string | null } | null;
};

function resolveTenantId(state: MeshOwnershipState): string | null {
  return (
    state.platformAuthState?.session?.tenantId?.trim() ||
    state.hello?.auth?.tenantId?.trim() ||
    state.bootstrapAuthSession?.tenantId?.trim() ||
    null
  );
}

export async function loadMeshOwnership(state: MeshOwnershipState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.meshOwnershipLoading) {
    return;
  }
  state.meshOwnershipLoading = true;
  state.meshOwnershipError = null;
  try {
    const tenantId = resolveTenantId(state);
    const result = await state.client.request<MeshOwnershipListResult>(
      "mesh.ownership.list",
      tenantId ? { tenantId } : {},
    );
    state.meshOwnershipList = result ?? { records: [] };
  } catch (error) {
    state.meshOwnershipError = error instanceof Error ? error.message : String(error);
  } finally {
    state.meshOwnershipLoading = false;
  }
}

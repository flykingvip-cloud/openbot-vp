import type {
  ControlUiPlatformAuthState,
  ControlUiPlatformOrganizationSnapshot,
} from "../../../../src/gateway/control-ui-contract.js";
import type { GatewayBrowserClient } from "../gateway.ts";

export type EnterpriseOrganizationSnapshotState = {
  client: GatewayBrowserClient | null;
  connected?: boolean;
  platformAuthState: ControlUiPlatformAuthState | null;
  enterpriseOrganizationSnapshot: ControlUiPlatformOrganizationSnapshot | null;
  enterpriseOrganizationSnapshotLoading: boolean;
  enterpriseOrganizationSnapshotError: string | null;
};

type OrganizationSnapshotResponse = {
  tenantId: string;
  organization: ControlUiPlatformOrganizationSnapshot | null;
};

function resolveEnterpriseOrganizationTenantId(
  state: EnterpriseOrganizationSnapshotState,
): string | null {
  return (
    state.platformAuthState?.session?.tenantId?.trim() ??
    state.platformAuthState?.enterprise?.id?.trim() ??
    null
  );
}

function applyOrganizationSnapshot(
  state: EnterpriseOrganizationSnapshotState,
  organization: ControlUiPlatformOrganizationSnapshot | null,
): void {
  state.enterpriseOrganizationSnapshot = organization;
  if (!organization || !state.platformAuthState) {
    return;
  }
  state.platformAuthState = {
    ...state.platformAuthState,
    organization,
  };
}

export async function refreshEnterpriseOrganizationSnapshot(
  state: EnterpriseOrganizationSnapshotState,
): Promise<void> {
  if (!state.client || state.connected === false) {
    return;
  }
  const tenantId = resolveEnterpriseOrganizationTenantId(state);
  if (!tenantId || state.platformAuthState?.membershipRole !== "enterprise-admin") {
    return;
  }
  if (state.enterpriseOrganizationSnapshotLoading) {
    return;
  }
  state.enterpriseOrganizationSnapshotLoading = true;
  state.enterpriseOrganizationSnapshotError = null;
  try {
    const result = await state.client.request<OrganizationSnapshotResponse>(
      "enterprise.organization.snapshot",
      { tenantId },
    );
    applyOrganizationSnapshot(state, result?.organization ?? null);
  } catch (error) {
    state.enterpriseOrganizationSnapshotError =
      error instanceof Error ? error.message : String(error);
  } finally {
    state.enterpriseOrganizationSnapshotLoading = false;
  }
}

/** @deprecated Use refreshEnterpriseOrganizationSnapshot */
export async function loadEnterpriseOrganizationSnapshot(
  state: EnterpriseOrganizationSnapshotState,
  tenantId: string,
): Promise<void> {
  if (!state.client || !tenantId.trim()) {
    return;
  }
  state.enterpriseOrganizationSnapshotLoading = true;
  state.enterpriseOrganizationSnapshotError = null;
  try {
    const result = await state.client.request<OrganizationSnapshotResponse>(
      "enterprise.organization.snapshot",
      { tenantId },
    );
    applyOrganizationSnapshot(state, result?.organization ?? null);
  } catch (error) {
    state.enterpriseOrganizationSnapshotError =
      error instanceof Error ? error.message : String(error);
  } finally {
    state.enterpriseOrganizationSnapshotLoading = false;
  }
}

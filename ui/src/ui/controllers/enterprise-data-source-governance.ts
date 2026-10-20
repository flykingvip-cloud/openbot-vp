import type { GatewayBrowserClient } from "../gateway.ts";

export type EnterpriseDataSourceBoundOperationalIdentity = {
  bindingId: string;
  identityId: string;
  displayName: string;
  provider: string;
  providerLabel: string;
  status: "active" | "expired" | "reauth_required";
  purpose: string;
};

export type EnterpriseDataSourceGovernanceViewSnapshot = {
  source: {
    sourceId: string;
    sourceKey: string;
    displayName: string;
    category: string;
    status: string;
    connectorId: string;
  };
  boundOperationalIdentities: EnterpriseDataSourceBoundOperationalIdentity[];
};

export type EnterpriseDataSourceGovernanceHost = {
  client: GatewayBrowserClient | null;
  enterpriseDataSourceGovernanceSourceId: string | null;
  enterpriseDataSourceGovernanceView: EnterpriseDataSourceGovernanceViewSnapshot | null;
  enterpriseDataSourceGovernanceBusy: boolean;
  enterpriseDataSourceGovernanceError: string | null;
};

type GovernanceViewResponse = {
  tenantId: string;
  view: EnterpriseDataSourceGovernanceViewSnapshot & Record<string, unknown>;
};

export async function loadEnterpriseDataSourceGovernanceView(
  host: EnterpriseDataSourceGovernanceHost,
  tenantId: string,
  sourceId: string,
): Promise<EnterpriseDataSourceGovernanceViewSnapshot | null> {
  const normalizedTenantId = tenantId.trim();
  const normalizedSourceId = sourceId.trim();
  if (!host.client || !normalizedTenantId || !normalizedSourceId) {
    return null;
  }
  host.enterpriseDataSourceGovernanceBusy = true;
  host.enterpriseDataSourceGovernanceError = null;
  host.enterpriseDataSourceGovernanceSourceId = normalizedSourceId;
  try {
    const result = await host.client.request<GovernanceViewResponse>(
      "enterprise-data.sources.governance-view",
      { tenantId: normalizedTenantId, sourceId: normalizedSourceId },
    );
    const view = result?.view;
    if (!view?.source) {
      host.enterpriseDataSourceGovernanceError = "加载 DataSource 详情失败。";
      host.enterpriseDataSourceGovernanceView = null;
      return null;
    }
    const snapshot: EnterpriseDataSourceGovernanceViewSnapshot = {
      source: {
        sourceId: view.source.sourceId,
        sourceKey: view.source.sourceKey,
        displayName: view.source.displayName,
        category: view.source.category,
        status: view.source.status,
        connectorId: view.source.connectorId,
      },
      boundOperationalIdentities: (view.boundOperationalIdentities ?? []).map((entry) => ({
        bindingId: entry.bindingId,
        identityId: entry.identityId,
        displayName: entry.displayName,
        provider: entry.provider,
        providerLabel: entry.providerLabel,
        status: entry.status,
        purpose: entry.purpose,
      })),
    };
    host.enterpriseDataSourceGovernanceView = snapshot;
    return snapshot;
  } catch (error) {
    host.enterpriseDataSourceGovernanceError =
      error instanceof Error ? error.message : "加载 DataSource 详情失败。";
    host.enterpriseDataSourceGovernanceView = null;
    return null;
  } finally {
    host.enterpriseDataSourceGovernanceBusy = false;
  }
}

export function closeEnterpriseDataSourceGovernanceView(
  host: EnterpriseDataSourceGovernanceHost,
): void {
  host.enterpriseDataSourceGovernanceSourceId = null;
  host.enterpriseDataSourceGovernanceView = null;
  host.enterpriseDataSourceGovernanceError = null;
  host.enterpriseDataSourceGovernanceBusy = false;
}

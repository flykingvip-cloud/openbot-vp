import type { DataSource, EnterpriseDataStore } from "../../enterprise-data/types.js";

export type ExternalDataSourceSummary = {
  id: string;
  title: string;
  category: DataSource["category"];
  status: DataSource["status"];
  connectorId: string;
};

/**
 * Knowledge-universe consumption does not publish live DataSource category or
 * connection status. Connector health stays on the enterprise data plane.
 * This list is not a FeedItem, not freshness, and not an access decision.
 * Returning entries here would blur FeedItem-only consumption with connector state.
 */
export function loadExternalDataSourceSummaries(_params: {
  store: EnterpriseDataStore;
  tenantId: string | null;
}): ExternalDataSourceSummary[] {
  return [];
}

import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { assertKnownDataConnector } from "./connector-catalog.js";
import { ensureConnectorDemoPackage } from "./connector-demo-packages.js";
import { ensureHttpRestConnectorPackage } from "./connector-http-rest-package.js";
import { ensureMysqlConnectorPackage } from "./connector-mysql-package.js";
import { ensureNotionConnectorPackage } from "./connector-notion-package.js";
import { ensurePostgresConnectorPackage } from "./connector-postgres-package.js";
import { ensureYonyouTplusConnectorPackage } from "./connector-yonyou-tplus-package.js";

export function ensureConnectorPackage(params: {
  store: import("./types.js").EnterpriseDataStore;
  tenantId: string;
  connectorId: string;
  nowIso: string;
}): { installed: boolean; actionCount: number } {
  const definition = assertKnownDataConnector(params.connectorId);
  if (definition.integrationTier === "demo") {
    return ensureConnectorDemoPackage(params);
  }
  if (definition.connectorId === "notion") {
    return ensureNotionConnectorPackage(params);
  }
  if (definition.connectorId === "http-rest") {
    return ensureHttpRestConnectorPackage(params);
  }
  if (definition.connectorId === "db-postgres") {
    return ensurePostgresConnectorPackage(params);
  }
  if (definition.connectorId === "db-mysql") {
    return ensureMysqlConnectorPackage(params);
  }
  if (definition.connectorId === "erp-yonyou-tplus") {
    return ensureYonyouTplusConnectorPackage(params);
  }
  throw new EnterpriseDataStoreError(
    "CONNECTOR_PACKAGE_UNSUPPORTED",
    `Connector ${params.connectorId} does not support package installation.`,
  );
}

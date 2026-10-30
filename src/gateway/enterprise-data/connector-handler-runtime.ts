import { findDataConnectorDefinition } from "./connector-catalog.js";
import {
  executeMockHandler,
  type MockHandlerInput,
  type MockHandlerResult,
} from "./mock-handlers.js";
import type { DataConnectorCredentialSecret } from "./types.js";

const PRODUCTION_ADAPTER_PREFIX = "enterprise-data/adapters/";

export type ConnectorHandlerOptions = {
  connectorId?: string;
  credentialSecret?: DataConnectorCredentialSecret | null;
  accessMethod?: "credential" | "website_session";
};

const WEBSITE_SESSION_HANDLER_PREFIX = "enterprise-data/sar-bridge/";

function assertWebsiteSessionDoesNotMock(
  handlerRef: string,
  options?: ConnectorHandlerOptions,
): void {
  const connectorId = options?.connectorId?.trim().toLowerCase();
  if (
    options?.accessMethod === "website_session" ||
    connectorId === "site-session" ||
    handlerRef.startsWith(WEBSITE_SESSION_HANDLER_PREFIX)
  ) {
    throw new Error("Website session path cannot fall back to mock handlers.");
  }
}

/** Production connectors must fail closed — never silently become demo/mock knowledge. */
function assertProductionDoesNotMock(handlerRef: string, options?: ConnectorHandlerOptions): void {
  const connectorId = options?.connectorId?.trim();
  if (!connectorId) {
    return;
  }
  const definition = findDataConnectorDefinition(connectorId);
  if (definition?.integrationTier === "production") {
    throw new Error(
      `Production connector "${definition.connectorId}" has no live adapter for ${handlerRef}; refusing mock fallback.`,
    );
  }
}

/** Synchronous mock handler execution (Data Gateway invoke path). */
export function executeConnectorHandler(
  handlerRef: string,
  input: MockHandlerInput,
): MockHandlerResult {
  const normalized = handlerRef.trim();
  if (normalized.startsWith(PRODUCTION_ADAPTER_PREFIX)) {
    throw new Error(`Production adapter not implemented: ${normalized}`);
  }
  assertWebsiteSessionDoesNotMock(normalized);
  // Sync path has no connector options; production adapter prefix already throws above.
  return executeMockHandler(normalized, input);
}

/** Async handler execution with optional live adapter routing (probe / future gateway). */
export async function executeConnectorHandlerAsync(
  handlerRef: string,
  input: MockHandlerInput,
  options?: ConnectorHandlerOptions,
): Promise<MockHandlerResult> {
  const normalized = handlerRef.trim();
  if (normalized.startsWith(PRODUCTION_ADAPTER_PREFIX)) {
    throw new Error(`Production adapter not implemented: ${normalized}`);
  }

  const connectorId = options?.connectorId?.trim().toLowerCase();
  const secret = options?.credentialSecret;
  if (connectorId === "crm-salesforce" && secret) {
    const { executeSalesforceHandler } = await import("./adapters/salesforce.js");
    return executeSalesforceHandler(normalized, input, secret);
  }
  if (connectorId === "notion" && secret?.oauthAccessToken) {
    const { executeNotionHandler } = await import("./adapters/notion.js");
    return executeNotionHandler(normalized, secret);
  }
  if (connectorId === "http-rest" && secret) {
    const { executeHttpRestHandler } = await import("./adapters/http-rest.js");
    return executeHttpRestHandler(normalized, input, secret);
  }
  if (connectorId === "db-postgres" && secret) {
    const { executePostgresHandler } = await import("./adapters/postgres.js");
    return executePostgresHandler(normalized, input, secret);
  }
  if (connectorId === "db-mysql" && secret) {
    const { executeMysqlHandler } = await import("./adapters/mysql.js");
    return executeMysqlHandler(normalized, input, secret);
  }

  if (connectorId === "erp-sap" && secret) {
    const { executeErpSapHandler } = await import("./adapters/erp-sap.js");
    return executeErpSapHandler(normalized, input, secret);
  }
  if (connectorId === "erp-yonyou-tplus" && secret) {
    const { executeYonyouTplusHandler } = await import("./adapters/yonyou-tplus.js");
    return executeYonyouTplusHandler(normalized, input, secret);
  }

  assertWebsiteSessionDoesNotMock(normalized, options);
  assertProductionDoesNotMock(normalized, options);
  return executeMockHandler(normalized, input);
}

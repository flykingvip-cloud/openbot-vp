/**
 * MCP discovery → explicit mapping write path.
 *
 * Creates/binds ConnectorAction + mcp:// runtime handler + DataSource + DataCapability
 * only when called (admin Save). Does not create Grant / allowlist / pre-auth.
 * Does not auto-register tools/list results.
 */
import {
  findConnectorAction,
  upsertConnectorAction,
  EnterpriseDataStoreError,
} from "./connector-action-store.js";
import { upsertDataCapability } from "./data-capability-store.js";
import { findDataSourceByKey, upsertDataSource } from "./data-source-store.js";
import { parseMcpHandlerRef } from "./mcp-discovery.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import type {
  ConnectorAction,
  ConnectorRuntimeRegistryEntry,
  DataCapability,
  DataSource,
  EnterpriseDataStore,
} from "./types.js";

export const MCP_CONNECTOR_ID = "mcp";
export const MCP_ACTION_VERSION = "v1";

function sanitizeSegment(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "");
}

/** Build explicit mcp://server/tool handler ref (URL-encoded segments). */
export function buildMcpHandlerRef(serverName: string, toolName: string): string {
  const server = serverName.trim();
  const tool = toolName.trim();
  if (!server || !tool) {
    throw new EnterpriseDataStoreError(
      "MCP_MAPPING_REF_INVALID",
      "mcpServer and mcpTool are required to build an mcp:// handler.",
    );
  }
  return `mcp://${encodeURIComponent(server)}/${encodeURIComponent(tool)}`;
}

export function suggestMcpActionKey(serverName: string, toolName: string): string {
  const server = sanitizeSegment(serverName);
  const tool = sanitizeSegment(toolName);
  const raw = tool ? `${server}.${tool}` : server;
  return (raw || "mcp_tool").slice(0, 64);
}

export function suggestMcpCapabilityKey(serverName: string, toolName: string): string {
  return suggestMcpActionKey(serverName, toolName);
}

export function suggestMcpSourceKey(serverName: string): string {
  const server = sanitizeSegment(serverName) || "server";
  return `mcp.${server}`.slice(0, 64);
}

export type McpMappingDraftInput = {
  mcpServer: string;
  mcpTool: string;
  capabilityKey?: string;
  displayName?: string;
  description?: string;
  /** When set, updates an existing capability instead of creating a new key. */
  capabilityId?: string;
};

export type McpMappingResult = {
  handlerRef: string;
  action: ConnectorAction;
  registryEntry: ConnectorRuntimeRegistryEntry;
  source: DataSource;
  capability: DataCapability;
};

function requireServerTool(input: McpMappingDraftInput): { serverName: string; toolName: string } {
  const serverName = input.mcpServer.trim();
  const toolName = input.mcpTool.trim();
  if (!serverName || !toolName) {
    throw new EnterpriseDataStoreError(
      "MCP_MAPPING_REF_INVALID",
      "mcpServer and mcpTool are required.",
    );
  }
  return { serverName, toolName };
}

/**
 * Explicit Save path: action → mcp:// registry → per-server DataSource → DataCapability.
 * No seat Grant is written.
 */
export function upsertMcpToolMapping(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
  input: McpMappingDraftInput;
  createdBy?: string;
}): McpMappingResult {
  const { serverName, toolName } = requireServerTool(params.input);
  const handlerRef = buildMcpHandlerRef(serverName, toolName);
  // Round-trip guard so discovery classification can parse the stored ref.
  if (!parseMcpHandlerRef(handlerRef)) {
    throw new EnterpriseDataStoreError(
      "MCP_MAPPING_REF_INVALID",
      `Invalid mcp:// handler for ${serverName}/${toolName}.`,
    );
  }

  const actionKey =
    suggestMcpActionKey(serverName, toolName) ||
    `${sanitizeSegment(serverName) || "server"}.${sanitizeSegment(toolName) || "tool"}`;
  const capabilityKey =
    (params.input.capabilityKey?.trim() || suggestMcpCapabilityKey(serverName, toolName)).slice(
      0,
      64,
    ) || actionKey;
  const displayName = params.input.displayName?.trim() || toolName || serverName;
  const description =
    params.input.description?.trim() || `来自 MCP 发现：${serverName} / ${toolName}`;

  const existingAction = findConnectorAction(params.store, params.tenantId, {
    connectorId: MCP_CONNECTOR_ID,
    actionKey,
    version: MCP_ACTION_VERSION,
  });
  const action = upsertConnectorAction({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    action: {
      actionId: existingAction?.actionId,
      connectorId: MCP_CONNECTOR_ID,
      actionKey,
      version: MCP_ACTION_VERSION,
      displayName,
      category: "external",
      description,
      riskLevel: "LOW",
      requiresApproval: false,
      readOnly: true,
      outputSchema: { type: "object" },
      lifecycle: "active",
      createdBy: params.createdBy,
    },
  });

  const registryEntry = registerRuntimeHandler({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: MCP_CONNECTOR_ID,
    actionKey: action.actionKey,
    version: action.version,
    handlerRef,
    readOnly: true,
    registeredBy: params.createdBy,
    nowIso: params.nowIso,
  });

  const sourceKey = suggestMcpSourceKey(serverName);
  const existingSource = findDataSourceByKey(params.store, params.tenantId, sourceKey);
  const source = upsertDataSource({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    source: {
      sourceId: existingSource?.sourceId,
      sourceKey,
      displayName: `MCP · ${serverName}`,
      category: "external",
      status: "connected",
      connectorId: MCP_CONNECTOR_ID,
    },
  });

  const capability = upsertDataCapability({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    capability: {
      capabilityId: params.input.capabilityId?.trim() || undefined,
      capabilityKey,
      displayName,
      description,
      sourceIds: [source.sourceId],
      actionRefs: [
        {
          connectorId: action.connectorId,
          actionKey: action.actionKey,
          version: action.version,
        },
      ],
      enabled: true,
    },
  });

  return { handlerRef, action, registryEntry, source, capability };
}

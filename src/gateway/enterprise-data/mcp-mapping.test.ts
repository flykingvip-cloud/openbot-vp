import { describe, expect, it } from "vitest";
import { classifyMcpCapabilityDiscovery } from "./mcp-discovery.js";
import {
  buildMcpHandlerRef,
  MCP_CONNECTOR_ID,
  suggestMcpActionKey,
  suggestMcpCapabilityKey,
  upsertMcpToolMapping,
} from "./mcp-mapping.js";
import { listSeatActionGrants } from "./seat-action-grant-store.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-a";
const nowIso = "2026-10-08T12:00:00.000Z";

describe("mcp-mapping helpers", () => {
  it("builds an encodable mcp:// handler and sanitized keys", () => {
    expect(buildMcpHandlerRef("linear", "list_issues")).toBe("mcp://linear/list_issues");
    expect(buildMcpHandlerRef("Linear Ops", "list issues!")).toBe(
      "mcp://Linear%20Ops/list%20issues!",
    );
    expect(suggestMcpActionKey("Linear Ops", "list issues!")).toBe("linear_ops.list_issues");
    expect(suggestMcpCapabilityKey("Linear Ops", "list issues!")).toBe("linear_ops.list_issues");
  });
});

describe("upsertMcpToolMapping", () => {
  it("writes action + mcp:// registry + source + capability on explicit call", () => {
    const store = normalizeEnterpriseDataStore(null);
    const result = upsertMcpToolMapping({
      store,
      tenantId,
      nowIso,
      input: {
        mcpServer: "linear",
        mcpTool: "list_issues",
        capabilityKey: "linear.list_issues",
        displayName: "列出议题",
        description: "来自 MCP 发现：linear / list_issues",
      },
    });

    expect(result.handlerRef).toBe("mcp://linear/list_issues");
    expect(result.action).toMatchObject({
      connectorId: MCP_CONNECTOR_ID,
      actionKey: "linear.list_issues",
      version: "v1",
      lifecycle: "active",
      readOnly: true,
    });
    expect(result.registryEntry.handlerRef).toBe("mcp://linear/list_issues");
    expect(result.source).toMatchObject({
      connectorId: MCP_CONNECTOR_ID,
      sourceKey: "mcp.linear",
      category: "external",
    });
    expect(result.capability).toMatchObject({
      capabilityKey: "linear.list_issues",
      enabled: true,
      sourceIds: [result.source.sourceId],
      actionRefs: [
        {
          connectorId: MCP_CONNECTOR_ID,
          actionKey: "linear.list_issues",
          version: "v1",
        },
      ],
    });
    expect(listSeatActionGrants({ store, tenantId })).toEqual([]);
  });

  it("advances discovery projection to mapped_pending_grant without grants", () => {
    const store = normalizeEnterpriseDataStore(null);
    upsertMcpToolMapping({
      store,
      tenantId,
      nowIso,
      input: { mcpServer: "linear", mcpTool: "list_issues" },
    });

    const snapshot = classifyMcpCapabilityDiscovery({
      declaredTools: [{ serverName: "linear", toolName: "list_issues" }],
      remoteToolsList: "ok",
      registry: Object.values(store.connectorRuntimeRegistry),
      actions: Object.values(store.connectorActions),
      capabilities: Object.values(store.dataCapabilities),
      grants: Object.values(store.seatActionGrants),
    });

    expect(snapshot.items).toEqual([
      expect.objectContaining({
        serverName: "linear",
        toolName: "list_issues",
        status: "mapped_pending_grant",
        capabilityKey: "linear.list_issues",
      }),
    ]);
  });

  it("is idempotent for the same server/tool and still writes no grants", () => {
    const store = normalizeEnterpriseDataStore(null);
    const first = upsertMcpToolMapping({
      store,
      tenantId,
      nowIso,
      input: { mcpServer: "linear", mcpTool: "list_issues" },
    });
    const second = upsertMcpToolMapping({
      store,
      tenantId,
      nowIso: "2026-10-08T13:00:00.000Z",
      input: {
        mcpServer: "linear",
        mcpTool: "list_issues",
        capabilityId: first.capability.capabilityId,
        displayName: "列出议题（更新）",
      },
    });
    expect(second.action.actionId).toBe(first.action.actionId);
    expect(second.source.sourceId).toBe(first.source.sourceId);
    expect(second.capability.capabilityId).toBe(first.capability.capabilityId);
    expect(second.capability.displayName).toBe("列出议题（更新）");
    expect(listSeatActionGrants({ store, tenantId })).toEqual([]);
  });

  it("rejects missing tool and does not mutate the store", () => {
    const store = normalizeEnterpriseDataStore(null);
    expect(() =>
      upsertMcpToolMapping({
        store,
        tenantId,
        nowIso,
        input: { mcpServer: "linear", mcpTool: "  " },
      }),
    ).toThrow(/mcpServer and mcpTool/);
    expect(Object.keys(store.connectorActions)).toEqual([]);
    expect(Object.keys(store.dataCapabilities)).toEqual([]);
  });
});

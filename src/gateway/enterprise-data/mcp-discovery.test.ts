import { describe, expect, it } from "vitest";
import type { GovernanceRegistryEntry } from "../capability-governance-store.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  classifyMcpCapabilityDiscovery,
  describeMcpDiscoveryForSeatFailure,
  listTenantDeclaredMcpTools,
  listTenantRemoteMcpTools,
  parseMcpHandlerRef,
  presentMcpDiscoveryForSeat,
  projectMcpDiscoveryForSeat,
  type McpDiscoveryDeclaredTool,
} from "./mcp-discovery.js";
import type {
  ConnectorAction,
  ConnectorRuntimeRegistryEntry,
  DataCapability,
  SeatActionGrant,
} from "./types.js";

function action(overrides: Partial<ConnectorAction> = {}): ConnectorAction {
  return {
    actionId: "action-1",
    tenantId: "tenant-a",
    connectorId: "mcp",
    actionKey: "linear.list_issues",
    version: "v1",
    displayName: "列出议题",
    category: "mcp",
    riskLevel: "LOW",
    requiresApproval: false,
    readOnly: true,
    outputSchema: {},
    lifecycle: "active",
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
    ...overrides,
  };
}

function registry(
  handlerRef: string,
  actionOverrides: Partial<ConnectorAction> = {},
): {
  entry: ConnectorRuntimeRegistryEntry;
  action: ConnectorAction;
} {
  const bound = action(actionOverrides);
  return {
    action: bound,
    entry: {
      registryId: `reg-${bound.actionKey}`,
      tenantId: bound.tenantId,
      connectorId: bound.connectorId,
      actionKey: bound.actionKey,
      version: bound.version,
      handlerRef,
      readOnly: true,
      timeoutMs: 1000,
      registeredAt: "2026-10-07T00:00:00.000Z",
    },
  };
}

function capability(overrides: Partial<DataCapability> = {}): DataCapability {
  return {
    capabilityId: "cap-1",
    tenantId: "tenant-a",
    capabilityKey: "linear.issues",
    displayName: "议题查询",
    description: "查询 Linear 议题",
    sourceIds: [],
    actionRefs: [{ connectorId: "mcp", actionKey: "linear.list_issues", version: "v1" }],
    enabled: true,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
    ...overrides,
  };
}

function grant(overrides: Partial<SeatActionGrant> = {}): SeatActionGrant {
  return {
    grantId: "grant-1",
    tenantId: "tenant-a",
    seatId: "seat-1",
    connectorId: "mcp",
    actionKey: "linear.list_issues",
    version: "v1",
    effect: "allow",
    createdAt: "2026-10-07T00:00:00.000Z",
    ...overrides,
  };
}

function classify(input: {
  declaredTools?: McpDiscoveryDeclaredTool[];
  undeclaredServers?: string[];
  remoteTools?: McpDiscoveryDeclaredTool[];
  remoteToolsList?: "ok" | "unavailable" | "partial";
  registry?: ConnectorRuntimeRegistryEntry[];
  actions?: ConnectorAction[];
  capabilities?: DataCapability[];
  grants?: SeatActionGrant[];
}) {
  return classifyMcpCapabilityDiscovery({
    declaredTools: input.declaredTools ?? [],
    undeclaredServers: input.undeclaredServers,
    remoteTools: input.remoteTools,
    remoteToolsList: input.remoteToolsList,
    registry: input.registry ?? [],
    actions: input.actions ?? [],
    capabilities: input.capabilities ?? [],
    grants: input.grants ?? [],
  });
}

describe("parseMcpHandlerRef", () => {
  it("accepts an explicit mcp://server/tool handler and rejects other refs", () => {
    expect(parseMcpHandlerRef("mcp://linear/list_issues")).toEqual({
      serverName: "linear",
      toolName: "list_issues",
    });
    expect(parseMcpHandlerRef("enterprise-data/handlers/crm-customer-read-summary-v1")).toBeNull();
    expect(parseMcpHandlerRef("mcp://linear")).toBeNull();
  });
});

describe("classifyMcpCapabilityDiscovery", () => {
  it("reports the remote tools list as unavailable and an empty coming gap", () => {
    const snapshot = classify({});
    expect(snapshot.remoteToolsList).toBe("unavailable");
    expect(snapshot.gap).toBe("remote_tools_list_unavailable");
    expect(snapshot.items).toEqual([]);
  });

  it("keeps a declared tool unmapped until it is an active capability action", () => {
    const snapshot = classify({
      declaredTools: [{ serverName: "linear", toolName: "list_issues" }],
    });
    expect(snapshot.gap).toBe("none");
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        serverName: "linear",
        toolName: "list_issues",
        status: "unmapped",
        capabilityId: null,
        actionRef: null,
      }),
    ]);
  });

  it("stays unmapped when a handler exists but no data capability references it", () => {
    const mapped = registry("mcp://linear/list_issues");
    const snapshot = classify({
      registry: [mapped.entry],
      actions: [mapped.action],
    });
    expect(snapshot.items[0]).toMatchObject({
      status: "unmapped",
      capabilityId: null,
      actionRef: { connectorId: "mcp", actionKey: "linear.list_issues", version: "v1" },
    });
  });

  it("marks a mapped capability as pending until every action has an active seat grant", () => {
    const mapped = registry("mcp://linear/list_issues");
    const snapshot = classify({
      registry: [mapped.entry],
      actions: [mapped.action],
      capabilities: [capability({ enabled: true })],
    });
    expect(snapshot.items[0]).toMatchObject({
      status: "mapped_pending_grant",
      capabilityKey: "linear.issues",
      actionRef: { connectorId: "mcp", actionKey: "linear.list_issues", version: "v1" },
    });
  });

  it("does not treat a disabled capability or a revoked grant as authorized", () => {
    const mapped = registry("mcp://linear/list_issues");
    const disabled = classify({
      registry: [mapped.entry],
      actions: [mapped.action],
      capabilities: [capability({ enabled: false })],
      grants: [grant()],
    });
    expect(disabled.items[0]?.status).toBe("mapped_pending_grant");

    const revoked = classify({
      registry: [mapped.entry],
      actions: [mapped.action],
      capabilities: [capability()],
      grants: [grant({ revokedAt: "2026-10-07T01:00:00.000Z" })],
    });
    expect(revoked.items[0]?.status).toBe("mapped_pending_grant");
  });

  it("authorizes only when the capability is enabled and every action ref is granted", () => {
    const mapped = registry("mcp://linear/list_issues");
    const extraRef = { connectorId: "mcp", actionKey: "linear.get_issue", version: "v1" };
    const partial = classify({
      registry: [mapped.entry],
      actions: [mapped.action],
      capabilities: [capability({ actionRefs: [...capability().actionRefs, extraRef] })],
      grants: [grant()],
    });
    expect(partial.items[0]?.status).toBe("mapped_pending_grant");

    const ready = classify({
      registry: [mapped.entry],
      actions: [mapped.action],
      capabilities: [capability()],
      grants: [grant()],
    });
    expect(ready.items[0]).toMatchObject({
      status: "authorized",
      capabilityDisplayName: "议题查询",
    });
  });

  it("ignores frozen actions and non-mcp handlers", () => {
    const frozen = registry("mcp://linear/list_issues", { lifecycle: "frozen" });
    const native = registry("enterprise-data/handlers/crm-customer-read-summary-v1", {
      actionKey: "crm.read",
      connectorId: "crm-salesforce",
    });
    const snapshot = classify({
      declaredTools: [{ serverName: "linear", toolName: "list_issues" }],
      registry: [frozen.entry, native.entry],
      actions: [frozen.action, native.action],
      capabilities: [
        capability({
          actionRefs: [{ connectorId: "crm-salesforce", actionKey: "crm.read", version: "v1" }],
        }),
      ],
      grants: [grant({ connectorId: "crm-salesforce", actionKey: "crm.read" })],
    });
    expect(snapshot.items).toEqual([
      expect.objectContaining({ toolName: "list_issues", status: "unmapped" }),
    ]);
  });

  it("shows one unmapped server row when the allowlist is empty, and drops it once a tool exists", () => {
    const empty = classify({ undeclaredServers: ["linear"] });
    expect(empty.items).toEqual([
      expect.objectContaining({ serverName: "linear", toolName: "", status: "unmapped" }),
    ]);

    const withTool = classify({
      undeclaredServers: ["linear"],
      declaredTools: [{ serverName: "linear", toolName: "list_issues" }],
    });
    expect(withTool.items.map((item) => item.toolName)).toEqual(["list_issues"]);
  });

  it("merges remote tools as unmapped candidates and reports ok / no_candidates", () => {
    const withRemote = classify({
      remoteToolsList: "ok",
      remoteTools: [{ serverName: "linear", toolName: "search" }],
    });
    expect(withRemote.remoteToolsList).toBe("ok");
    expect(withRemote.gap).toBe("none");
    expect(withRemote.items).toEqual([
      expect.objectContaining({
        serverName: "linear",
        toolName: "search",
        status: "unmapped",
      }),
    ]);

    const emptyOk = classify({ remoteToolsList: "ok", remoteTools: [] });
    expect(emptyOk.gap).toBe("no_candidates");
    expect(emptyOk.items).toEqual([]);
  });

  it("keeps declared tools when remote list is only partial", () => {
    const snapshot = classify({
      remoteToolsList: "partial",
      declaredTools: [{ serverName: "linear", toolName: "list_issues" }],
      remoteTools: [{ serverName: "linear", toolName: "search" }],
    });
    expect(snapshot.remoteToolsList).toBe("partial");
    expect(snapshot.items.map((item) => item.toolName).toSorted()).toEqual([
      "list_issues",
      "search",
    ]);
  });
});

describe("listTenantRemoteMcpTools", () => {
  function entry(overrides: {
    tenantIds?: string[];
    lifecycleState?: GovernanceRegistryEntry["lifecycleState"];
    assetType?: string;
    skillKey?: string;
  }): GovernanceRegistryEntry {
    return {
      manifest: {
        id: "manifest-1",
        kind: "skill",
        version: "1",
        skillKey: overrides.skillKey ?? "skill-linear",
        name: "Linear",
        description: "",
        source: { kind: "employee", origin: "local", trustTier: "tenant" },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
        assetType: overrides.assetType ?? "mcp",
      },
      lifecycleState: overrides.lifecycleState ?? "active",
      distribution: {
        capabilityId: "manifest-1",
        scope: { tenantIds: overrides.tenantIds ?? ["tenant-a"] },
        defaultEnabled: false,
        employeeVisibilityMode: "enterprise_only",
        updatedAt: "2026-10-07T00:00:00.000Z",
      },
      createdAt: "2026-10-07T00:00:00.000Z",
      updatedAt: "2026-10-07T00:00:00.000Z",
    };
  }

  it("skips cross-tenant assets and returns ok empty when no tenant MCP servers exist", () => {
    const result = listTenantRemoteMcpTools("tenant-a", {
      listRegistry: () => [entry({ tenantIds: ["tenant-b"], skillKey: "skill-other" })],
      readBinding: () => ({
        runtimeDefinition: { mcpBinding: { serverName: "other", toolAllowlist: ["x"] } },
      }),
      isServerMaterialized: () => true,
      listRemoteTools: () => ({ ok: true, toolNames: ["should_not_appear"] }),
    });
    expect(result).toEqual({ status: "ok", tools: [], unavailableServers: [] });
  });

  it("marks non-materialized servers unavailable and never invents Suggested tools", () => {
    const result = listTenantRemoteMcpTools("tenant-a", {
      listRegistry: () => [entry({})],
      readBinding: () => ({
        runtimeDefinition: { mcpBinding: { serverName: "linear" } },
      }),
      isServerMaterialized: () => false,
      listRemoteTools: () => ({ ok: true, toolNames: ["secret"] }),
    });
    expect(result.status).toBe("unavailable");
    expect(result.tools).toEqual([]);
    expect(result.unavailableServers).toEqual(["linear"]);
  });

  it("treats probe timeout/failure as unavailable for that server", () => {
    const result = listTenantRemoteMcpTools("tenant-a", {
      listRegistry: () => [entry({})],
      readBinding: () => ({
        runtimeDefinition: { mcpBinding: { serverName: "linear" } },
      }),
      isServerMaterialized: () => true,
      listRemoteTools: () => ({ ok: false, toolNames: [], failureReason: "timeout" }),
    });
    expect(result.status).toBe("unavailable");
    expect(result.tools).toEqual([]);
    expect(result.unavailableServers).toEqual(["linear"]);
  });

  it("returns ok with empty tools when list succeeds but remote has none", () => {
    const result = listTenantRemoteMcpTools("tenant-a", {
      listRegistry: () => [entry({})],
      readBinding: () => ({
        runtimeDefinition: { mcpBinding: { serverName: "linear" } },
      }),
      isServerMaterialized: () => true,
      listRemoteTools: () => ({ ok: true, toolNames: [] }),
    });
    expect(result).toEqual({ status: "ok", tools: [], unavailableServers: [] });
  });

  it("merges successful remote tools and reports partial when one server fails", () => {
    const result = listTenantRemoteMcpTools("tenant-a", {
      listRegistry: () => [
        entry({ skillKey: "skill-linear" }),
        entry({ skillKey: "skill-github", tenantIds: ["tenant-a"] }),
      ],
      readBinding: (skillId) => ({
        runtimeDefinition: {
          mcpBinding: {
            serverName: skillId === "skill-github" ? "github" : "linear",
          },
        },
      }),
      isServerMaterialized: (serverName) => serverName === "linear" || serverName === "github",
      listRemoteTools: (serverName) => {
        if (serverName === "linear") {
          return { ok: true, toolNames: ["list_issues", "search", " "] };
        }
        return { ok: false, toolNames: [], failureReason: "connection refused" };
      },
    });
    expect(result.status).toBe("partial");
    expect(result.tools).toEqual([
      { serverName: "linear", toolName: "list_issues" },
      { serverName: "linear", toolName: "search" },
    ]);
    expect(result.unavailableServers).toEqual(["github"]);
  });
});

describe("listTenantDeclaredMcpTools", () => {
  function entry(overrides: {
    tenantIds?: string[];
    lifecycleState?: GovernanceRegistryEntry["lifecycleState"];
    assetType?: string;
    skillKey?: string;
  }): GovernanceRegistryEntry {
    return {
      manifest: {
        id: "manifest-1",
        kind: "skill",
        version: "1",
        skillKey: overrides.skillKey ?? "skill-linear",
        name: "Linear",
        description: "",
        source: { kind: "employee", origin: "local", trustTier: "tenant" },
        risk: {
          level: "low",
          network: false,
          filesystem: false,
          subprocess: false,
          secrets: false,
        },
        assetType: overrides.assetType ?? "mcp",
      },
      lifecycleState: overrides.lifecycleState ?? "active",
      distribution: {
        capabilityId: "manifest-1",
        scope: { tenantIds: overrides.tenantIds ?? ["tenant-a"] },
        defaultEnabled: false,
        employeeVisibilityMode: "enterprise_only",
        updatedAt: "2026-10-07T00:00:00.000Z",
      },
      createdAt: "2026-10-07T00:00:00.000Z",
      updatedAt: "2026-10-07T00:00:00.000Z",
    };
  }

  it("reads only this tenant's approved MCP allowlist and skips other tenants", () => {
    const result = listTenantDeclaredMcpTools("tenant-a", {
      listRegistry: () => [
        entry({}),
        entry({ tenantIds: ["tenant-b"], skillKey: "skill-other" }),
        entry({ lifecycleState: "draft", skillKey: "skill-draft" }),
        entry({ assetType: "skill", skillKey: "skill-plain" }),
      ],
      readBinding: (skillId) => {
        if (skillId === "skill-linear") {
          return {
            runtimeDefinition: {
              mcpBinding: { serverName: "linear", toolAllowlist: ["list_issues", " "] },
            },
          };
        }
        return {
          runtimeDefinition: {
            mcpBinding: { serverName: "other", toolAllowlist: ["secret_tool"] },
          },
        };
      },
    });
    expect(result.declaredTools).toEqual([{ serverName: "linear", toolName: "list_issues" }]);
    expect(result.undeclaredServers).toEqual([]);
  });

  it("fail-closes when the binding is missing and records servers with no tool names", () => {
    const missing = listTenantDeclaredMcpTools("tenant-a", {
      listRegistry: () => [entry({})],
      readBinding: () => {
        throw new Error("missing");
      },
    });
    expect(missing).toEqual({ declaredTools: [], undeclaredServers: [] });

    const unnamed = listTenantDeclaredMcpTools("tenant-a", {
      listRegistry: () => [entry({})],
      readBinding: () => ({ runtimeDefinition: { mcpBinding: { serverName: "linear" } } }),
    });
    expect(unnamed.undeclaredServers).toEqual(["linear"]);
    expect(unnamed.declaredTools).toEqual([]);
  });
});

describe("classifyMcpCapabilityDiscovery seat scope", () => {
  it("does not treat another seat's grant as authorized when seatId is set", () => {
    const mapped = registry("mcp://hubspot/list_leads", { actionKey: "hubspot.list_leads" });
    const cap = capability({
      capabilityId: "cap-leads",
      capabilityKey: "hubspot.list_leads",
      displayName: "线索列表",
      actionRefs: [{ connectorId: "mcp", actionKey: "hubspot.list_leads", version: "v1" }],
    });
    const otherSeat = grant({
      grantId: "grant-other",
      seatId: "seat-other",
      actionKey: "hubspot.list_leads",
    });
    const pending = classifyMcpCapabilityDiscovery({
      declaredTools: [],
      registry: [mapped.entry],
      actions: [mapped.action],
      capabilities: [cap],
      grants: [otherSeat],
      seatId: "seat-self",
    });
    expect(pending.items[0]).toMatchObject({
      status: "mapped_pending_grant",
      capabilityId: "cap-leads",
      capabilityDisplayName: "线索列表",
    });

    const authorized = classifyMcpCapabilityDiscovery({
      declaredTools: [],
      registry: [mapped.entry],
      actions: [mapped.action],
      capabilities: [cap],
      grants: [
        otherSeat,
        grant({ grantId: "grant-self", seatId: "seat-self", actionKey: "hubspot.list_leads" }),
      ],
      seatId: "seat-self",
    });
    expect(authorized.items[0]?.status).toBe("authorized");
  });

  it("keeps the admin view authorized from any seat when seatId is omitted", () => {
    const mapped = registry("mcp://hubspot/list_leads", { actionKey: "hubspot.list_leads" });
    const snapshot = classify({
      registry: [mapped.entry],
      actions: [mapped.action],
      capabilities: [
        capability({
          actionRefs: [{ connectorId: "mcp", actionKey: "hubspot.list_leads", version: "v1" }],
        }),
      ],
      grants: [grant({ seatId: "seat-other", actionKey: "hubspot.list_leads" })],
    });
    expect(snapshot.items[0]?.status).toBe("authorized");
    expect(snapshot.items[0]?.actionRef).toEqual({
      connectorId: "mcp",
      actionKey: "hubspot.list_leads",
      version: "v1",
    });
  });
});

describe("projectMcpDiscoveryForSeat", () => {
  it("keeps capability identity and drops action refs", () => {
    const projected = projectMcpDiscoveryForSeat({
      seatId: "seat-self",
      snapshot: {
        remoteToolsList: "unavailable",
        gap: "remote_tools_list_unavailable",
        items: [
          {
            serverName: "hubspot",
            toolName: "",
            status: "unmapped",
            capabilityId: null,
            capabilityKey: null,
            capabilityDisplayName: null,
            actionRef: { connectorId: "mcp", actionKey: "hubspot.list_leads", version: "v1" },
          },
        ],
      },
    });
    expect(projected.gap).toBe("remote_tools_list_unavailable");
    expect(projected.seatId).toBe("seat-self");
    expect(projected.items[0]).toEqual({
      serverName: "hubspot",
      toolName: "",
      status: "unmapped",
      capabilityId: null,
      capabilityKey: null,
      capabilityDisplayName: null,
    });
    expect(JSON.stringify(projected)).not.toContain("actionRef");
    expect(JSON.stringify(projected)).not.toContain("connectorId");
  });
});

describe("presentMcpDiscoveryForSeat", () => {
  const snapshot = {
    remoteToolsList: "ok" as const,
    gap: "none" as const,
    items: [
      {
        serverName: "gmail",
        toolName: "list_messages",
        status: "unmapped" as const,
        capabilityId: null,
        capabilityKey: "mail.list",
        capabilityDisplayName: "收件箱",
        actionRef: { connectorId: "mcp", actionKey: "gmail.list_messages", version: "v1" },
      },
      {
        serverName: "linear",
        toolName: "list_issues",
        status: "authorized" as const,
        capabilityId: "cap-linear",
        capabilityKey: "linear.issues",
        capabilityDisplayName: "议题",
        actionRef: { connectorId: "mcp", actionKey: "linear.list_issues", version: "v1" },
      },
    ],
  };

  it("keeps matching tools and drops the rest for a role template", () => {
    const projected = presentMcpDiscoveryForSeat({
      seatId: "seat-self",
      snapshot,
      catalogId: "email",
    });
    expect(projected.filterApplied).toBe(true);
    expect(projected.templateId).toBe("personal_mail_assistant");
    expect(projected.items.map((item) => item.serverName)).toEqual(["gmail"]);
    expect(projected.matchedHints).toEqual(expect.arrayContaining(["gmail"]));
    expect(JSON.stringify(projected)).not.toContain("actionRef");
    expect(JSON.stringify(projected)).not.toContain("linear");
  });

  it("returns no_role for generic_worker and stays unfiltered when no role is given", () => {
    const generic = presentMcpDiscoveryForSeat({
      seatId: "seat-self",
      snapshot,
      templateId: "generic_worker",
    });
    expect(generic.items).toEqual([]);
    expect(generic.emptyReason).toBe("no_role");
    const open = presentMcpDiscoveryForSeat({ seatId: "seat-self", snapshot });
    expect(open.filterApplied).toBe(false);
    expect(open.items).toHaveLength(2);
    expect(open.emptyReason).toBeNull();
  });
});

describe("describeMcpDiscoveryForSeatFailure", () => {
  it("hard-fails a missing seat in Chinese and hides connection strings", () => {
    const missingSeat = describeMcpDiscoveryForSeatFailure(
      new EnterpriseDataStoreError("NO_CURRENT_SEAT", "Active seat binding not found."),
    );
    expect(missingSeat).toEqual({
      code: "NO_CURRENT_SEAT",
      message: "当前会话没有可用席位，无法查看 MCP 能力。",
    });
    const leaked = describeMcpDiscoveryForSeatFailure(
      new Error("connect ECONNREFUSED postgres://user:pass@10.0.0.1/db\n    at Client.connect"),
    );
    expect(leaked.message).toBe("暂时无法读取本席位的 MCP 能力，请稍后重试。");
    expect(leaked.message).not.toContain("postgres://");
    expect(leaked.message).not.toContain("at Client.connect");
  });
});

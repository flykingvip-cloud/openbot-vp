/**
 * Read-only MCP discovery projection for the capability center.
 *
 * Rows come from: (1) tools declared on a tenant-scoped MCP asset allowlist,
 * (2) explicit `mcp://<server>/<tool>` runtime handlers, and (3) when available,
 * a fail-closed remote `tools/list` against MCP servers already materialized
 * into the local mcporter config. Nothing here installs, registers, or grants.
 */
import type { GovernanceRegistryEntry } from "../capability-governance-store.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import {
  emptyReasonForUnmatchedDaibaiMcpItems,
  resolveDaibaiMcpRoleFilter,
  scoreDaibaiMcpHintItem,
  type DaibaiMcpScanEmptyReason,
} from "./daibai-mcp-scan-hints.js";
import type {
  ConnectorAction,
  ConnectorActionRef,
  ConnectorRuntimeRegistryEntry,
  DataCapability,
  SeatActionGrant,
} from "./types.js";

export type McpDiscoveryStatus = "unmapped" | "mapped_pending_grant" | "authorized";

export type McpRemoteToolsListStatus = "ok" | "unavailable" | "partial";

export type McpDiscoveryDeclaredTool = {
  serverName: string;
  toolName: string;
};

export type McpDiscoveryItem = {
  serverName: string;
  /** Empty when the server is known but no tool name was declared or mapped. */
  toolName: string;
  status: McpDiscoveryStatus;
  capabilityId: string | null;
  capabilityKey: string | null;
  capabilityDisplayName: string | null;
  actionRef: ConnectorActionRef | null;
};

export type McpDiscoveryGap = "none" | "remote_tools_list_unavailable" | "no_candidates";

export type McpDiscoverySnapshot = {
  remoteToolsList: McpRemoteToolsListStatus;
  gap: McpDiscoveryGap;
  items: McpDiscoveryItem[];
};

export type McpRemoteToolsListOutcome = {
  status: McpRemoteToolsListStatus;
  tools: McpDiscoveryDeclaredTool[];
  unavailableServers: string[];
};

const MCP_HANDLER_REF = /^mcp:\/\/([^/\s]+)\/([^/\s]+)$/;
const VISIBLE_ASSET_LIFECYCLES = new Set(["approved", "active", "deprecated"]);

export function parseMcpHandlerRef(
  handlerRef: string,
): { serverName: string; toolName: string } | null {
  const match = MCP_HANDLER_REF.exec(handlerRef.trim());
  const rawServer = match?.[1];
  const rawTool = match?.[2];
  if (!rawServer || !rawTool) {
    return null;
  }
  let serverName = rawServer;
  let toolName = rawTool;
  try {
    serverName = decodeURIComponent(rawServer);
    toolName = decodeURIComponent(rawTool);
  } catch {
    return null;
  }
  if (!serverName || !toolName) {
    return null;
  }
  return { serverName, toolName };
}

function toolKey(serverName: string, toolName: string): string {
  return `${serverName}\0${toolName}`;
}

function refKey(ref: ConnectorActionRef): string {
  return `${ref.connectorId}\0${ref.actionKey}\0${ref.version}`;
}

function activeGrantKeys(grants: readonly SeatActionGrant[]): Set<string> {
  const keys = new Set<string>();
  for (const grant of grants) {
    if (grant.revokedAt || grant.effect !== "allow") {
      continue;
    }
    keys.add(refKey(grant));
  }
  return keys;
}

/** A capability is employee-visible only when it is enabled and every action is granted. */
function capabilityFullyGranted(capability: DataCapability, grantKeys: Set<string>): boolean {
  if (!capability.enabled || capability.actionRefs.length === 0) {
    return false;
  }
  return capability.actionRefs.every((ref) => grantKeys.has(refKey(ref)));
}

type MappedTool = {
  serverName: string;
  toolName: string;
  action: ConnectorAction;
};

export function classifyMcpCapabilityDiscovery(input: {
  declaredTools: readonly McpDiscoveryDeclaredTool[];
  /** MCP servers visible to the tenant whose tool names were not declared. */
  undeclaredServers?: readonly string[];
  /** Remote tools/list results already filtered to this tenant. */
  remoteTools?: readonly McpDiscoveryDeclaredTool[];
  /** Defaults to unavailable when omitted (legacy / tests without remote wiring). */
  remoteToolsList?: McpRemoteToolsListStatus;
  registry: readonly ConnectorRuntimeRegistryEntry[];
  actions: readonly ConnectorAction[];
  capabilities: readonly DataCapability[];
  grants: readonly SeatActionGrant[];
  /**
   * When set, only this seat's grants can mark a row `authorized`.
   * Omit it for the admin all-tenant view.
   */
  seatId?: string;
}): McpDiscoverySnapshot {
  const actionsByRef = new Map<string, ConnectorAction>();
  for (const action of input.actions) {
    actionsByRef.set(refKey(action), action);
  }

  const mapped = new Map<string, MappedTool>();
  for (const entry of input.registry) {
    const parsed = parseMcpHandlerRef(entry.handlerRef);
    if (!parsed) {
      continue;
    }
    const action = actionsByRef.get(refKey(entry));
    // Draft / frozen actions are not a completed mapping. Only an active
    // action with an explicit mcp:// handler counts.
    if (!action || action.lifecycle !== "active") {
      continue;
    }
    const key = toolKey(parsed.serverName, parsed.toolName);
    const existing = mapped.get(key);
    if (!existing || action.actionKey.localeCompare(existing.action.actionKey) < 0) {
      mapped.set(key, { ...parsed, action });
    }
  }

  const declaredKeys = new Set<string>();
  const serversWithTools = new Set<string>();
  const ingestDeclared = (tools: readonly McpDiscoveryDeclaredTool[]) => {
    for (const tool of tools) {
      const serverName = tool.serverName.trim();
      const toolName = tool.toolName.trim();
      if (!serverName || !toolName) {
        continue;
      }
      declaredKeys.add(toolKey(serverName, toolName));
      serversWithTools.add(serverName);
    }
  };
  ingestDeclared(input.declaredTools);
  ingestDeclared(input.remoteTools ?? []);

  for (const key of mapped.keys()) {
    const serverName = key.split("\0")[0] ?? "";
    if (serverName) {
      serversWithTools.add(serverName);
    }
  }

  const keys = new Set<string>([...declaredKeys, ...mapped.keys()]);
  for (const serverName of input.undeclaredServers ?? []) {
    const trimmed = serverName.trim();
    if (!trimmed || serversWithTools.has(trimmed)) {
      continue;
    }
    keys.add(toolKey(trimmed, ""));
  }

  const scopedGrants = input.seatId
    ? input.grants.filter((grant) => grant.seatId === input.seatId)
    : input.grants;
  const grantKeys = activeGrantKeys(scopedGrants);
  const items: McpDiscoveryItem[] = [];
  for (const key of keys) {
    const separator = key.indexOf("\0");
    const serverName = separator === -1 ? key : key.slice(0, separator);
    const toolName = separator === -1 ? "" : key.slice(separator + 1);
    if (!serverName) {
      continue;
    }
    const mapping = toolName ? mapped.get(key) : undefined;
    const referencing = mapping
      ? input.capabilities
          .filter((capability) =>
            capability.actionRefs.some((ref) => refKey(ref) === refKey(mapping.action)),
          )
          .toSorted((left, right) => left.capabilityKey.localeCompare(right.capabilityKey))
      : [];
    const authorized = referencing.find((capability) =>
      capabilityFullyGranted(capability, grantKeys),
    );
    const pending = referencing[0];
    let status: McpDiscoveryStatus = "unmapped";
    let chosen: DataCapability | undefined;
    if (mapping && authorized) {
      status = "authorized";
      chosen = authorized;
    } else if (mapping && pending) {
      status = "mapped_pending_grant";
      chosen = pending;
    }
    items.push({
      serverName,
      toolName,
      status,
      capabilityId: chosen?.capabilityId ?? null,
      capabilityKey: chosen?.capabilityKey ?? null,
      capabilityDisplayName: chosen?.displayName ?? null,
      actionRef: mapping
        ? {
            connectorId: mapping.action.connectorId,
            actionKey: mapping.action.actionKey,
            version: mapping.action.version,
          }
        : null,
    });
  }

  items.sort((left, right) => {
    const byServer = left.serverName.localeCompare(right.serverName);
    if (byServer !== 0) {
      return byServer;
    }
    return left.toolName.localeCompare(right.toolName);
  });

  const remoteToolsList: McpRemoteToolsListStatus = input.remoteToolsList ?? "unavailable";
  let gap: McpDiscoveryGap = "none";
  if (items.length === 0) {
    gap = remoteToolsList === "unavailable" ? "remote_tools_list_unavailable" : "no_candidates";
  }

  return {
    remoteToolsList,
    gap,
    items,
  };
}

/** Employee for-seat row: capability identity only. No action refs or grant ids. */
export type McpDiscoverySeatItem = {
  serverName: string;
  toolName: string;
  status: McpDiscoveryStatus;
  capabilityId: string | null;
  capabilityKey: string | null;
  capabilityDisplayName: string | null;
};

export type McpDiscoverySeatProjection = {
  seatId: string;
  remoteToolsList: McpRemoteToolsListStatus;
  gap: McpDiscoveryGap;
  items: McpDiscoverySeatItem[];
};

export const MCP_DISCOVERY_FOR_SEAT_NO_SEAT_MESSAGE = "当前会话没有可用席位，无法查看 MCP 能力。";
export const MCP_DISCOVERY_FOR_SEAT_TENANT_MISMATCH_MESSAGE = "tenantId 必须与当前企业会话一致。";
export const MCP_DISCOVERY_FOR_SEAT_IDENTITY_MESSAGE = "无法确认当前企业身份，请重新登录后再试。";
export const MCP_DISCOVERY_FOR_SEAT_UNAVAILABLE_MESSAGE =
  "暂时无法读取本席位的 MCP 能力，请稍后重试。";

const FOR_SEAT_IDENTITY_CODES = new Set([
  "IDENTITY_CONTEXT_MISSING",
  "MEMBERSHIP_INVALID",
  "TENANT_CONTEXT_MISSING",
]);

/**
 * Seat-scoped projection. Whitelists fields so admin action refs, grants,
 * and any future internal columns stay off the employee response.
 */
export function projectMcpDiscoveryForSeat(input: {
  seatId: string;
  snapshot: McpDiscoverySnapshot;
}): McpDiscoverySeatProjection {
  return {
    seatId: input.seatId,
    remoteToolsList: input.snapshot.remoteToolsList,
    gap: input.snapshot.gap,
    items: input.snapshot.items.map((item) => ({
      serverName: item.serverName,
      toolName: item.toolName,
      status: item.status,
      capabilityId: item.capabilityId,
      capabilityKey: item.capabilityKey,
      capabilityDisplayName: item.capabilityDisplayName,
    })),
  };
}

export type McpDiscoverySeatRoleProjection = McpDiscoverySeatProjection & {
  /** True when catalogId, templateId, or a known session role binding selected a filter. */
  filterApplied: boolean;
  catalogId?: string;
  templateId?: string;
  emptyReason: DaibaiMcpScanEmptyReason;
  /** Keywords that kept at least one row. Empty when the filter did not run or nothing matched. */
  matchedHints: string[];
};

/**
 * Seat projection plus optional 大白 template prefilter.
 * Ranking uses the same hint table as Stage C. Action refs are dropped before matching.
 * Unspecified role → unfiltered seat projection (client may still filter).
 * generic_worker / unknown catalog → empty items + emptyReason no_role.
 */
export function presentMcpDiscoveryForSeat(input: {
  seatId: string;
  snapshot: McpDiscoverySnapshot;
  catalogId?: string | null;
  templateId?: string | null;
}): McpDiscoverySeatRoleProjection {
  const projected = projectMcpDiscoveryForSeat(input);
  const role = resolveDaibaiMcpRoleFilter({
    catalogId: input.catalogId,
    templateId: input.templateId,
  });
  if (!role.specified) {
    return {
      ...projected,
      filterApplied: false,
      emptyReason: null,
      matchedHints: [],
    };
  }
  if (!role.hasRoleTemplate) {
    return {
      ...projected,
      items: [],
      filterApplied: true,
      ...(role.catalogId ? { catalogId: role.catalogId } : {}),
      templateId: role.templateId,
      emptyReason: "no_role",
      matchedHints: [],
    };
  }

  const ranked: Array<{ item: McpDiscoverySeatItem; score: number; matched: string[] }> = [];
  for (const item of projected.items) {
    const serverName = item.serverName.trim();
    if (!serverName) {
      continue;
    }
    const scored = scoreDaibaiMcpHintItem(
      {
        serverName,
        toolName: item.toolName.trim(),
        capabilityKey: item.capabilityKey,
        capabilityDisplayName: item.capabilityDisplayName,
      },
      role.hints,
    );
    if (scored.score <= 0) {
      continue;
    }
    ranked.push({ item, score: scored.score, matched: scored.matched });
  }
  ranked.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const byServer = left.item.serverName.localeCompare(right.item.serverName);
    if (byServer !== 0) {
      return byServer;
    }
    return left.item.toolName.localeCompare(right.item.toolName);
  });
  const matchedHints = [...new Set(ranked.flatMap((entry) => entry.matched))];
  const emptyReason: DaibaiMcpScanEmptyReason =
    ranked.length > 0
      ? null
      : emptyReasonForUnmatchedDaibaiMcpItems({
          itemCount: projected.items.length,
          remoteToolsList: projected.remoteToolsList,
          gap: projected.gap,
        });
  return {
    ...projected,
    items: ranked.map((entry) => entry.item),
    filterApplied: true,
    ...(role.catalogId ? { catalogId: role.catalogId } : {}),
    templateId: role.templateId,
    emptyReason,
    matchedHints,
  };
}

/**
 * User-facing for-seat failure. Never forwards raw Error.message (connection
 * strings, oauth material, stack traces).
 */
export function describeMcpDiscoveryForSeatFailure(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof EnterpriseDataStoreError) {
    if (error.code === "NO_CURRENT_SEAT") {
      return { code: error.code, message: MCP_DISCOVERY_FOR_SEAT_NO_SEAT_MESSAGE };
    }
    if (error.code === "TENANT_MISMATCH") {
      return { code: error.code, message: MCP_DISCOVERY_FOR_SEAT_TENANT_MISMATCH_MESSAGE };
    }
    if (FOR_SEAT_IDENTITY_CODES.has(error.code)) {
      return { code: error.code, message: MCP_DISCOVERY_FOR_SEAT_IDENTITY_MESSAGE };
    }
    return { code: error.code, message: MCP_DISCOVERY_FOR_SEAT_UNAVAILABLE_MESSAGE };
  }
  return {
    code: "MCP_DISCOVERY_UNAVAILABLE",
    message: MCP_DISCOVERY_FOR_SEAT_UNAVAILABLE_MESSAGE,
  };
}

type McpBindingReader = (skillId: string) => {
  runtimeDefinition: { mcpBinding?: { serverName?: string; toolAllowlist?: string[] } };
};

/**
 * Declared tools for one tenant. Fail closed: assets without this tenant in
 * `distribution.scope.tenantIds` are ignored, and missing bindings are skipped.
 */
export function listTenantDeclaredMcpTools(
  tenantId: string,
  deps: {
    listRegistry: () => readonly GovernanceRegistryEntry[];
    readBinding: McpBindingReader;
  },
): { declaredTools: McpDiscoveryDeclaredTool[]; undeclaredServers: string[] } {
  const declaredTools: McpDiscoveryDeclaredTool[] = [];
  const undeclaredServers: string[] = [];
  const seenTools = new Set<string>();
  const seenServers = new Set<string>();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return { declaredTools, undeclaredServers };
  }

  for (const entry of deps.listRegistry()) {
    if (!VISIBLE_ASSET_LIFECYCLES.has(entry.lifecycleState)) {
      continue;
    }
    const tenantIds = entry.distribution?.scope?.tenantIds ?? [];
    if (!tenantIds.includes(normalizedTenantId)) {
      continue;
    }
    const assetType = (entry.manifest as { assetType?: unknown }).assetType;
    if (assetType !== "mcp") {
      continue;
    }
    const skillId = entry.manifest.skillKey?.trim();
    if (!skillId) {
      continue;
    }
    let binding: { serverName?: string; toolAllowlist?: string[] } | undefined;
    try {
      binding = deps.readBinding(skillId).runtimeDefinition.mcpBinding;
    } catch {
      continue;
    }
    const serverName = binding?.serverName?.trim() ?? "";
    if (!serverName) {
      continue;
    }
    const tools = (binding?.toolAllowlist ?? []).map((tool) => tool.trim()).filter(Boolean);
    if (tools.length === 0) {
      if (!seenServers.has(serverName)) {
        seenServers.add(serverName);
        undeclaredServers.push(serverName);
      }
      continue;
    }
    for (const toolName of tools) {
      const key = toolKey(serverName, toolName);
      if (seenTools.has(key)) {
        continue;
      }
      seenTools.add(key);
      declaredTools.push({ serverName, toolName });
    }
  }

  return { declaredTools, undeclaredServers };
}

export type ListTenantRemoteMcpToolsDeps = {
  listRegistry: () => readonly GovernanceRegistryEntry[];
  readBinding: McpBindingReader;
  /** True only when the server is already written into local mcporter config. */
  isServerMaterialized: (serverName: string) => boolean;
  /** List-only remote probe; must not perform sample calls. */
  listRemoteTools: (serverName: string) => {
    ok: boolean;
    toolNames: string[];
    failureReason?: string;
    skipped?: boolean;
  };
};

/**
 * Tenant-scoped remote tools/list. Fail closed:
 * - cross-tenant assets are ignored
 * - servers not materialized into mcporter config are unavailable (no Suggested/Connect)
 * - probe failures / timeouts become unavailable for that server
 */
export function listTenantRemoteMcpTools(
  tenantId: string,
  deps: ListTenantRemoteMcpToolsDeps,
): McpRemoteToolsListOutcome {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return { status: "unavailable", tools: [], unavailableServers: [] };
  }

  const servers: string[] = [];
  const seen = new Set<string>();
  for (const entry of deps.listRegistry()) {
    if (!VISIBLE_ASSET_LIFECYCLES.has(entry.lifecycleState)) {
      continue;
    }
    const tenantIds = entry.distribution?.scope?.tenantIds ?? [];
    if (!tenantIds.includes(normalizedTenantId)) {
      continue;
    }
    const assetType = (entry.manifest as { assetType?: unknown }).assetType;
    if (assetType !== "mcp") {
      continue;
    }
    const skillId = entry.manifest.skillKey?.trim();
    if (!skillId) {
      continue;
    }
    let serverName = "";
    try {
      serverName = deps.readBinding(skillId).runtimeDefinition.mcpBinding?.serverName?.trim() ?? "";
    } catch {
      continue;
    }
    if (!serverName || seen.has(serverName)) {
      continue;
    }
    seen.add(serverName);
    servers.push(serverName);
  }

  if (servers.length === 0) {
    // No tenant MCP assets to probe — remote list is vacuously ok (empty).
    return { status: "ok", tools: [], unavailableServers: [] };
  }

  const tools: McpDiscoveryDeclaredTool[] = [];
  const unavailableServers: string[] = [];
  const seenTools = new Set<string>();
  let successCount = 0;

  for (const serverName of servers) {
    if (!deps.isServerMaterialized(serverName)) {
      unavailableServers.push(serverName);
      continue;
    }
    let listed: { ok: boolean; toolNames: string[]; skipped?: boolean };
    try {
      listed = deps.listRemoteTools(serverName);
    } catch {
      unavailableServers.push(serverName);
      continue;
    }
    if (!listed.ok || listed.skipped) {
      unavailableServers.push(serverName);
      continue;
    }
    successCount += 1;
    for (const rawName of listed.toolNames) {
      const toolName = rawName.trim();
      if (!toolName) {
        continue;
      }
      const key = toolKey(serverName, toolName);
      if (seenTools.has(key)) {
        continue;
      }
      seenTools.add(key);
      tools.push({ serverName, toolName });
    }
  }

  let status: McpRemoteToolsListStatus;
  if (successCount === 0) {
    status = "unavailable";
  } else if (unavailableServers.length === 0) {
    status = "ok";
  } else {
    status = "partial";
  }

  return { status, tools, unavailableServers };
}

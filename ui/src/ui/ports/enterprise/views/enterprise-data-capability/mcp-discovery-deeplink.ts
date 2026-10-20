/**
 * MCP 发现 → 数据治理深链上下文（纯函数）。
 *
 * 发现面板按行带上 mcpServer / mcpTool（待授权行再带 capabilityId），
 * 落地页读参后展示 callout 或打开映射引导预填。打开/预填不写治理实体；显式保存才走映射写路径。
 */

export type McpDiscoveryDeeplinkContext = {
  mcpServer: string;
  mcpTool: string;
  capabilityId: string | null;
  /** Capability-access approval id after approve_intent_only (optional). */
  requestId: string | null;
};

function trimParam(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 从 location.search 解析 MCP 发现深链上下文；缺 server 则视为无上下文。 */
export function parseMcpDiscoveryContext(
  search: string | null | undefined,
): McpDiscoveryDeeplinkContext | null {
  if (typeof search !== "string" || search.length === 0) {
    return null;
  }
  try {
    const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const mcpServer = trimParam(query.get("mcpServer"));
    if (!mcpServer) {
      return null;
    }
    const mcpTool = trimParam(query.get("mcpTool"));
    const capabilityIdRaw = trimParam(query.get("capabilityId"));
    const requestIdRaw = trimParam(
      query.get("requestId") || query.get("capabilityAccessRequestId"),
    );
    return {
      mcpServer,
      mcpTool,
      capabilityId: capabilityIdRaw || null,
      requestId: requestIdRaw || null,
    };
  } catch {
    return null;
  }
}

/**
 * 在已有 `?edc=…` 基址上按行追加 MCP 上下文查询串。
 * 空 tool / capabilityId 不写入，避免无效 `mcpTool=`。
 */
export function appendMcpDiscoveryContext(
  baseHref: string,
  ctx: {
    mcpServer?: string | null;
    mcpTool?: string | null;
    capabilityId?: string | null;
    requestId?: string | null;
  },
): string {
  const hashIndex = baseHref.indexOf("#");
  const withoutHash = hashIndex >= 0 ? baseHref.slice(0, hashIndex) : baseHref;
  const hash = hashIndex >= 0 ? baseHref.slice(hashIndex) : "";
  const qIndex = withoutHash.indexOf("?");
  const path = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
  const existing = qIndex >= 0 ? withoutHash.slice(qIndex + 1) : "";
  const search = new URLSearchParams(existing);
  const server = trimParam(ctx.mcpServer);
  const tool = trimParam(ctx.mcpTool);
  const capabilityId = trimParam(ctx.capabilityId);
  const requestId = trimParam(ctx.requestId);
  if (server) {
    search.set("mcpServer", server);
  }
  if (tool) {
    search.set("mcpTool", tool);
  }
  if (capabilityId) {
    search.set("capabilityId", capabilityId);
  }
  if (requestId) {
    search.set("requestId", requestId);
    search.set("capabilityAccessRequestId", requestId);
  }
  const qs = search.toString();
  return `${path}${qs ? `?${qs}` : ""}${hash}`;
}

/** 给空编辑器的轻量预填：capabilityKey 仅用字母数字与点/下划线。 */
export function suggestCapabilityKeyFromMcp(ctx: McpDiscoveryDeeplinkContext): string {
  const raw = ctx.mcpTool ? `${ctx.mcpServer}.${ctx.mcpTool}` : ctx.mcpServer;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "")
    .slice(0, 64);
}

export function formatMcpDiscoveryLabel(ctx: McpDiscoveryDeeplinkContext): string {
  return ctx.mcpTool ? `${ctx.mcpServer} / ${ctx.mcpTool}` : ctx.mcpServer;
}

/** 构造可读的 mcp:// 处理器引用（与网关侧 buildMcpHandlerRef 对齐）。 */
export function buildMcpHandlerRef(serverName: string, toolName: string): string | null {
  const server = trimParam(serverName);
  const tool = trimParam(toolName);
  if (!server || !tool) {
    return null;
  }
  return `mcp://${encodeURIComponent(server)}/${encodeURIComponent(tool)}`;
}

export type McpMappingPrefill = {
  mcpServer: string;
  mcpTool: string;
  capabilityKey: string;
  displayName: string;
  description: string;
  handlerRef: string;
};

/** 从深链上下文生成映射引导预填（纯函数，无副作用）。 */
export function buildMcpMappingPrefill(ctx: McpDiscoveryDeeplinkContext): McpMappingPrefill | null {
  const handlerRef = buildMcpHandlerRef(ctx.mcpServer, ctx.mcpTool);
  if (!handlerRef) {
    return null;
  }
  const label = formatMcpDiscoveryLabel(ctx);
  return {
    mcpServer: ctx.mcpServer,
    mcpTool: ctx.mcpTool,
    capabilityKey: suggestCapabilityKeyFromMcp(ctx),
    displayName: ctx.mcpTool || ctx.mcpServer,
    description: `来自 MCP 发现：${label}`,
    handlerRef,
  };
}

import { isKnownCoreToolId } from "../agents/tool-catalog.js";
import type {
  AssetType,
  McpAssetBinding,
  SkillRuntimeDefinition,
  ToolAssetBinding,
} from "./skill-lifecycle-store.js";

export type OrganizableAssetType = Exclude<AssetType, "knowledge">;

export type InferredAssetClassification = {
  assetType: OrganizableAssetType;
  toolBinding?: ToolAssetBinding;
  mcpBinding?: McpAssetBinding;
};

const TOOL_ALIASES: Array<{ pattern: RegExp; toolId: string }> = [
  { pattern: /网页搜索|搜索网页|网页检索|检索网页|web\s*search/i, toolId: "web_search" },
  { pattern: /网页抓取|抓取网页|web\s*fetch/i, toolId: "web_fetch" },
  { pattern: /读文件|读取文件/i, toolId: "read" },
  { pattern: /写文件|写入文件/i, toolId: "write" },
  { pattern: /浏览器/i, toolId: "browser" },
  { pattern: /定时|日程|schedule/i, toolId: "schedule" },
];

function collectHaystack(values: Array<string | string[] | null | undefined>): string {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value ?? ""]))
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function extractKnownToolIds(text: string): string[] {
  const fromTokens = (text.match(/[a-z][a-z0-9_]{1,}/gi) ?? [])
    .map((token) => token.toLowerCase())
    .filter((token) => isKnownCoreToolId(token));
  const fromAliases = TOOL_ALIASES.filter((entry) => entry.pattern.test(text)).map(
    (entry) => entry.toolId,
  );
  return uniqueIds([...fromTokens, ...fromAliases]);
}

export function extractMcpBinding(text: string): McpAssetBinding | undefined {
  const url = text.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, "");
  const commandMatch = text.match(/npx(?:\s+-y)?\s+[^\s]+(?:\s+[^\s]+)*/i);
  const mentionsMcp = /mcp|mcporter|modelcontextprotocol/i.test(text);
  if (!url && !commandMatch && !mentionsMcp) {
    return undefined;
  }
  if (!url && !commandMatch) {
    return undefined;
  }
  const command = commandMatch?.[0]?.trim();
  let serverName = "";
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^mcp\./, "").replace(/\..+$/, "");
      serverName = host;
    } catch {
      serverName = "";
    }
  }
  if (!serverName && command) {
    const pkg = command.split(/\s+/).find((part) => part.includes("/")) ?? "";
    serverName =
      pkg
        .split("/")
        .pop()
        ?.replace(/^server-/, "") ?? "";
  }
  if (!serverName) {
    serverName = text.match(/\b[a-z][a-z0-9_-]{1,}\b/i)?.[0] ?? "mcp";
  }
  return {
    serverName: serverName.toLowerCase(),
    transport: url && !command ? "http" : "stdio",
    ...(command ? { command } : {}),
    ...(url ? { url } : {}),
  };
}

function inferKeywordType(text: string): OrganizableAssetType {
  if (/(模板|模版|template|周报|纪要|回复)/i.test(text)) {
    return "template";
  }
  if (/(工作流|workflow|流程|步骤)/i.test(text)) {
    return "workflow";
  }
  if (/(agent|助手|专员|顾问|审阅机器人)/i.test(text)) {
    return "agent";
  }
  if (/(提示词|prompt|指令)/i.test(text)) {
    return "prompt";
  }
  return "capability";
}

export function inferOrganizableAssetClassification(input: {
  name?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  contextId?: string | null;
  runtimeDefinition?: Pick<SkillRuntimeDefinition, "tools" | "toolBinding" | "mcpBinding">;
}): InferredAssetClassification {
  const existingMcp = input.runtimeDefinition?.mcpBinding;
  if (existingMcp?.serverName && (existingMcp.command || existingMcp.url)) {
    return { assetType: "mcp", mcpBinding: existingMcp };
  }
  const existingTools = uniqueIds([
    ...(input.runtimeDefinition?.toolBinding?.toolIds ?? []),
    ...(input.runtimeDefinition?.tools ?? []),
  ]).filter((toolId) => isKnownCoreToolId(toolId));
  if (existingTools.length > 0) {
    return { assetType: "tool", toolBinding: { toolIds: existingTools } };
  }

  const haystack = collectHaystack([
    input.name,
    input.summary,
    input.category,
    input.tags,
    input.contextId,
  ]);
  const mcpBinding = extractMcpBinding(haystack);
  if (mcpBinding) {
    return { assetType: "mcp", mcpBinding };
  }
  const toolIds = extractKnownToolIds(haystack);
  if (toolIds.length > 0) {
    return { assetType: "tool", toolBinding: { toolIds } };
  }
  return { assetType: inferKeywordType(haystack) };
}

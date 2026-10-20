import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import type { McpAssetBinding } from "../skill-lifecycle-store.js";

type McporterServerEntry = {
  command?: string;
  args?: string[];
  url?: string;
};

type McporterConfigFile = {
  mcpServers: Record<string, McporterServerEntry>;
};

export function resolveMcporterConfigPath(configDir = CONFIG_DIR): string {
  return path.join(configDir, "mcp-asset-bindings", "mcporter.json");
}

function readMcporterConfig(configDir?: string): McporterConfigFile {
  const filePath = resolveMcporterConfigPath(configDir);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McporterServerEntry> };
    return {
      mcpServers:
        parsed.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {},
    };
  } catch {
    return { mcpServers: {} };
  }
}

function writeMcporterConfig(next: McporterConfigFile, configDir?: string): string {
  const filePath = resolveMcporterConfigPath(configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return filePath;
}

function toMcporterServer(binding: McpAssetBinding): McporterServerEntry {
  if (binding.url && !binding.command) {
    return { url: binding.url };
  }
  return {
    ...(binding.command ? { command: binding.command } : {}),
    ...(binding.args && binding.args.length > 0 ? { args: binding.args } : {}),
    ...(binding.url ? { url: binding.url } : {}),
  };
}

export function upsertMcpAssetMcporterServer(binding: McpAssetBinding, configDir?: string): string {
  const current = readMcporterConfig(configDir);
  current.mcpServers[binding.serverName] = toMcporterServer(binding);
  return writeMcporterConfig(current, configDir);
}

export function removeMcpAssetMcporterServer(
  serverName: string,
  configDir?: string,
): string | null {
  const trimmed = serverName.trim();
  if (!trimmed) {
    return null;
  }
  const current = readMcporterConfig(configDir);
  if (!(trimmed in current.mcpServers)) {
    return resolveMcporterConfigPath(configDir);
  }
  delete current.mcpServers[trimmed];
  return writeMcporterConfig(current, configDir);
}

export function readMcpAssetMcporterServers(
  configDir?: string,
): Record<string, McporterServerEntry> {
  return readMcporterConfig(configDir).mcpServers;
}

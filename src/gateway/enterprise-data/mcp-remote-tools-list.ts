/**
 * Tenant MCP discovery list-only probe.
 *
 * Reuses mcporter list + parseMcporterListSchemaOutput. Never runs a sample call.
 * Callers must fail closed when the server is not materialized into mcporter config.
 */
import { spawnSync } from "node:child_process";
import { resolveMcporterConfigPath } from "../executable-asset-binding/mcp-config.js";
import {
  MCP_HEALTH_PROBE_LIST_TIMEOUT_MS,
  parseMcporterListSchemaOutput,
} from "../executable-asset-binding/mcp-health-probe.js";

const MAX_OUTPUT_CHARS = 64_000;

export type McpDiscoveryRemoteListResult = {
  ok: boolean;
  latencyMs: number;
  toolNames: string[];
  failureReason?: string;
  skipped?: boolean;
  skipReason?: string;
};

function trimOutput(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) : text;
}

function resolveMcporterCommand(): string {
  if (process.platform !== "win32") {
    return "mcporter";
  }
  return "mcporter.cmd";
}

/**
 * List-only remote tools for one MCP server name already present in mcporter config.
 * Never throws; never issues mcporter call.
 */
export function listMcpServerToolsForDiscovery(params: {
  serverName: string;
  configDir?: string;
  enabled?: boolean;
}): McpDiscoveryRemoteListResult {
  if (params.enabled === false) {
    return {
      ok: false,
      latencyMs: 0,
      toolNames: [],
      skipped: true,
      skipReason: "probe_disabled",
      failureReason: "probe_disabled",
    };
  }
  const serverName = params.serverName.trim();
  if (!serverName) {
    return {
      ok: false,
      latencyMs: 0,
      toolNames: [],
      failureReason: "missing_server_name",
    };
  }
  const configPath = resolveMcporterConfigPath(params.configDir);
  const started = Date.now();
  const command = resolveMcporterCommand();
  try {
    const result = spawnSync(
      command,
      ["list", serverName, "--schema", "--output", "json", "--config", configPath],
      {
        encoding: "utf8",
        timeout: MCP_HEALTH_PROBE_LIST_TIMEOUT_MS,
        env: process.env,
        shell: process.platform === "win32",
      },
    );
    const latencyMs = Date.now() - started;
    const stdout = trimOutput(result.stdout ?? "");
    const stderr = trimOutput(result.stderr ?? "");
    if (result.error) {
      const message = result.error.message?.trim() || String(result.error);
      return {
        ok: false,
        latencyMs,
        toolNames: [],
        failureReason: /ENOENT/i.test(message)
          ? "mcporter CLI is not installed or not on PATH"
          : message.slice(0, 500),
      };
    }
    if (result.status !== 0) {
      const failureReason =
        stderr.trim() || stdout.trim() || `mcporter list exited with code ${String(result.status)}`;
      return {
        ok: false,
        latencyMs,
        toolNames: [],
        failureReason: failureReason.slice(0, 500),
      };
    }
    return {
      ok: true,
      latencyMs,
      toolNames: parseMcporterListSchemaOutput(stdout),
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      toolNames: [],
      failureReason: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    };
  }
}

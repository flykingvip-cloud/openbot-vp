import { spawnSync } from "node:child_process";
import { recordBypassEntryShadow } from "../governance/bypass-entry-shadow.js";
import type { McpAssetBinding } from "../skill-lifecycle-store.js";
import { resolveMcporterConfigPath } from "./mcp-config.js";

export const MCP_HEALTH_PROBE_LIST_TIMEOUT_MS = 20_000;
export const MCP_HEALTH_PROBE_CALL_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 64_000;

export type McpHealthSampleCallResult = {
  tool: string;
  ok: boolean;
  failureReason?: string;
  latencyMs: number;
};

export type McpHealthProbeResult = {
  ok: boolean;
  latencyMs: number;
  listedTools: number;
  toolNames: string[];
  sampleCall?: McpHealthSampleCallResult;
  failureReason?: string;
  skipped?: boolean;
  skipReason?: string;
};

type McporterRunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
  latencyMs: number;
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

function runMcporterSync(params: {
  args: string[];
  configPath: string;
  timeoutMs: number;
}): McporterRunResult {
  const started = Date.now();
  const command = resolveMcporterCommand();
  try {
    const result = spawnSync(command, [...params.args, "--config", params.configPath], {
      encoding: "utf8",
      timeout: params.timeoutMs,
      env: process.env,
      shell: process.platform === "win32",
    });
    const latencyMs = Date.now() - started;
    const stdout = trimOutput(result.stdout ?? "");
    const stderr = trimOutput(result.stderr ?? "");
    if (result.error) {
      const message = result.error.message?.trim() || String(result.error);
      if (/ENOENT/i.test(message)) {
        return {
          ok: false,
          stdout,
          stderr,
          exitCode: result.status,
          error: "mcporter CLI is not installed or not on PATH",
          latencyMs,
        };
      }
      return {
        ok: false,
        stdout,
        stderr,
        exitCode: result.status,
        error: message,
        latencyMs,
      };
    }
    const exitCode = result.status;
    return {
      ok: exitCode === 0,
      stdout,
      stderr,
      exitCode,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  }
}

function collectToolNamesFromParsed(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const names = new Set<string>();
  const pushName = (raw: unknown) => {
    if (typeof raw === "string" && raw.trim()) {
      names.add(raw.trim());
    }
  };
  const tools = record.tools;
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (typeof tool === "string") {
        pushName(tool);
        continue;
      }
      if (tool && typeof tool === "object") {
        const typed = tool as Record<string, unknown>;
        pushName(typed.name);
        pushName(typed.tool);
        pushName(typed.id);
      }
    }
  }
  const nested = record.server;
  if (nested && typeof nested === "object") {
    for (const name of collectToolNamesFromParsed(nested)) {
      names.add(name);
    }
  }
  return [...names];
}

export function parseMcporterListSchemaOutput(stdout: string): string[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const names = new Set<string>();
      for (const entry of parsed) {
        for (const name of collectToolNamesFromParsed(entry)) {
          names.add(name);
        }
        if (typeof entry === "string") {
          names.add(entry.trim());
        }
      }
      return [...names].filter(Boolean);
    }
    return collectToolNamesFromParsed(parsed);
  } catch {
    const matches = trimmed.match(/\b[a-z][a-z0-9_-]{1,48}\b/gi) ?? [];
    return [...new Set(matches.map((name) => name.trim()))].slice(0, 20);
  }
}

function pickSampleTool(binding: McpAssetBinding, toolNames: string[]): string | null {
  const allow = binding.toolAllowlist?.map((name) => name.trim()).filter(Boolean) ?? [];
  if (allow.length > 0) {
    return allow[0] ?? null;
  }
  const readOnly =
    toolNames.find((name) => /^(list|get|search|health|ping|status)/i.test(name)) ?? null;
  return readOnly ?? toolNames[0] ?? null;
}

function runSampleCall(params: {
  binding: McpAssetBinding;
  configPath: string;
  tool: string;
}): McpHealthSampleCallResult {
  const started = Date.now();
  const selector = `${params.binding.serverName}.${params.tool}`;
  const result = runMcporterSync({
    configPath: params.configPath,
    timeoutMs: MCP_HEALTH_PROBE_CALL_TIMEOUT_MS,
    args: [
      "call",
      selector,
      "--args",
      "{}",
      "--output",
      "json",
      "--timeout",
      String(Math.max(1_000, MCP_HEALTH_PROBE_CALL_TIMEOUT_MS - 2_000)),
    ],
  });
  if (result.ok) {
    return { tool: params.tool, ok: true, latencyMs: Date.now() - started };
  }
  const failureReason =
    result.error?.trim() ||
    result.stderr.trim() ||
    result.stdout.trim() ||
    `mcporter call exited with code ${String(result.exitCode)}`;
  return {
    tool: params.tool,
    ok: false,
    failureReason: failureReason.slice(0, 500),
    latencyMs: Date.now() - started,
  };
}

/**
 * Post-install health probe: list tools via mcporter, then optional sample call.
 * Never throws; callers decide whether to record SkillHealth telemetry.
 */
export function probeMcpAssetBindingHealth(params: {
  binding: McpAssetBinding;
  configDir?: string;
  /** When false, skip subprocess probe (tests / offline installs). */
  enabled?: boolean;
}): McpHealthProbeResult {
  void recordBypassEntryShadow({
    entry: "MCP",
    reason: "bypass-shadow",
  });
  if (params.enabled === false) {
    return {
      ok: true,
      latencyMs: 0,
      listedTools: 0,
      toolNames: [],
      skipped: true,
      skipReason: "probe_disabled",
    };
  }
  const configPath = resolveMcporterConfigPath(params.configDir);
  const started = Date.now();
  const listResult = runMcporterSync({
    configPath,
    timeoutMs: MCP_HEALTH_PROBE_LIST_TIMEOUT_MS,
    args: ["list", params.binding.serverName, "--schema", "--output", "json"],
  });
  if (!listResult.ok) {
    const failureReason =
      listResult.error?.trim() ||
      listResult.stderr.trim() ||
      listResult.stdout.trim() ||
      `mcporter list exited with code ${String(listResult.exitCode)}`;
    return {
      ok: false,
      latencyMs: Date.now() - started,
      listedTools: 0,
      toolNames: [],
      failureReason: failureReason.slice(0, 500),
    };
  }
  const toolNames = parseMcporterListSchemaOutput(listResult.stdout);
  const sampleTool = pickSampleTool(params.binding, toolNames);
  if (!sampleTool) {
    return {
      ok: true,
      latencyMs: Date.now() - started,
      listedTools: toolNames.length,
      toolNames,
    };
  }
  const sampleCall = runSampleCall({
    binding: params.binding,
    configPath,
    tool: sampleTool,
  });
  return {
    ok: sampleCall.ok,
    latencyMs: Date.now() - started,
    listedTools: toolNames.length,
    toolNames,
    sampleCall,
    failureReason: sampleCall.ok ? undefined : sampleCall.failureReason,
  };
}

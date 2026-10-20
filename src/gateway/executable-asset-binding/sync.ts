import { EXECUTABLE_LIFECYCLES } from "../skill-execution-binding/types.js";
import {
  getSkillRuntimeDefinitionForBinding,
  recordSkillHealthSample,
} from "../skill-lifecycle-store.js";
import { upsertMcpAssetMcporterServer } from "./mcp-config.js";
import { probeMcpAssetBindingHealth, type McpHealthProbeResult } from "./mcp-health-probe.js";
import { validateMcpAssetBinding } from "./validate-mcp-binding.js";

function isMcpHealthProbeEnabled(): boolean {
  const raw = process.env.OPENBOT_MCP_HEALTH_PROBE?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

export function syncExecutableAssetBinding(params: {
  skillId: string;
  op: "install" | "save" | "toggle" | "upgrade" | "remove" | "delete";
  configDir?: string;
  agentId?: string | null;
  /** Test hook: override env-based probe toggle. */
  healthProbeEnabled?: boolean;
}): {
  action: "mcp-upserted" | "skipped";
  serverName?: string;
  validationIssues?: Array<{ field: string; message: string }>;
  healthProbe?: McpHealthProbeResult;
} {
  if (params.op === "remove" || params.op === "delete") {
    return { action: "skipped" };
  }
  let binding: ReturnType<typeof getSkillRuntimeDefinitionForBinding> | null = null;
  try {
    binding = getSkillRuntimeDefinitionForBinding(params.skillId);
  } catch {
    binding = null;
  }
  const mcpBinding = binding?.runtimeDefinition.mcpBinding;
  if (!mcpBinding || !binding || !EXECUTABLE_LIFECYCLES.has(binding.lifecycle)) {
    return { action: "skipped" };
  }
  const validated = validateMcpAssetBinding(mcpBinding);
  if (!validated.ok) {
    return { action: "skipped", validationIssues: validated.issues };
  }
  upsertMcpAssetMcporterServer(validated.binding, params.configDir);
  const healthProbe = probeMcpAssetBindingHealth({
    binding: validated.binding,
    configDir: params.configDir,
    enabled: params.healthProbeEnabled ?? isMcpHealthProbeEnabled(),
  });
  if (!healthProbe.skipped) {
    recordSkillHealthSample({
      skillId: params.skillId,
      agentId: params.agentId,
      outcome: healthProbe.ok ? "success" : "failure",
      latencyMs: healthProbe.latencyMs,
      failureReason: healthProbe.failureReason,
    });
  }
  return {
    action: "mcp-upserted",
    serverName: validated.binding.serverName,
    healthProbe,
  };
}

import type { ToolRisk } from "./contracts.js";
import type { PolicyFacts } from "./policy.js";

/**
 * Infer toolkit PolicyFacts from a Gateway / OpenClaw tool name + optional action.
 * This is a thin heuristic map so Policy → Approval → Receipt can gate the existing
 * HTTP `/tools/invoke` boundary without rewriting every adapter.
 */
export function inferPolicyFactsFromGatewayTool(params: {
  toolName: string;
  action?: string;
  /** When known, whether the path stays inside the workspace. Default true for workspace writes. */
  withinWorkspace?: boolean;
  credentialAccess?: boolean;
  scopedCredentialAccess?: boolean;
  destructive?: boolean;
}): PolicyFacts {
  const toolName = params.toolName.trim().toLowerCase();
  const action = (params.action ?? "").trim().toLowerCase() || undefined;

  const base = {
    credentialAccess: params.credentialAccess ?? false,
    scopedCredentialAccess: params.scopedCredentialAccess ?? false,
  };

  if (
    toolName === "exec" ||
    toolName === "shell" ||
    toolName === "bash" ||
    toolName === "system_run" ||
    toolName === "process"
  ) {
    return {
      toolId: "shell",
      operation: action ?? "exec",
      risk: "high",
      sideEffects: true,
      destructive: params.destructive ?? false,
      withinWorkspace: params.withinWorkspace ?? false,
      ...base,
    };
  }

  if (
    toolName === "browser" ||
    toolName === "browser_act" ||
    toolName.startsWith("browser_") ||
    toolName === "computer" ||
    toolName === "computer_use"
  ) {
    return {
      toolId: toolName.includes("computer") ? "computer-use" : "browser",
      operation: action ?? "navigate",
      risk: "high",
      sideEffects: true,
      destructive: params.destructive ?? false,
      withinWorkspace: false,
      ...base,
    };
  }

  if (
    toolName === "write" ||
    toolName === "edit" ||
    toolName === "apply_patch" ||
    toolName === "fs_write" ||
    toolName === "fs_delete" ||
    toolName === "fs_move"
  ) {
    const destructive = params.destructive ?? (toolName === "fs_delete" || toolName === "fs_move");
    return {
      toolId: "workspace",
      operation: action ?? (toolName === "apply_patch" ? "patch" : "write"),
      risk: destructive ? "high" : "medium",
      sideEffects: true,
      destructive,
      withinWorkspace: params.withinWorkspace ?? true,
      ...base,
    };
  }

  if (toolName === "read" || toolName === "grep" || toolName === "find" || toolName === "ls") {
    return {
      toolId: "workspace",
      operation: action ?? (toolName === "grep" || toolName === "find" ? "search" : "read"),
      risk: "low",
      sideEffects: false,
      destructive: false,
      withinWorkspace: params.withinWorkspace ?? true,
      ...base,
    };
  }

  if (toolName === "web_search" || toolName === "web_fetch" || toolName === "web") {
    return {
      toolId: "web",
      operation: action ?? (toolName.includes("fetch") ? "open" : "search"),
      risk: "low",
      sideEffects: false,
      destructive: false,
      withinWorkspace: false,
      ...base,
    };
  }

  if (toolName === "cron" || toolName.startsWith("sessions_") || toolName === "gateway") {
    return {
      toolId: "automation",
      operation: action ?? toolName,
      risk: "high",
      sideEffects: true,
      destructive: params.destructive ?? toolName.includes("spawn"),
      withinWorkspace: false,
      ...base,
    };
  }

  // Conservative default for unknown gateway tools: medium risk + side effects
  // so they get allow-with-receipt only if a matching rule exists; example policy
  // defaults to deny for unmatched medium tools.
  const risk: ToolRisk = "medium";
  return {
    toolId: toolName || "unknown",
    operation: action ?? "invoke",
    risk,
    sideEffects: true,
    destructive: params.destructive ?? false,
    withinWorkspace: params.withinWorkspace ?? false,
    ...base,
  };
}

import type { McpAssetBinding } from "../skill-lifecycle-store.js";

export type McpBindingValidationIssue = {
  field: string;
  message: string;
};

export type McpBindingValidationResult =
  | { ok: true; binding: McpAssetBinding }
  | { ok: false; issues: McpBindingValidationIssue[] };

const SERVER_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function validateMcpAssetBinding(
  binding: McpAssetBinding | null | undefined,
): McpBindingValidationResult {
  const issues: McpBindingValidationIssue[] = [];
  if (!binding) {
    return { ok: false, issues: [{ field: "mcpBinding", message: "binding is required" }] };
  }
  const serverName = binding.serverName?.trim() ?? "";
  if (!serverName) {
    issues.push({ field: "serverName", message: "serverName is required" });
  } else if (!SERVER_NAME_RE.test(serverName)) {
    issues.push({
      field: "serverName",
      message: "serverName must be 1-64 chars (letters, digits, _ or -)",
    });
  }
  const command = binding.command?.trim() ?? "";
  const url = binding.url?.trim() ?? "";
  if (!command && !url) {
    issues.push({
      field: "transport",
      message: "stdio bindings need command; http bindings need url",
    });
  }
  if (command && url && binding.transport === "stdio") {
    issues.push({
      field: "url",
      message: "stdio transport must not set url (use http transport for remote MCP)",
    });
  }
  if (url && !/^https?:\/\//i.test(url)) {
    issues.push({ field: "url", message: "url must start with http:// or https://" });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    binding: {
      ...binding,
      serverName,
      transport: url && !command ? "http" : "stdio",
      ...(command ? { command } : {}),
      ...(url ? { url } : {}),
    },
  };
}

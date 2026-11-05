import type { CapabilityDeclaration } from "../contracts/capability.js";

/** Host-owned classifications. Unrecognized capabilities never acquire read-only status. */
const EFFECTS: Readonly<Record<string, CapabilityDeclaration["sideEffect"]>> = {
  read: "read",
  web_fetch: "read",
  web_search: "read",
  memory_get: "read",
  memory_search: "read",
  session_status: "read",
  write: "workspace_write",
  edit: "workspace_write",
  apply_patch: "workspace_write",
  message: "external",
  sessions_send: "external",
  exec: "arbitrary",
  bash: "arbitrary",
  browser: "arbitrary",
  nodes: "arbitrary",
  process: "arbitrary",
};
export function declareCapability(id: string, ownerOnly = false): CapabilityDeclaration {
  return {
    id,
    permission: { ownerOnly, authority: "existing-tool-policy" },
    sideEffect: EFFECTS[id] ?? "unknown",
    cancellation: "signal_forwarded",
    completion: "tool_result",
    idempotency: "not_declared",
    automaticRetry: false,
  };
}

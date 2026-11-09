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
  const executionKind: CapabilityDeclaration["executionKind"] =
    id === "lobster" || id === "sessions_spawn"
      ? "delegated_workflow"
      : id === "process"
        ? "lifecycle_adapter"
        : EFFECTS[id] === "read" || EFFECTS[id] === "workspace_write" || EFFECTS[id] === "external"
          ? "atomic"
          : "unclassified";
  return {
    id,
    executionKind,
    permission: { ownerOnly, authority: "existing-tool-policy" },
    sideEffect: EFFECTS[id] ?? "unknown",
    cancellation: { request: "unknown", confirmation: "not_declared" },
    completion: { boundary: "tool_return", taskAcceptance: false },
    recovery:
      id === "lobster"
        ? { owner: "external_workflow", token: "opaque_external" }
        : { owner: "unknown", token: "unknown" },
    idempotency: "not_declared",
    automaticRetry: false,
  };
}

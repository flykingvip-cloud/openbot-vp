import type { WorkspaceDurabilityClass } from "./types.js";

/** Map an existing inventory root class onto the v4.1 durability table. */
export function classifyWorkspaceDurability(rootClass: string): WorkspaceDurabilityClass {
  switch (rootClass) {
    case "agent_workspace":
    case "agent_artifacts":
    case "account_memory":
    case "account_browser_profile":
      return "PERSISTENT";
    case "account_credential_dir":
      return "SECRET";
    case "host_skill_risk":
    case "canvas_risk":
      return "SHARED_READONLY";
    case "ephemeral_cache":
      return "EPHEMERAL";
    case "data_space_flat_workspace":
    case "legacy_agent_workspace":
    case "employee_isolation_root":
    case "host_workspace_agent":
      return "LEGACY";
    default:
      return "UNKNOWN";
  }
}

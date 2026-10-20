import path from "node:path";
import { CHANNEL_IDS } from "../../channels/registry.js";
import { STATE_DIR } from "../../config/paths.js";

export const DEFAULT_SANDBOX_WORKSPACE_ROOT = path.join(STATE_DIR, "sandboxes");

export const DEFAULT_SANDBOX_IMAGE = "openbot-sandbox:bookworm-slim";
/**
 * Temporary tag for deploys that still build or pin `openclaw-sandbox`.
 * `scripts/sandbox-setup.sh` tags both names. Runtime reuses whichever one
 * is already present so an old image does not have to be rebuilt first.
 */
export const LEGACY_SANDBOX_IMAGE_ALIAS = "openclaw-sandbox:bookworm-slim";

export const DEFAULT_SANDBOX_BROWSER_IMAGE = "openbot-sandbox-browser:bookworm-slim";
/**
 * Temporary tag for deploys that still build or pin the previous browser image.
 * `scripts/sandbox-browser-setup.sh` tags both names. Runtime reuses whichever
 * one is already present. A missing browser image is not replaced with Debian.
 */
export const LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS = "openclaw-sandbox-browser:bookworm-slim";

export type SandboxImageAliasPlan =
  | { kind: "use"; image: string }
  | { kind: "retag"; from: string; to: string }
  | { kind: "absent" };

/** Canonical name and the temporary openclaw image alias are one image. */
export function sandboxImageCompatPeer(image: string): string | undefined {
  if (image === DEFAULT_SANDBOX_IMAGE) {
    return LEGACY_SANDBOX_IMAGE_ALIAS;
  }
  if (image === LEGACY_SANDBOX_IMAGE_ALIAS) {
    return DEFAULT_SANDBOX_IMAGE;
  }
  if (image === DEFAULT_SANDBOX_BROWSER_IMAGE) {
    return LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS;
  }
  if (image === LEGACY_SANDBOX_BROWSER_IMAGE_ALIAS) {
    return DEFAULT_SANDBOX_BROWSER_IMAGE;
  }
  return undefined;
}

export function planSandboxImageAlias(params: {
  requested: string;
  requestedPresent: boolean;
  peerPresent: boolean;
}): SandboxImageAliasPlan {
  if (params.requestedPresent) {
    return { kind: "use", image: params.requested };
  }
  const peer = sandboxImageCompatPeer(params.requested);
  if (peer && params.peerPresent) {
    return { kind: "retag", from: peer, to: params.requested };
  }
  return { kind: "absent" };
}
export const DEFAULT_SANDBOX_CONTAINER_PREFIX = "openclaw-sbx-";
export const DEFAULT_SANDBOX_WORKDIR = "/workspace";
export const DEFAULT_SANDBOX_IDLE_HOURS = 24;
export const DEFAULT_SANDBOX_MAX_AGE_DAYS = 7;

export const DEFAULT_TOOL_ALLOW = [
  "exec",
  "process",
  "read",
  "write",
  "edit",
  "apply_patch",
  "image",
  "sessions_list",
  "sessions_history",
  "sessions_send",
  "sessions_spawn",
  "subagents",
  "session_status",
  // Owner-scoped cron create. The full `cron` tool stays denied in the sandbox.
  "scheduled_task",
  // Coding-profile knowledge consume (read-only). Without these, sandbox.mode=all
  // strips knowledge_search/get even when tools.profile=coding allows them.
  "knowledge_search",
  "knowledge_get",
  // Site capability tools. The sandbox allowlist is not per-capability
  // authorization; site_invoke still checks the server principal and version.
  "site_list",
  "site_describe",
  "site_invoke",
  // Personal operational identity (email and similar). Grant checks stay in the tool.
  // sandbox.mode=all must not drop it for agents that lack tools.alsoAllow.
  "user_operational_identity",
  // Steward alsoAllow tools (empty catalog profiles). ACL still gates via
  // tools.alsoAllow / profile; sandbox must not silently drop them after ACL.
  "meeting",
  "schedule",
  "knowledge_source",
  // Personal skill → 我的资产. ACL still via coding profile / alsoAllow.
  "skill_asset_save",
  "guidance_event",
  // Claim-contract executor board tool. shouldExposeCollaborationBoardTool still
  // gates injection; sandbox.mode=all must not strip it after ACL (same pattern as
  // meeting/schedule). Without this, gray-group executors never see mark/submit.
  "collaboration_board",
] as const;

// Provider docking: keep sandbox policy aligned with provider tool names.
export const DEFAULT_TOOL_DENY = [
  "browser",
  "canvas",
  "nodes",
  "cron",
  "gateway",
  ...CHANNEL_IDS,
] as const;

export const DEFAULT_SANDBOX_COMMON_IMAGE = "openclaw-sandbox-common:bookworm-slim";
export const SANDBOX_BROWSER_SECURITY_HASH_EPOCH = "2026-02-28-no-sandbox-env";

export const DEFAULT_SANDBOX_BROWSER_PREFIX = "openclaw-sbx-browser-";
export const DEFAULT_SANDBOX_BROWSER_NETWORK = "openclaw-sandbox-browser";
export const DEFAULT_SANDBOX_BROWSER_CDP_PORT = 9222;
export const DEFAULT_SANDBOX_BROWSER_VNC_PORT = 5900;
export const DEFAULT_SANDBOX_BROWSER_NOVNC_PORT = 6080;
export const DEFAULT_SANDBOX_BROWSER_AUTOSTART_TIMEOUT_MS = 12_000;

export const SANDBOX_AGENT_WORKSPACE_MOUNT = "/agent";

export const SANDBOX_STATE_DIR = path.join(STATE_DIR, "sandbox");
export const SANDBOX_REGISTRY_PATH = path.join(SANDBOX_STATE_DIR, "containers.json");
export const SANDBOX_BROWSER_REGISTRY_PATH = path.join(SANDBOX_STATE_DIR, "browsers.json");

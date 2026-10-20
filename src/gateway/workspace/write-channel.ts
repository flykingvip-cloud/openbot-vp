/**
 * C17 workspace write channels.
 *
 * Primary = formal position/personal workspace files.
 * Interaction = private drafts under agent-interactions/.../drafts (not inheritable by default).
 * Promote/publish is the only path from interaction → primary artifacts.
 */

import path from "node:path";

export type WorkspaceWriteChannel = "primary" | "interaction";

export const INTERACTION_DRAFTS_RELATIVE_ROOT = "agent-interactions/drafts";

/** Classify a workspace-relative path into a write channel. */
export function classifyWriteChannel(relativePath: string): WorkspaceWriteChannel {
  const normalized = relativePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    normalized === INTERACTION_DRAFTS_RELATIVE_ROOT ||
    normalized.startsWith(`${INTERACTION_DRAFTS_RELATIVE_ROOT}/`)
  ) {
    return "interaction";
  }
  return "primary";
}

/** Resolve the filesystem root for a write channel under the authorized primary locator. */
export function resolveWriteChannelLocator(params: {
  primaryLocator: string;
  channel: WorkspaceWriteChannel;
}): string {
  const primary = path.resolve(params.primaryLocator);
  if (params.channel === "interaction") {
    return path.join(primary, ...INTERACTION_DRAFTS_RELATIVE_ROOT.split("/"));
  }
  return primary;
}

/**
 * Tools must declare which channel they write to.
 * Default for unconstrained relative writes is interaction (fail closed for Primary).
 * Explicit primary capability is required to write outside agent-interactions/drafts.
 */
export function resolveDeclaredWriteChannel(params: {
  relativePath: string;
  /** Explicit tool capability grant. */
  allowedChannels: readonly WorkspaceWriteChannel[];
}): { ok: true; channel: WorkspaceWriteChannel } | { ok: false; reason: string } {
  const channel = classifyWriteChannel(params.relativePath);
  if (!params.allowedChannels.includes(channel)) {
    return {
      ok: false,
      reason:
        channel === "primary"
          ? "write.primary capability required for primary workspace writes"
          : "write.interaction capability required for interaction drafts",
    };
  }
  return { ok: true, channel };
}

/** Default tool grants: interaction drafts only (C17 rule 2–3). */
export const DEFAULT_TOOL_WRITE_CHANNELS: readonly WorkspaceWriteChannel[] = ["interaction"];

/** Workbench / promote paths that may write primary. */
export const PRIMARY_CAPABLE_WRITE_CHANNELS: readonly WorkspaceWriteChannel[] = [
  "primary",
  "interaction",
];

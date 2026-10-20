/**
 * Trusted group workspace locator resolution (P0-c / C5).
 *
 * Kept free of collaboration-openbot-adapter imports so handler-bridge unit
 * tests and managed path resolution stay lightweight.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveUserPath } from "../../utils.js";
import { stringValue } from "../records.js";
import { resolveTenantsRoot } from "../tenant-store-paths.js";

function normalizeValue(value: unknown): string | undefined {
  return stringValue(value) ?? undefined;
}

function isGitWorkingTree(dir: string): boolean {
  try {
    const git = fs.statSync(path.join(dir, ".git"));
    return git.isDirectory() || git.isFile();
  } catch {
    return false;
  }
}

/** Parent of per-group dirs: .../collaboration/groups */
export function resolveTrustedCollaborationGroupsRoot(params: {
  tenantId?: string | null;
  profile: "personal_local" | "managed_enterprise";
  cfg?: OpenBotConfig;
}): string {
  if (params.profile === "managed_enterprise") {
    const tenantId = params.tenantId?.trim();
    if (!tenantId) {
      throw new Error("trusted tenant context required");
    }
    return path.join(resolveTenantsRoot(), tenantId, "collaboration", "groups");
  }
  if (params.cfg) {
    return path.join(resolveLiveCollaborationWorkspaceRoot(params.cfg), "groups");
  }
  return path.join(resolveStateDir(process.env), "collaboration", "groups");
}

/**
 * Collaboration workspace parent (`.../collaboration`) used by stores as
 * `join(root, "groups")`. A git checkout or missing config must not become
 * the live group write root.
 */
export function resolveLiveCollaborationWorkspaceRoot(cfg: OpenBotConfig): string {
  const trustedParent = path.join(resolveStateDir(process.env), "collaboration");
  const configured = normalizeValue(cfg.collaboration?.defaults?.workspace);
  if (!configured) {
    return trustedParent;
  }
  const resolved = path.resolve(resolveUserPath(configured));
  if (isGitWorkingTree(resolved)) {
    return trustedParent;
  }
  return resolved;
}

/**
 * Resolve group workspace locator.
 * Managed Enterprise uses tenant-scoped collaboration roots so the same groupId
 * cannot collide across tenants (C5). Personal Local keeps the legacy layout.
 */
export function resolveTrustedGroupLocator(params: {
  groupId: string;
  tenantId: string | null;
  profile: "personal_local" | "managed_enterprise";
  cfg: OpenBotConfig;
}): string {
  const groupId = params.groupId.trim();
  if (!groupId) {
    throw new Error("groupId is required");
  }
  const tenantId = params.tenantId?.trim();
  const groupsRoot = resolveTrustedCollaborationGroupsRoot({
    tenantId,
    profile: params.profile,
    cfg: params.cfg,
  });
  return path.join(groupsRoot, encodeURIComponent(groupId));
}

// Frozen SoT: managed locator stays on tenants/<tid>/collaboration/groups/<encoded>.
// Do not fall back to host `.openclaw` collaboration groups or invert that direction.

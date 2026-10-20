import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * macOS-local roots. A missing path under one of these stays a hard deny:
 * approval must not silently move a local Mac cwd. Absolute paths outside
 * these roots that do not exist are treated as Linux gateway workspaces
 * (for example `/home/<user>/.openbot/workspace` or `/root/.openclaw/workspace`).
 */
const MAC_LOCAL_ABSOLUTE_ROOTS = [
  "/Users",
  "/Volumes",
  "/private",
  "/tmp",
  "/var",
  "/Applications",
  "/System",
  "/Library",
  "/opt/homebrew",
  "/opt/local",
  "/cores",
  "/dev",
] as const;

export type MacNodeHostApprovalCwdDeps = {
  platform: NodeJS.Platform;
  processCwd: () => string;
  envHome: string | undefined;
  homedir: () => string;
  isMissingPath: (candidate: string) => boolean;
  isApprovableDirectory: (candidate: string) => boolean;
};

export function isMissingFilesystemPath(candidate: string): boolean {
  try {
    fs.lstatSync(candidate);
    return false;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
}

export function isMacLocalAbsolutePath(resolvedPath: string): boolean {
  return MAC_LOCAL_ABSOLUTE_ROOTS.some(
    (root) => resolvedPath === root || resolvedPath.startsWith(`${root}/`),
  );
}

export function isNonexistentLinuxGatewayWorkspacePath(
  cwd: string,
  deps: Pick<MacNodeHostApprovalCwdDeps, "platform" | "isMissingPath">,
): boolean {
  if (deps.platform !== "darwin") {
    return false;
  }
  const trimmed = cwd.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    return false;
  }
  const resolved = path.resolve(trimmed);
  if (isMacLocalAbsolutePath(resolved)) {
    return false;
  }
  return deps.isMissingPath(resolved);
}

function pushUnique(candidates: string[], value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) {
    return;
  }
  const resolved = path.resolve(trimmed);
  if (!candidates.includes(resolved)) {
    candidates.push(resolved);
  }
}

/** Approval cwd fallback order: process.cwd() → ~/Documents → $HOME. */
export function listMacNodeHostApprovalCwdFallbacks(
  deps: Pick<MacNodeHostApprovalCwdDeps, "processCwd" | "envHome" | "homedir">,
): string[] {
  const candidates: string[] = [];
  try {
    pushUnique(candidates, deps.processCwd());
  } catch {
    // process.cwd() throws after its directory is removed.
  }
  let home = deps.envHome?.trim();
  if (!home) {
    try {
      home = deps.homedir();
    } catch {
      home = undefined;
    }
  }
  if (home) {
    pushUnique(candidates, path.join(home, "Documents"));
    pushUnique(candidates, home);
  }
  return candidates;
}

export function defaultMacNodeHostApprovalCwdDeps(
  platform: NodeJS.Platform = process.platform,
): Omit<MacNodeHostApprovalCwdDeps, "isApprovableDirectory"> {
  return {
    platform,
    processCwd: () => process.cwd(),
    envHome: process.env.HOME,
    homedir: () => os.homedir(),
    isMissingPath: isMissingFilesystemPath,
  };
}

/**
 * On the Mac node host, replace a missing Linux gateway workspace cwd with the
 * first existing canonical directory in the fallback chain. Other paths are
 * returned unchanged so approval binding still fails closed.
 */
export function selectMacNodeHostApprovalCwd(
  cwd: string | undefined,
  deps: MacNodeHostApprovalCwdDeps,
): string | undefined {
  if (!cwd?.trim()) {
    return cwd;
  }
  if (!isNonexistentLinuxGatewayWorkspacePath(cwd, deps)) {
    return cwd;
  }
  for (const candidate of listMacNodeHostApprovalCwdFallbacks(deps)) {
    if (deps.isApprovableDirectory(candidate)) {
      return candidate;
    }
  }
  return cwd;
}

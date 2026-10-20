import fs from "node:fs";
import path from "node:path";
import { extractEmployeeStewardUserIdFromSessionKey } from "../../agents/builtin-steward/employee-isolation.js";
import { resolveStateDir } from "../../config/paths.js";
import { normalizeAgentId } from "../../routing/session-key.js";

const SKIP_MERGE_DIRS = new Set([".git", "node_modules"]);

function shouldSkipMergeEntry(entryName: string, fromDir: string, fromRoot: string): boolean {
  if (SKIP_MERGE_DIRS.has(entryName)) {
    return true;
  }
  if (entryName !== "collaboration") {
    return false;
  }
  const rel = path.relative(fromRoot, fromDir);
  const parts = rel ? rel.split(path.sep) : [];
  return parts.includes(".openbot") || parts.includes(".openclaw");
}

function sanitizeWorkspaceOwner(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return normalized || value.trim();
}

export function isExistingWorkspaceDirectory(locator: string): boolean {
  const trimmed = locator.trim();
  if (!isFilesystemWorkspaceLocator(trimmed)) {
    return false;
  }
  try {
    return fs.statSync(path.resolve(trimmed)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * True when `locator` may be treated as a filesystem workspace root.
 * Catalog placeholders such as `unplaced://classified/...` are placement metadata
 * only — never pass them to path.resolve / mkdir / writeFile (Node would create a
 * cwd-relative `unplaced:/classified/...` directory).
 */
export function isFilesystemWorkspaceLocator(locator: string): boolean {
  const trimmed = locator.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes("://")) {
    return false;
  }
  if (/^unplaced:/i.test(trimmed)) {
    return false;
  }
  // Reject a cwd-polluted path that already embeds an unplaced segment.
  if (trimmed.split(/[\\/]/).some((segment) => /^unplaced:$/i.test(segment))) {
    return false;
  }
  return true;
}

/**
 * Choose a real filesystem write root for deliverables / tool cwd.
 * Unplaced or URI catalog locators fall through to the robot-own write root.
 * Never mkdir or resolve a non-filesystem locator.
 */
export function resolvePlacedFilesystemWriteRoot(params: {
  locator?: string | null;
  agentId: string;
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
  stateDir?: string;
  /** Create the directory when missing (robot-own or absolute filesystem locator). */
  ensureDirectory?: boolean;
}): string | null {
  const locator = params.locator?.trim() ?? "";
  if (locator && isFilesystemWorkspaceLocator(locator)) {
    const resolved = path.resolve(locator);
    if (isFilesystemWorkspaceLocator(resolved)) {
      if (params.ensureDirectory) {
        fs.mkdirSync(resolved, { recursive: true });
      }
      return resolved;
    }
  }
  const robotOwn = resolveRobotWriteRoot({
    agentId: params.agentId,
    tenantId: params.tenantId,
    userId: params.userId,
    sessionKey: params.sessionKey,
    stateDir: params.stateDir,
  });
  if (robotOwn && params.ensureDirectory) {
    fs.mkdirSync(robotOwn, { recursive: true });
  }
  return robotOwn;
}

/**
 * Robot own space (local and cloud share this formula).
 * tenants/<tenant>/users/<user>/OpenBot/agents/<agentId>/workspace
 *
 * When `dataRoot` is set it must be the directory returned by
 * `resolveDataRootForContext`. The workspace leaf is placed under that root
 * so callers do not build a second OpenBot tree.
 */
export function resolveRobotOwnWriteRoot(params: {
  stateDir?: string;
  tenantId: string;
  userId: string;
  agentId: string;
  dataRoot?: string;
}): string {
  const agentId = normalizeAgentId(params.agentId);
  const dataRoot = params.dataRoot?.trim();
  if (dataRoot) {
    return path.resolve(dataRoot, "agents", agentId, "workspace");
  }
  const stateDir = params.stateDir?.trim();
  if (!stateDir) {
    throw new Error("resolveRobotOwnWriteRoot requires stateDir or dataRoot");
  }
  return path.resolve(
    stateDir,
    "tenants",
    params.tenantId.trim(),
    "users",
    sanitizeWorkspaceOwner(params.userId),
    "OpenBot",
    "agents",
    agentId,
    "workspace",
  );
}

/**
 * Host process without a user identity — not a business space.
 * Never `agents.list[].workspace`, employees leftover, or L2 `OpenBot/workspace`.
 */
export function resolveUnscopedHostWriteRoot(params: {
  agentId: string;
  stateDir?: string;
}): string {
  const stateDir = params.stateDir ?? resolveStateDir(process.env);
  return path.resolve(stateDir, `workspace-${normalizeAgentId(params.agentId)}`);
}

/** Retired write roots that must not receive new deliverables. */
export function listPollutingRobotOwnWorkspaceDirs(params: {
  stateDir?: string;
  tenantId?: string | null;
  userId: string;
  agentId: string;
}): string[] {
  const stateDir = params.stateDir ?? resolveStateDir(process.env);
  const owner = sanitizeWorkspaceOwner(params.userId);
  const agentId = normalizeAgentId(params.agentId);
  const out = [path.resolve(stateDir, `workspace-${agentId}`)];
  // employees leftover is the old main-agent isolation root, not every robot's.
  if (agentId === "main") {
    out.push(path.resolve(stateDir, "agents", "main", "employees", owner, "workspace"));
  }
  const tenantId = params.tenantId?.trim();
  if (tenantId) {
    const openBot = path.resolve(stateDir, "tenants", tenantId, "users", owner, "OpenBot");
    out.push(path.join(openBot, "workspace"));
    if (agentId !== "main") {
      out.push(path.join(openBot, `workspace-${agentId}`));
    }
  }
  return out;
}

export function collectRobotOwnWorkspaceDirs(params: {
  stateDir: string;
  userId: string;
  agentId: string;
}): string[] {
  const tenantsRoot = path.resolve(params.stateDir, "tenants");
  let tenantIds: string[];
  try {
    tenantIds = fs
      .readdirSync(tenantsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const tenantId of tenantIds) {
    const dir = resolveRobotOwnWriteRoot({
      stateDir: params.stateDir,
      tenantId,
      userId: params.userId,
      agentId: params.agentId,
    });
    if (isExistingWorkspaceDirectory(dir)) {
      found.push(dir);
    }
  }
  return found;
}

function inferSoleTenantId(stateDir: string): string | null {
  const tenantsRoot = path.resolve(stateDir, "tenants");
  try {
    const tenantIds = fs
      .readdirSync(tenantsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
    return tenantIds.length === 1 ? tenantIds[0] : null;
  } catch {
    return null;
  }
}

function copyMissingTree(fromDir: string, toDir: string, fromRoot = fromDir): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(fromDir, { withFileTypes: true });
    fs.mkdirSync(toDir, { recursive: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.name === "." ||
      entry.name === ".." ||
      shouldSkipMergeEntry(entry.name, fromDir, fromRoot)
    ) {
      continue;
    }
    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      copyMissingTree(from, to, fromRoot);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    try {
      if (fs.existsSync(to)) {
        continue;
      }
      fs.copyFileSync(from, to);
    } catch {
      // Best-effort merge: a leftover type clash must not fail the live write root.
    }
  }
}

export function mergePollutingRobotWorkspaceIntoCanonical(params: {
  canonicalDir: string;
  stateDir: string;
  tenantId?: string | null;
  userId: string;
  agentId: string;
}): void {
  const canonical = path.resolve(params.canonicalDir);
  fs.mkdirSync(canonical, { recursive: true });
  for (const polluting of listPollutingRobotOwnWorkspaceDirs(params)) {
    if (!isExistingWorkspaceDirectory(polluting)) {
      continue;
    }
    if (path.resolve(polluting) === canonical) {
      continue;
    }
    copyMissingTree(polluting, canonical);
  }
}

function inferTenantIdFromExistingRobotOwnDir(params: {
  canonicalDir: string;
  stateDir: string;
  userId: string;
  agentId: string;
}): string | null {
  const canonical = path.resolve(params.canonicalDir);
  try {
    return (
      fs
        .readdirSync(path.resolve(params.stateDir, "tenants"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .find(
          (candidate) =>
            resolveRobotOwnWriteRoot({
              stateDir: params.stateDir,
              tenantId: candidate,
              userId: params.userId,
              agentId: params.agentId,
            }) === canonical,
        ) ?? null
    );
  } catch {
    return null;
  }
}

function mergeIntoCanonicalBestEffort(params: {
  canonicalDir: string;
  stateDir: string;
  tenantId?: string | null;
  userId: string;
  agentId: string;
  mergePolluting?: boolean;
}): void {
  if (params.mergePolluting === false) {
    return;
  }
  try {
    mergePollutingRobotWorkspaceIntoCanonical(params);
  } catch {
    // Canonical dir remains the write root even if leftover copy fails.
  }
}

function isGitWorkingTree(dir: string): boolean {
  try {
    const git = fs.statSync(path.join(dir, ".git"));
    return git.isDirectory() || git.isFile();
  } catch {
    return false;
  }
}

/** D1e robot own space may still contain a leftover `.git` from polluting-root merge. */
function isRobotOwnWorkspacePath(dir: string): boolean {
  const normalized = dir.split(path.sep).join("/");
  return /\/tenants\/[^/]+\/users\/[^/]+\/OpenBot\/agents\/[^/]+\/workspace$/.test(normalized);
}

/**
 * Production write root for a robot's own space.
 * Returns null when identity is missing — callers must not fall back to
 * agents.list workspace, employees leftover, or a host checkout.
 */
export function resolveRobotWriteRoot(params: {
  agentId: string;
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
  stateDir?: string;
  mergePolluting?: boolean;
}): string | null {
  const stateDir = params.stateDir ?? resolveStateDir(process.env);
  const userId =
    params.userId?.trim() ||
    extractEmployeeStewardUserIdFromSessionKey(params.sessionKey ?? "") ||
    "";
  if (!userId) {
    return null;
  }
  let tenantId = params.tenantId?.trim() || "";
  if (!tenantId) {
    tenantId = inferSoleTenantId(stateDir) ?? "";
  }
  if (!tenantId) {
    const scanned = collectRobotOwnWorkspaceDirs({
      stateDir,
      userId,
      agentId: params.agentId,
    });
    if (scanned.length !== 1) {
      return null;
    }
    const canonical = scanned[0];
    const matchedTenant = inferTenantIdFromExistingRobotOwnDir({
      canonicalDir: canonical,
      stateDir,
      userId,
      agentId: params.agentId,
    });
    mergeIntoCanonicalBestEffort({
      canonicalDir: canonical,
      stateDir,
      tenantId: matchedTenant,
      userId,
      agentId: params.agentId,
      mergePolluting: params.mergePolluting,
    });
    return canonical;
  }
  const canonical = resolveRobotOwnWriteRoot({
    stateDir,
    tenantId,
    userId,
    agentId: params.agentId,
  });
  mergeIntoCanonicalBestEffort({
    canonicalDir: canonical,
    stateDir,
    tenantId,
    userId,
    agentId: params.agentId,
    mergePolluting: params.mergePolluting,
  });
  fs.mkdirSync(canonical, { recursive: true });
  return canonical;
}

/**
 * Live robot cwd / write root. Never host `workspace-<id>`.
 * Prefer D1e when identity exists; otherwise a configured default that is not
 * a source-repo checkout. A leftover `.git` inside D1e is allowed.
 */
export function resolveLiveRobotWriteRoot(params: {
  agentId: string;
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
  configuredDefaultWorkspace?: string | null;
  stateDir?: string;
}): string {
  const robotOwn = resolveRobotWriteRoot(params);
  if (robotOwn) {
    return robotOwn;
  }
  const configured = params.configuredDefaultWorkspace?.trim();
  if (configured) {
    const resolved = path.resolve(configured);
    if (!isGitWorkingTree(resolved) || isRobotOwnWorkspacePath(resolved)) {
      return resolved;
    }
  }
  throw new Error("robot workspace requires tenant-user identity; refusing host workspace-<id>");
}

export function tryResolveLiveRobotWriteRoot(
  params: Parameters<typeof resolveLiveRobotWriteRoot>[0],
): string | null {
  try {
    return resolveLiveRobotWriteRoot(params);
  } catch {
    return null;
  }
}

/** Cron uses the same live write root (no host `workspace-<id>`). */
export function resolveCronWriteRoot(
  params: Parameters<typeof resolveLiveRobotWriteRoot>[0],
): string {
  return resolveLiveRobotWriteRoot(params);
}

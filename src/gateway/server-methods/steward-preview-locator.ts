import fs from "node:fs";
import path from "node:path";
import { extractOriginalFilename } from "../../media/store.js";
import {
  declareWorkspaceRelativePath,
  previewTrustedRoots,
  type DeclaredWorkspacePath,
} from "../../shared/workspace-deliverable-path.js";
import {
  collectRobotOwnWorkspaceDirs,
  isExistingWorkspaceDirectory,
  resolveLiveRobotWriteRoot,
  resolveRobotOwnWriteRoot,
} from "../workspace-resolver/write-roots.js";

export { previewTrustedRoots };

export {
  collectRobotOwnWorkspaceDirs as collectTenantUserAgentWorkspaceDirs,
  isExistingWorkspaceDirectory,
  resolveRobotOwnWriteRoot as resolveTenantUserAgentWorkspaceDir,
};

const SKIP_PREVIEW_SCAN_DIRS = new Set([".git", "node_modules"]);

/**
 * Agents often `cd` into a task folder under these roots and then declare only
 * the basename (`file="brief.pdf"` while the bytes live at `reports/<topic>/brief.pdf`).
 */
const NESTED_PREVIEW_ROOTS = new Set([
  "articles",
  "deliverables",
  "drafts",
  "output",
  "pages",
  "report",
  "reports",
]);

/** Working copies agents leave under a task folder. Not a full workspace walk. */
const TASK_PUBLISH_DIRS = ["deliver", "build_deck"] as const;

const CANONICAL_OUTPUT_DIR_BY_EXT: Record<string, string> = {
  ".ppt": "output/pptx",
  ".pptx": "output/pptx",
  ".doc": "output/docx",
  ".docx": "output/docx",
  ".pdf": "output/pdf",
  ".xls": "output/xlsx",
  ".xlsx": "output/xlsx",
  ".htm": "output/html",
  ".html": "output/html",
};

/**
 * Pick the filesystem workspace for conversation sidebar preview.
 *
 * Formal-aligned runtime write roots win over a catalog trusted twin that
 * exists as an empty tenants directory while settle already wrote operators
 * (batch9 skew / LIVE smoke-memo-67: tenants L2 without deliverables/,
 * operators formal SoT delivered+readable, steward-file.read still miss).
 * Trusted still wins when no runtime directory exists (legacy catalog-only).
 * Runtime also beats a stale `agents.list[].workspace` host checkout.
 */
export function resolvePreviewFilesystemLocator(params: {
  trustedLocator: string | null;
  runtimeWorkspaces?: readonly string[] | null;
  configuredWorkspace: string | null;
  configuredDefaultWorkspace?: string | null;
  agentId: string;
  stateDir: string;
}): string {
  for (const candidate of params.runtimeWorkspaces ?? []) {
    if (isExistingWorkspaceDirectory(candidate)) {
      return path.resolve(candidate);
    }
  }
  const trusted = params.trustedLocator?.trim() ?? "";
  if (isExistingWorkspaceDirectory(trusted)) {
    return path.resolve(trusted);
  }
  void params.configuredWorkspace;
  return resolveLiveRobotWriteRoot({
    agentId: params.agentId,
    configuredDefaultWorkspace: params.configuredDefaultWorkspace,
    stateDir: params.stateDir,
  });
}

function isScannableDir(entry: fs.Dirent): boolean {
  return (
    entry.isDirectory() && !SKIP_PREVIEW_SCAN_DIRS.has(entry.name) && !entry.name.startsWith(".")
  );
}

function pushFileMatch(matches: string[], absolutePath: string, relativePath: string): void {
  try {
    if (fs.statSync(absolutePath).isFile()) {
      matches.push(relativePath);
    }
  } catch {
    // skip missing paths
  }
}

/**
 * Match bare `file=` against legacy `{bare}---{uuid}.ext` embeds in a directory.
 * New media layout already stores a bare basename; this covers older inbound/upload paths.
 */
function pushLegacyEmbeddedBasenameMatches(
  matches: string[],
  dirAbsolute: string,
  relativePrefix: string,
  bareBasename: string,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbsolute, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (extractOriginalFilename(entry.name) !== bareBasename) {
      continue;
    }
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    if (!matches.includes(relativePath)) {
      matches.push(relativePath);
    }
  }
}

function resolveBareBasenameInImmediateDir(root: string, basename: string): string | null {
  const direct = path.join(root, basename);
  try {
    if (fs.statSync(direct).isFile()) {
      return basename;
    }
  } catch {
    // Continue: try contract output/<kind>/ then nested task folders.
  }
  // Legacy media embed in workspace root: bare.md declared, disk has bare---uuid.md
  {
    const legacyMatches: string[] = [];
    pushLegacyEmbeddedBasenameMatches(legacyMatches, root, "", basename);
    if (legacyMatches.length === 1) {
      return legacyMatches[0] ?? null;
    }
  }
  // Contract path (file= bare → output/html|pdf|…/basename) wins over ambiguous scans.
  const canonical = canonicalPreviewOutputRelPath(basename);
  if (canonical) {
    try {
      if (fs.statSync(path.join(root, canonical)).isFile()) {
        return canonical;
      }
    } catch {
      // Fall through to nested / task-folder discovery.
    }
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const matches: string[] = [];
  for (const entry of entries) {
    if (!isScannableDir(entry)) {
      continue;
    }
    pushFileMatch(matches, path.join(root, entry.name, basename), `${entry.name}/${basename}`);
    pushLegacyEmbeddedBasenameMatches(matches, path.join(root, entry.name), entry.name, basename);
  }
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    return null;
  }
  for (const entry of entries) {
    if (!isScannableDir(entry) || !NESTED_PREVIEW_ROOTS.has(entry.name)) {
      continue;
    }
    const nestedRoot = path.join(root, entry.name);
    let nested: fs.Dirent[];
    try {
      nested = fs.readdirSync(nestedRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sub of nested) {
      if (!isScannableDir(sub)) {
        continue;
      }
      pushFileMatch(
        matches,
        path.join(nestedRoot, sub.name, basename),
        `${entry.name}/${sub.name}/${basename}`,
      );
      const taskRoot = path.join(nestedRoot, sub.name);
      for (const publishDir of TASK_PUBLISH_DIRS) {
        pushFileMatch(
          matches,
          path.join(taskRoot, publishDir, basename),
          `${entry.name}/${sub.name}/${publishDir}/${basename}`,
        );
      }
    }
  }
  return selectTaskPublishMatch(matches);
}

/**
 * `deliver/` is the copy the user opens. `build_deck/` is the generator output
 * of the same task. Two topics with the same name stay unresolved.
 */
function selectTaskPublishMatch(matches: string[]): string | null {
  if (matches.length === 0) {
    return null;
  }
  if (matches.length === 1) {
    return matches[0] ?? null;
  }
  const canonical = matches.filter((item) => {
    const base = item.split("/").pop() ?? "";
    return canonicalPreviewOutputRelPath(base) === item;
  });
  if (canonical.length === 1) {
    return canonical[0] ?? null;
  }
  const deliver = matches.filter((item) => item.includes("/deliver/"));
  const deck = matches.filter((item) => item.includes("/build_deck/"));
  const other = matches.filter(
    (item) => !item.includes("/deliver/") && !item.includes("/build_deck/"),
  );
  if (other.length > 0 || deliver.length !== 1) {
    return null;
  }
  const deliverParent = deliver[0]?.split("/").slice(0, -2).join("/");
  const sameTask = deck.every((item) => item.split("/").slice(0, -2).join("/") === deliverParent);
  if (!deliverParent || !sameTask) {
    return null;
  }
  return deliver[0] ?? null;
}

/** Preview contract path for a bare filename. Project folders are not this path. */
export function canonicalPreviewOutputRelPath(filename: string): string | null {
  const base = path.posix.basename(filename.trim().replace(/\\/g, "/"));
  if (!base || base.includes("/") || base === "." || base === "..") {
    return null;
  }
  const dir = CANONICAL_OUTPUT_DIR_BY_EXT[path.posix.extname(base).toLowerCase()];
  if (!dir) {
    return null;
  }
  return `${dir}/${base}`;
}

/**
 * Bare `file="report.md"` may live in a unique immediate subdirectory, or one
 * task folder under reports/deliverables/output (agents `cd` there, then declare
 * only the basename). Prefixed paths stay declared identity — never rewrite them.
 */
export function resolveUniqueImmediatePreviewRelPath(
  workspaceRoot: string,
  requested: string,
): string | null {
  const normalized = requested.trim().replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0")) {
    return null;
  }
  const root = path.resolve(workspaceRoot);
  if (normalized.includes("/")) {
    return null;
  }
  return resolveBareBasenameInImmediateDir(root, normalized);
}

/**
 * Map a declared path onto this workspace.
 * Nested and mapped paths stay exact. Bare basenames may use the single
 * authorized unique-match helper. Absolute paths outside trusted roots are
 * unmappable and are not reduced to a basename.
 */
export function resolveAuthorizedPreviewRelativePath(params: {
  requested: string;
  workspaceRoot: string;
  trustedRoots: readonly string[];
}): DeclaredWorkspacePath {
  const located = declareWorkspaceRelativePath(params.requested, {
    trustedRoots: params.trustedRoots,
  });
  if (!located.ok || located.kind !== "basename") {
    return located;
  }
  const unique = resolveUniqueImmediatePreviewRelPath(params.workspaceRoot, located.relativePath);
  if (!unique) {
    return located;
  }
  return { ok: true, relativePath: unique, kind: "basename" };
}

/** Read the declared file, or the unique bare-name match, without leaving the workspace root. */
export function readUniquePreviewFile(
  workspaceRoot: string,
  requested: string,
): { relativePath: string; buffer: Buffer } | null {
  const normalized = requested.trim().replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0")) {
    return null;
  }
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    normalized.startsWith("/") ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  const root = path.resolve(workspaceRoot);
  const relative = normalized.includes("/")
    ? segments.join("/")
    : resolveUniqueImmediatePreviewRelPath(root, segments[0] ?? "");
  if (!relative) {
    return null;
  }
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  try {
    return { relativePath: relative, buffer: fs.readFileSync(absolute) };
  } catch {
    return null;
  }
}

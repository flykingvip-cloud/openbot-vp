import fs from "node:fs";
import path from "node:path";
import { assertWrittenFileNonEmptySync } from "../../infra/non-empty-workspace-write.js";
import { normalizeDeliverableWorkspacePath } from "../../shared/preview-artifact/deliverable-envelope.js";
import { resolveWorkspaceWriteLocator } from "./workspace-write-contract.js";
import { isFilesystemWorkspaceLocator, resolvePlacedFilesystemWriteRoot } from "./write-roots.js";

/**
 * Text-like extensions the preview pane opens via steward-file.read as inline
 * content. Declared envelopes for these kinds carry the file body; binary
 * office/pdf artifacts must arrive through workspace write tools instead.
 */
const TEXT_LIKE_DELIVERABLE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".log",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".xml",
]);

export type MaterializeDeclaredDeliverableResult =
  | { ok: true; absolutePath: string; relativePath: string; workspaceRoot: string }
  | { ok: false; reason: string };

function assertWithinWorkspaceRoot(workspaceRoot: string, absolutePath: string): boolean {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(absolutePath);
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * One rule: every declared deliverable the preview can open must land at the
 * workspace-relative path the preview reads. Never materialize into an
 * `unplaced://classified/...` (or cwd-polluted `unplaced:/classified/...`) root.
 */
export function materializeDeclaredDeliverableInWorkspace(params: {
  workspaceRoot: string;
  relativePath: string;
  content: string;
}): MaterializeDeclaredDeliverableResult {
  const workspaceRoot = params.workspaceRoot.trim();
  if (!workspaceRoot || !isFilesystemWorkspaceLocator(workspaceRoot)) {
    return { ok: false, reason: "workspace_root_unplaced" };
  }
  const rootResolved = path.resolve(workspaceRoot);
  if (!isFilesystemWorkspaceLocator(rootResolved)) {
    return { ok: false, reason: "workspace_root_unplaced" };
  }

  const decision = resolveWorkspaceWriteLocator({
    workspaceRoot: rootResolved,
    requestedPath: params.relativePath,
  });
  if (!decision.ok) {
    const reason =
      decision.code === "foreign_space"
        ? "foreign_space"
        : decision.code === "media_zip_stub"
          ? "media_zip_stub"
          : decision.code === "downloads" ||
              decision.code === "outside" ||
              decision.code === "ambiguous_root"
            ? "path_escape"
            : "invalid_relative_path";
    return { ok: false, reason };
  }
  const relativePath = normalizeDeliverableWorkspacePath(decision.relativePath);
  if (!relativePath) {
    return { ok: false, reason: "invalid_relative_path" };
  }

  const absolutePath = path.resolve(rootResolved, relativePath);
  if (!assertWithinWorkspaceRoot(rootResolved, absolutePath)) {
    return { ok: false, reason: "path_escape" };
  }

  const ext = path.posix.extname(relativePath).toLowerCase();
  const content = params.content;
  // A non-empty file already at the declared path is the deliverable. Do not
  // replace a tool write with the envelope summary.
  try {
    const existing = fs.statSync(absolutePath);
    if (existing.isFile() && existing.size > 0) {
      return { ok: true, absolutePath, relativePath, workspaceRoot: rootResolved };
    }
  } catch {
    // missing — text bodies may be materialized below; binaries stay a miss
  }
  if (!TEXT_LIKE_DELIVERABLE_EXTENSIONS.has(ext)) {
    // Binary / unknown: a zero-byte file is not a successful tool write.
    try {
      const existing = fs.statSync(absolutePath);
      if (existing.isFile()) {
        return { ok: false, reason: "empty_write" };
      }
    } catch {
      // missing
    }
    return { ok: false, reason: "binary_requires_tool_write" };
  }
  if (!content.trim() || Buffer.byteLength(content) === 0) {
    return { ok: false, reason: "empty_content" };
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
  try {
    assertWrittenFileNonEmptySync(absolutePath);
  } catch {
    return { ok: false, reason: "empty_write" };
  }
  return { ok: true, absolutePath, relativePath, workspaceRoot: rootResolved };
}

/**
 * Resolve the write root for a declared deliverable, then materialize it.
 * Unplaced catalog locators are replaced with the robot-own workspace so the
 * preview pane's workspace-relative read cannot miss the bytes.
 */
export function materializeDeclaredDeliverableAtPlacedRoot(params: {
  catalogLocator?: string | null;
  agentId: string;
  tenantId?: string | null;
  userId?: string | null;
  sessionKey?: string | null;
  stateDir?: string;
  relativePath: string;
  content: string;
}): MaterializeDeclaredDeliverableResult {
  const workspaceRoot = resolvePlacedFilesystemWriteRoot({
    locator: params.catalogLocator,
    agentId: params.agentId,
    tenantId: params.tenantId,
    userId: params.userId,
    sessionKey: params.sessionKey,
    stateDir: params.stateDir,
    ensureDirectory: true,
  });
  if (!workspaceRoot) {
    return { ok: false, reason: "workspace_root_unavailable" };
  }
  return materializeDeclaredDeliverableInWorkspace({
    workspaceRoot,
    relativePath: params.relativePath,
    content: params.content,
  });
}

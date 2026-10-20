/**
 * Bot deliverable write contract.
 *
 * Storage is one locator: the writing bot's own workspace, plus a path relative
 * to that workspace. Preview and download open that same path.
 *
 * Per-user space is `tenants/<tenant>/users/<user>/OpenBot/agents/<agent>/workspace`.
 * Managed Path B may already have remounted that tree to
 * `$STATE_DIR/operators/<user>/OpenBot/agents/<agent>/workspace`. Both shapes are
 * the same bot. Another user's tree, a shared dump, the install checkout, home
 * Downloads, and a media-upload zip stub are not.
 *
 * Operators: a bare `file=` that never received bytes is not a synced preview
 * (未写入工作区). Text bodies skipped by the write tool may be settled into this
 * bot's workspace and the collaboration group workspace at the same relative
 * path. Office/PDF bytes are never invented from chat markdown.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeOperatorId } from "../../config/operator-state-scope.js";
import { expandHomePrefix } from "../../infra/home-dir.js";
import { getMediaDir } from "../../media/store.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  CONTAINER_WORKSPACE_ALIASES,
  declareWorkspaceRelativePath,
} from "../../shared/workspace-deliverable-path.js";
import { isRetiredMultitenantWritePath } from "../account-execution-paths.js";

export const WORKSPACE_WRITE_OUTSIDE_MESSAGE =
  "workspace write refused: path is outside this bot's workspace";
export const WORKSPACE_WRITE_FOREIGN_MESSAGE = "workspace write refused: another user's bot space";
export const WORKSPACE_WRITE_AMBIGUOUS_MESSAGE =
  "workspace write refused: bare deliverable name needs a workspace-relative path";
export const WORKSPACE_WRITE_MEDIA_STUB_MESSAGE =
  "workspace write refused: media upload zip stubs are not deliverables";
export const WORKSPACE_WRITE_DOWNLOADS_MESSAGE =
  "workspace write refused: home Downloads is not a bot workspace";

const OFFICE_DELIVERABLE_EXT = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".pdf"]);

const MEDIA_INBOUND_ZIP_RE = /(?:^|\/)media\/inbound\/(?:[0-9a-f-]{36}\/)?[^/]+\.zip$/i;

export type WorkspaceWritePurpose = "file" | "directory";

export type WorkspaceWriteLocator =
  | {
      ok: true;
      workspaceRoot: string;
      relativePath: string;
      absolutePath: string;
      /** True when an absolute or alias path was reduced to the workspace-relative form. */
      rewritten: boolean;
    }
  | {
      ok: false;
      code:
        | "outside"
        | "foreign_space"
        | "ambiguous_root"
        | "media_zip_stub"
        | "downloads"
        | "rejected";
      message: string;
    };

export type BotSpaceIdentity = {
  userId: string;
  agentId: string;
};

function fail(
  code: Exclude<WorkspaceWriteLocator, { ok: true }>["code"],
  message: string,
): WorkspaceWriteLocator {
  return { ok: false, code, message };
}

function pathSegments(absPath: string): string[] {
  return path
    .resolve(absPath)
    .split(path.sep)
    .filter((segment) => segment.length > 0);
}

/** Identity of a bot workspace, or null when the path is not one. */
export function parseBotSpace(absPath: string): BotSpaceIdentity | null {
  const parts = pathSegments(absPath);
  for (let i = 0; i < parts.length - 5; i += 1) {
    if (
      parts[i] === "operators" &&
      parts[i + 2] === "OpenBot" &&
      parts[i + 3] === "agents" &&
      parts[i + 5] === "workspace"
    ) {
      const userId = parts[i + 1] ?? "";
      const agentId = parts[i + 4] ?? "";
      if (!userId || !agentId) {
        return null;
      }
      return { userId, agentId };
    }
  }
  for (let i = 0; i < parts.length - 7; i += 1) {
    if (
      parts[i] === "tenants" &&
      parts[i + 2] === "users" &&
      parts[i + 4] === "OpenBot" &&
      parts[i + 5] === "agents" &&
      parts[i + 7] === "workspace"
    ) {
      const userId = parts[i + 3] ?? "";
      const agentId = parts[i + 6] ?? "";
      if (!userId || !agentId) {
        return null;
      }
      return { userId, agentId };
    }
  }
  return null;
}

export function isBotOwnSpace(absPath: string): boolean {
  return parseBotSpace(absPath) !== null;
}

/** True when `absPath` is this user+agent workspace, including the operators remount. */
export function pathBelongsToBot(absPath: string, userId: string, agentId: string): boolean {
  const space = parseBotSpace(absPath);
  if (!space) {
    return false;
  }
  const expectedUser = normalizeOperatorId(userId);
  const actualUser = normalizeOperatorId(space.userId);
  if (!expectedUser || !actualUser || expectedUser !== actualUser) {
    return false;
  }
  return space.agentId === normalizeAgentId(agentId);
}

function usersMatch(left: string, right: string): boolean {
  const a = normalizeOperatorId(left);
  const b = normalizeOperatorId(right);
  return Boolean(a && b && a === b);
}

function ownersConflict(root: string, target: string): boolean {
  const rootSpace = parseBotSpace(root);
  const targetSpace = parseBotSpace(target);
  if (!targetSpace) {
    return false;
  }
  // A temp or install root is not allowed to drop bytes into a bot workspace
  // that merely sits underneath it.
  if (!rootSpace) {
    return true;
  }
  return (
    !usersMatch(rootSpace.userId, targetSpace.userId) ||
    normalizeAgentId(rootSpace.agentId) !== normalizeAgentId(targetSpace.agentId)
  );
}

function isUnder(child: string, parent: string): boolean {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  return (
    resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${path.sep}`)
  );
}

export function homeDownloadsDir(home: string = os.homedir()): string {
  return path.resolve(home, "Downloads");
}

export function isHomeDownloadsPath(absPath: string, home: string = os.homedir()): boolean {
  return isUnder(absPath, homeDownloadsDir(home));
}

function looksLikeDownloadsInput(raw: string): boolean {
  const normalized = raw.trim().replace(/\\/g, "/");
  if (
    normalized === "~/Downloads" ||
    normalized.startsWith("~/Downloads/") ||
    normalized.toLowerCase() === "~/downloads" ||
    normalized.toLowerCase().startsWith("~/downloads/")
  ) {
    return true;
  }
  const homeDownload =
    normalized.startsWith("/Users/") ||
    normalized.startsWith("/home/") ||
    /^[a-zA-Z]:\/Users\//.test(normalized);
  return homeDownload && /\/Downloads(\/|$)/i.test(normalized);
}

function isMediaUploadZipStub(relativePath: string, absolutePath: string): boolean {
  const relative = relativePath.replace(/\\/g, "/");
  if (MEDIA_INBOUND_ZIP_RE.test(relative)) {
    return true;
  }
  if (!absolutePath.toLowerCase().endsWith(".zip")) {
    return false;
  }
  try {
    const mediaDir = getMediaDir();
    return isUnder(absolutePath, mediaDir);
  } catch {
    return false;
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

/**
 * Install checkout or a retired shared dump. A bot-own workspace is never this,
 * even when a leftover `.git` was merged into it.
 */
export function isAmbiguousDeliverableRoot(root: string): boolean {
  const resolved = path.resolve(root);
  if (isBotOwnSpace(resolved)) {
    return false;
  }
  if (isRetiredMultitenantWritePath(resolved) || isHomeDownloadsPath(resolved)) {
    return true;
  }
  try {
    if (isUnder(resolved, getMediaDir())) {
      return true;
    }
  } catch {
    // media dir unavailable
  }
  if (!isGitWorkingTree(resolved)) {
    return false;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(resolved, "package.json"), "utf8")) as {
      name?: string;
    };
    const name = pkg.name ?? "";
    return name === "openbot" || name === "openclaw" || name === "@upbeyond/openbot";
  } catch {
    return false;
  }
}

function isWorkspaceRootDirectory(
  workspaceRoot: string,
  candidate: string,
  containerAliases: boolean,
): boolean {
  if (!path.isAbsolute(candidate)) {
    return false;
  }
  if (path.resolve(candidate) === path.resolve(workspaceRoot)) {
    return true;
  }
  if (!containerAliases) {
    return false;
  }
  const normalized = candidate.replace(/\\/g, "/").replace(/\/+$/, "");
  return CONTAINER_WORKSPACE_ALIASES.some((alias) => normalized === alias);
}

function withinRoot(root: string, absolutePath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(absolutePath);
  if (resolvedTarget === resolvedRoot) {
    return true;
  }
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Force one write onto this bot's workspace-relative locator.
 * Absolute paths inside the workspace are rewritten. Everything else is refused.
 */
export function resolveWorkspaceWriteLocator(params: {
  workspaceRoot: string;
  requestedPath: string;
  purpose?: WorkspaceWritePurpose;
  /** Sandbox mounts. Host writes enable this only for a bot-own space. */
  containerAliases?: boolean;
  homeDir?: string;
}): WorkspaceWriteLocator {
  const workspaceRoot = path.resolve(params.workspaceRoot);
  const purpose = params.purpose ?? "file";
  const raw = params.requestedPath?.trim() ?? "";
  if (!raw || raw.includes("\0")) {
    return fail("rejected", WORKSPACE_WRITE_OUTSIDE_MESSAGE);
  }
  if (looksLikeDownloadsInput(raw)) {
    return fail("downloads", WORKSPACE_WRITE_DOWNLOADS_MESSAGE);
  }
  const expanded = expandHomePrefix(raw, params.homeDir ? { home: params.homeDir } : undefined);
  if (
    looksLikeDownloadsInput(expanded) ||
    (path.isAbsolute(expanded) && isHomeDownloadsPath(expanded, params.homeDir))
  ) {
    return fail("downloads", WORKSPACE_WRITE_DOWNLOADS_MESSAGE);
  }

  const trustedRoots = [workspaceRoot];
  const useAliases = params.containerAliases || isBotOwnSpace(workspaceRoot);
  if (useAliases) {
    trustedRoots.push(...CONTAINER_WORKSPACE_ALIASES);
  }
  // The write tool mkdirs the parent before creating a file. That parent is
  // the workspace root itself for a root-level file, and the locator treats
  // an absolute path equal to a trusted root as unmappable.
  if (purpose === "directory" && isWorkspaceRootDirectory(workspaceRoot, expanded, useAliases)) {
    if (
      isHomeDownloadsPath(workspaceRoot, params.homeDir) ||
      isRetiredMultitenantWritePath(workspaceRoot)
    ) {
      return fail("ambiguous_root", WORKSPACE_WRITE_AMBIGUOUS_MESSAGE);
    }
    return {
      ok: true,
      workspaceRoot,
      relativePath: "",
      absolutePath: workspaceRoot,
      rewritten: false,
    };
  }
  const located = declareWorkspaceRelativePath(expanded, { trustedRoots });
  if (!located.ok) {
    const absoluteCandidate = path.isAbsolute(expanded) ? path.resolve(expanded) : "";
    if (absoluteCandidate && ownersConflict(workspaceRoot, absoluteCandidate)) {
      return fail("foreign_space", WORKSPACE_WRITE_FOREIGN_MESSAGE);
    }
    return fail(
      located.code === "rejected" ? "rejected" : "outside",
      WORKSPACE_WRITE_OUTSIDE_MESSAGE,
    );
  }

  const relativePath = located.relativePath;
  const absolutePath = path.resolve(workspaceRoot, relativePath);
  if (!withinRoot(workspaceRoot, absolutePath)) {
    return fail("outside", WORKSPACE_WRITE_OUTSIDE_MESSAGE);
  }
  if (isHomeDownloadsPath(absolutePath, params.homeDir)) {
    return fail("downloads", WORKSPACE_WRITE_DOWNLOADS_MESSAGE);
  }
  if (ownersConflict(workspaceRoot, absolutePath)) {
    return fail("foreign_space", WORKSPACE_WRITE_FOREIGN_MESSAGE);
  }
  if (isRetiredMultitenantWritePath(absolutePath) || isRetiredMultitenantWritePath(workspaceRoot)) {
    return fail("ambiguous_root", WORKSPACE_WRITE_AMBIGUOUS_MESSAGE);
  }
  if (purpose === "file" && isMediaUploadZipStub(relativePath, absolutePath)) {
    return fail("media_zip_stub", WORKSPACE_WRITE_MEDIA_STUB_MESSAGE);
  }
  const bareOffice =
    purpose === "file" &&
    !relativePath.includes("/") &&
    OFFICE_DELIVERABLE_EXT.has(path.posix.extname(relativePath).toLowerCase());
  if (bareOffice && isAmbiguousDeliverableRoot(workspaceRoot)) {
    return fail("ambiguous_root", WORKSPACE_WRITE_AMBIGUOUS_MESSAGE);
  }

  return {
    ok: true,
    workspaceRoot,
    relativePath,
    absolutePath,
    rewritten: located.kind === "mapped",
  };
}

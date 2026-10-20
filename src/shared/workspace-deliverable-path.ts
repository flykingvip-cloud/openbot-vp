/**
 * Workspace deliverable locator.
 *
 * Preview, download, and write must name one file: the owner workspace plus the
 * full relative path under that workspace. Absolute paths map only through
 * trusted roots (gateway workspace or the container mount of that same
 * workspace). They are never reduced to a basename, and `..` is rejected
 * instead of being stripped into a different file.
 */

export const WORKSPACE_PATH_UNMAPPABLE_MESSAGE = "cannot resolve workspace path";
export const WORKSPACE_PATH_REJECTED_MESSAGE = "invalid workspace path";

/**
 * Container mount points that mean "this session's workspace", not extra
 * directories the gateway may read. `/workspace` is the gateway sandbox mount.
 * `/account/workspace` is the Account Worker exec mount.
 */
export const CONTAINER_WORKSPACE_ALIASES = ["/workspace", "/account/workspace"] as const;

export type DeclaredWorkspacePathKind = "basename" | "relative" | "mapped";

export type DeclaredWorkspacePath =
  | { ok: true; relativePath: string; kind: DeclaredWorkspacePathKind }
  | { ok: false; code: "empty" | "rejected" | "unmappable"; message: string };

function normalizeSlashes(raw: string): string {
  return raw.trim().replace(/\\/g, "/");
}

function stripWindowsDrive(value: string): { absolute: boolean; path: string } {
  const drive = /^[a-zA-Z]:(.*)$/.exec(value);
  if (!drive) {
    return { absolute: value.startsWith("/"), path: value };
  }
  const rest = drive[1] ?? "";
  return { absolute: true, path: rest.startsWith("/") ? rest : `/${rest}` };
}

/** Trusted root, or null when the value is not an absolute path we can match. */
export function normalizeWorkspaceRoot(root: string | null | undefined): string | null {
  const trimmed = normalizeSlashes(root ?? "").replace(/\/+$/, "");
  if (!trimmed || trimmed.includes("\0")) {
    return null;
  }
  const { absolute, path } = stripWindowsDrive(trimmed);
  if (!absolute) {
    return null;
  }
  const parts = path.split("/");
  const body: string[] = [];
  for (const segment of parts) {
    if (!segment) {
      continue;
    }
    if (segment === "." || segment === "..") {
      return null;
    }
    body.push(segment);
  }
  if (body.length === 0) {
    return null;
  }
  return `/${body.join("/")}`;
}

function reject(code: "empty" | "rejected" | "unmappable"): DeclaredWorkspacePath {
  return {
    ok: false,
    code,
    message:
      code === "unmappable" ? WORKSPACE_PATH_UNMAPPABLE_MESSAGE : WORKSPACE_PATH_REJECTED_MESSAGE,
  };
}

/**
 * Split a declared path. `.` and `..` fail the whole path. Empty segments
 * (double slash, trailing slash) fail too — they are not dropped.
 */
function safeSegments(path: string, absolute: boolean): string[] | null {
  const parts = path.split("/");
  if (absolute) {
    if (!path.startsWith("/")) {
      return null;
    }
    parts.shift();
  }
  if (parts.length === 0) {
    return null;
  }
  for (const segment of parts) {
    if (!segment || segment === "." || segment === "..") {
      return null;
    }
  }
  return parts;
}

function matchTrustedRoot(absolutePath: string, trustedRoots: readonly string[]): string | null {
  const roots = trustedRoots
    .map((root) => normalizeWorkspaceRoot(root))
    .filter((root): root is string => Boolean(root))
    .toSorted((left, right) => right.length - left.length);
  for (const root of roots) {
    if (absolutePath === root) {
      return null;
    }
    const prefix = `${root}/`;
    if (absolutePath.startsWith(prefix)) {
      return absolutePath.slice(prefix.length);
    }
  }
  return null;
}

/**
 * Turn an agent-declared path into a workspace-relative locator.
 * Absolute paths stay unmappable unless `trustedRoots` contains the workspace
 * they actually sit under (boundary-safe; `/workspace` does not match
 * `/workspace-evil`).
 */
export function declareWorkspaceRelativePath(
  raw: string | null | undefined,
  options?: { trustedRoots?: readonly string[] },
): DeclaredWorkspacePath {
  const trimmed = normalizeSlashes(raw ?? "");
  if (!trimmed) {
    return reject("empty");
  }
  if (trimmed.includes("\0")) {
    return reject("rejected");
  }
  const { absolute, path } = stripWindowsDrive(trimmed);
  const segments = safeSegments(absolute ? path : path.replace(/^\/+/, ""), absolute);
  if (!segments) {
    return reject("rejected");
  }
  if (absolute) {
    const absolutePath = `/${segments.join("/")}`;
    const relativePath = matchTrustedRoot(absolutePath, options?.trustedRoots ?? []);
    if (!relativePath) {
      const underSomeRoot = (options?.trustedRoots ?? []).some((root) => {
        const normalized = normalizeWorkspaceRoot(root);
        return (
          normalized !== null &&
          (absolutePath === normalized || absolutePath.startsWith(`${normalized}/`))
        );
      });
      return reject(underSomeRoot ? "rejected" : "unmappable");
    }
    return { ok: true, relativePath, kind: "mapped" };
  }
  const relativePath = segments.join("/");
  return {
    ok: true,
    relativePath,
    kind: relativePath.includes("/") ? "relative" : "basename",
  };
}

/**
 * Value stored on an artifact card. Relative paths keep their directories.
 * Absolute paths are preserved so the gateway can map them. Traversal is not
 * rewritten into another filename.
 */
export function persistDeclaredWorkspaceLocator(raw: string | null | undefined): string | null {
  const located = declareWorkspaceRelativePath(raw);
  if (located.ok) {
    return located.relativePath;
  }
  if (located.code !== "unmappable") {
    return null;
  }
  const trimmed = normalizeSlashes(raw ?? "");
  const { path } = stripWindowsDrive(trimmed);
  return path.startsWith("/") ? path : `/${path}`;
}

/** Gateway workspace plus container mounts of that same workspace. */
export function previewTrustedRoots(
  gatewayWorkspace: string,
  options?: { containerWorkdir?: string | null },
): string[] {
  const configured = options?.containerWorkdir?.trim() ?? "";
  const candidates = [gatewayWorkspace, configured, ...CONTAINER_WORKSPACE_ALIASES];
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeWorkspaceRoot(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    roots.push(normalized);
  }
  return roots;
}

export function classifyWorkspacePathFailure(
  message: string,
): "unmappable" | "rejected" | "missing" {
  if (message.includes(WORKSPACE_PATH_UNMAPPABLE_MESSAGE)) {
    return "unmappable";
  }
  if (
    message.includes(WORKSPACE_PATH_REJECTED_MESSAGE) ||
    message.includes("invalid filename") ||
    message.includes("path_escape")
  ) {
    return "rejected";
  }
  return "missing";
}

import path from "node:path";
import { isPathInside } from "../infra/path-guards.js";
import { resolveSandboxPath } from "./sandbox-paths.js";

/**
 * Shared filesystem path authority when tools.fs.workspaceOnly is on.
 *
 * Protocol (External Baseline F5 / PROTO-001..003):
 * - Authority: shared-fs-resource (path class under workspaceOnly)
 * - Precedence: INTERSECT fail-closed — write-deny path class => exec-deny for mutations
 * - Conformance: declared here; observed by *.test.ts harnesses
 *
 * Provenance: deny message includes shared-fs-resource intersect; exec_policy
 * owner remains tools.exec for schema stability while reason carries authority id.
 */
export const SHARED_FS_RESOURCE_OWNER = "shared-fs-resource" as const;

export type SharedFsResourceOwner = typeof SHARED_FS_RESOURCE_OWNER;

/**
 * True when write/workspace-root-guard would deny this path for sandbox_boundary.
 * Pure INTERSECT helper — same path-class authority exec must consult.
 */
export function wouldWriteDenyPath(filePath: string, workspaceRoot: string): boolean {
  try {
    resolveSandboxPath({ filePath, cwd: workspaceRoot, root: workspaceRoot });
    return false;
  } catch {
    return true;
  }
}

/**
 * Strip POSIX heredoc bodies so redirect-like tokens inside the body
 * (e.g. markdown `> /tmp/x` or docs mentioning paths) are not treated as
 * mutation targets. The heredoc introducer line is kept so a real redirect
 * on that line (e.g. `cat <<EOF > out.md`) still extracts `out.md`.
 */
export function stripShellHeredocBodies(command: string): string {
  // <<[-]? ['"]WORD['"] \n body \n WORD
  // Keep the rest of the introducer line (e.g. `> out.md`) so redirects there
  // remain visible to extractors; only the body between newlines is removed.
  return command.replace(
    /(<<[-]?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2[^\n]*)(\r?\n)[\s\S]*?(\r?\n)\3(?=\s|$|[;&|<>])/g,
    "$1$4$5",
  );
}

/**
 * Best-effort extract of filesystem mutation targets from common shell forms.
 * Fail-closed only when a clear outside-workspace target is present; complex
 * pipes/heredocs with no extractable target are left to tools.exec alone.
 * Heredoc bodies are stripped first to avoid false positives from body text.
 */
export function extractExecFilesystemMutationTargets(command: string, workdir: string): string[] {
  const raw = stripShellHeredocBodies(command).trim();
  if (!raw) {
    return [];
  }

  const targets: string[] = [];
  const seen = new Set<string>();

  const pushTarget = (relOrAbs: string | undefined) => {
    if (!relOrAbs) {
      return;
    }
    const cleaned = relOrAbs.replace(/^['"]|['"]$/g, "").trim();
    if (!cleaned || cleaned === "-" || cleaned.startsWith("&")) {
      return;
    }
    // Skip shell operators / flags mistaken as paths.
    if (cleaned.startsWith("-") && cleaned !== "-") {
      // allow "-" as stdout already skipped; flags like -f are not paths
      if (!cleaned.includes("/") && !cleaned.includes("\\")) {
        return;
      }
    }
    const resolved = path.isAbsolute(cleaned)
      ? path.resolve(cleaned)
      : path.resolve(workdir, cleaned);
    if (seen.has(resolved)) {
      return;
    }
    seen.add(resolved);
    targets.push(resolved);
  };

  // Redirections: >, >>, >|, &>, &>>, 2>, 2>>
  const redirRe = /(?:^|[\s;|&])(?:&>|>>|[\d]?>\|?|>>|&>>|\d?>>|\d?>)\s*([^\s;|&]+)/g;
  // Simpler portable redirection matcher
  const simpleRedirRe = /(?:&>>|&>|>>|>\||>)\s*([^\s;|&<>]+)/g;
  let match: RegExpExecArray | null;
  while ((match = simpleRedirRe.exec(raw)) !== null) {
    pushTarget(match[1]);
  }
  // Also match N> and N>> (e.g. 2>/tmp/err)
  const numberedRedirRe =
    /(?:^|[\s;|&])\d>>(?!>)\s*([^\s;|&<>]+)|(?:^|[\s;|&])\d>(?!>)(?![>&])\s*([^\s;|&<>]+)/g;
  while ((match = numberedRedirRe.exec(raw)) !== null) {
    pushTarget(match[1] ?? match[2]);
  }
  void redirRe;

  // tee [-a] path...
  const teeRe = /(?:^|[\s;|&])tee(?:\s+-a)?\s+([^\s;|&<>]+)/g;
  while ((match = teeRe.exec(raw)) !== null) {
    pushTarget(match[1]);
  }

  // touch / rm / mkdir paths (first few operands)
  const simpleCmdRe =
    /(?:^|[\s;|&])(?:touch|rm|rmdir|mkdir|unlink)\s+(?:(?:-[a-zA-Z]+\s+)*)([^\s;|&<>]+)/g;
  while ((match = simpleCmdRe.exec(raw)) !== null) {
    pushTarget(match[1]);
  }

  // cp/mv/install: last operand is destination
  const copyLikeRe = /(?:^|[\s;|&])(?:cp|mv|install)\s+(?:(?:-[a-zA-Z]+\s+)*)(.+)$/g;
  while ((match = copyLikeRe.exec(raw)) !== null) {
    const parts = match[1]
      .trim()
      .split(/\s+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => !p.startsWith("-"));
    if (parts.length >= 1) {
      pushTarget(parts[parts.length - 1]);
    }
  }

  // dd of=path
  const ddRe = /(?:^|[\s;|&])dd\s+[^;|&]*?\bof=([^\s;|&]+)/g;
  while ((match = ddRe.exec(raw)) !== null) {
    pushTarget(match[1]);
  }

  return targets;
}

/**
 * Harmless Unix device nodes / stdio aliases that are commonly used as
 * redirect sinks (e.g. `2>/dev/null`). Allowing these outside the workspace
 * does not weaken INTERSECT write-deny for real filesystem paths.
 */
const SAFE_SYSTEM_DEVICE_PATHS = new Set([
  "/dev/null",
  "/dev/zero",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/random",
  "/dev/urandom",
]);

export function isSafeSystemDevicePath(target: string): boolean {
  const normalized = path.resolve(target.trim());
  if (SAFE_SYSTEM_DEVICE_PATHS.has(normalized)) {
    return true;
  }
  // /dev/fd/N and /dev/fd (macOS / Linux stdio aliases)
  if (normalized === "/dev/fd" || normalized.startsWith("/dev/fd/")) {
    return true;
  }
  return false;
}

export function assertSharedFsExecMutationAllowed(params: {
  command: string;
  workdir: string;
  workspaceRoot: string;
  workspaceOnly: boolean;
}): void {
  if (!params.workspaceOnly) {
    return;
  }
  const root = path.resolve(params.workspaceRoot);
  const targets = extractExecFilesystemMutationTargets(params.command, params.workdir);
  for (const target of targets) {
    if (isSafeSystemDevicePath(target)) {
      continue;
    }
    if (isPathInside(root, target)) {
      continue;
    }
    // Double-check with sandbox semantics (matches write deny path class).
    if (!wouldWriteDenyPath(target, root)) {
      continue;
    }
    throw new Error(
      `exec denied: shared-fs-resource intersect: Path escapes workspace root (${root}): ${target}`,
    );
  }
}

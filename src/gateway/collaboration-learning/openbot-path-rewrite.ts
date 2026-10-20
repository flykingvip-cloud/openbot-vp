import fs from "node:fs";
import path from "node:path";

/**
 * After the ~/.openclaw → ~/.openbot cutover, leftover config/defaults still
 * emit `/.openclaw/` transcript and workspace paths. If the `.openbot`
 * equivalent already exists, that tree is SoT — never persist or mkdir an
 * empty `.openclaw` copy.
 */
export function rewriteOpenclawPathToOpenbotIfPresent(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return trimmed;
  }
  const resolved = path.resolve(trimmed);
  const rewritten = resolved
    .split(`${path.sep}.openclaw${path.sep}`)
    .join(`${path.sep}.openbot${path.sep}`);
  if (rewritten === resolved) {
    return resolved;
  }
  try {
    // Only the equivalent path itself: do not treat ~/.openbot state-dir as
    // proof that ~/.openbot/workspace exists.
    if (fs.existsSync(rewritten)) {
      return rewritten;
    }
  } catch {
    // best-effort: keep the original path
  }
  return resolved;
}

/** True when a sessionFile/workspace path still points at the dead `.openclaw` tree. */
export function pathContainsOpenclawSegment(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.includes("/.openclaw/");
}

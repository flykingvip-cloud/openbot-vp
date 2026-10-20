import path from "node:path";

const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function assertSafePathSegment(segment: string, label: string): void {
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("\0") ||
    !SAFE_SEGMENT.test(segment)
  ) {
    throw new Error(`unsafe ${label} path segment: ${JSON.stringify(segment)}`);
  }
}

export function resolveContainedRoot(root: string): string {
  const resolved = path.resolve(root);
  if (!resolved) {
    throw new Error("containment root is required");
  }
  return resolved;
}

export function resolveContainedPath(root: string, ...segments: string[]): string {
  const base = resolveContainedRoot(root);
  for (const seg of segments) {
    assertSafePathSegment(seg, "directory");
  }
  const candidate = path.resolve(base, ...segments);
  if (!isPathInside(base, candidate)) {
    throw new Error("path escapes containment root");
  }
  return candidate;
}

export function isPathInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function toPathPattern(containmentRoot: string, absPath: string): string {
  const root = path.resolve(containmentRoot);
  const abs = path.resolve(absPath);
  if (!isPathInside(root, abs)) {
    return "{outside-containment}";
  }
  const suffix = abs.slice(root.length).split(path.sep).join("/");
  return `{stateDir}${suffix}`;
}

import fs from "node:fs";
import path from "node:path";

/**
 * Steward cutover placement policy (Stage B P0-1 hardening).
 *
 * The provisioning command receives source/target workspace roots as trusted caller input, but
 * "trusted by comment" is not enough: without physical validation the command would `mkdir`/copy to
 * any caller-supplied path. This module binds a placement to {tenantId,userId,resourceId} and enforces:
 *  - absolute paths (root + source + target),
 *  - no `..` traversal segment,
 *  - realpath containment of source/target inside a caller-supplied allowed root,
 *  - symlink-escape rejection (a path that is logically inside the root but whose realpath escapes),
 *  - distinct source/target (by realpath),
 * and returns an auditable {@link StewardPlacementHandle} recording both logical and resolved paths.
 *
 * It performs NO host-path resolution and calls none of the frozen `resolve*WorkspaceDir` helpers, so
 * it adds no Phase 0 watched call sites. The allowed root is supplied by the caller (never derived from
 * a host resolver here); production callers must pass a tenant/user-scoped allowed root.
 */

export type StewardPlacementInput = {
  tenantId: string;
  userId: string;
  resourceId: string;
  /** Absolute, existing allowed base root; source/target must resolve within it. */
  allowedRoot: string;
  sourceRoot: string;
  targetRoot: string;
};

export type StewardPlacementHandle = {
  tenantId: string;
  userId: string;
  resourceId: string;
  /** realpath-resolved allowed root. */
  allowedRoot: string;
  /** Logical (caller-supplied, resolved) source/target. */
  sourceRoot: string;
  targetRoot: string;
  /** realpath of the deepest existing ancestor + remaining segments (safe against symlink escape). */
  sourceReal: string;
  targetReal: string;
  decidedAtMs: number;
};

export type StewardPlacementReason =
  | "placement_missing"
  | "placement_root_not_absolute"
  | "placement_not_absolute"
  | "placement_path_escape"
  | "placement_root_missing"
  | "placement_outside_allowed_root"
  | "placement_symlink_escape"
  | "placement_source_target_collision";

export type StewardPlacementResult =
  | { ok: true; handle: StewardPlacementHandle }
  | { ok: false; reason: StewardPlacementReason };

/** A `..` segment anywhere is an escape attempt (checked before realpath resolution). */
function hasTraversalSegment(candidate: string): boolean {
  return candidate.split(/[\\/]/).includes("..");
}

/** True when `candidate` is `root` itself or nested beneath it. */
function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve the realpath of a possibly-not-yet-existing path: realpath the deepest existing ancestor,
 * then re-append the non-existent trailing segments. This surfaces a symlinked ancestor that would
 * redirect the (future) directory outside the allowed root.
 */
function realPathOfNearestExisting(candidate: string): string {
  let current = path.resolve(candidate);
  const suffix: string[] = [];
  for (;;) {
    if (fs.existsSync(current)) {
      const real = fs.realpathSync(current);
      return suffix.length > 0 ? path.join(real, ...suffix) : real;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(candidate);
    }
    suffix.unshift(path.basename(current));
    current = parent;
  }
}

/**
 * Validate a steward cutover placement. Fail-closed: any policy violation returns a structured reason
 * and no filesystem mutation happens here.
 */
export function resolveStewardPlacement(
  input: StewardPlacementInput,
  nowMs?: number,
): StewardPlacementResult {
  const allowedRoot = input.allowedRoot?.trim() ?? "";
  const sourceRoot = input.sourceRoot?.trim() ?? "";
  const targetRoot = input.targetRoot?.trim() ?? "";
  if (!allowedRoot || !sourceRoot || !targetRoot) {
    return { ok: false, reason: "placement_missing" };
  }
  if (!path.isAbsolute(allowedRoot)) {
    return { ok: false, reason: "placement_root_not_absolute" };
  }
  if (!path.isAbsolute(sourceRoot) || !path.isAbsolute(targetRoot)) {
    return { ok: false, reason: "placement_not_absolute" };
  }
  if (
    hasTraversalSegment(allowedRoot) ||
    hasTraversalSegment(sourceRoot) ||
    hasTraversalSegment(targetRoot)
  ) {
    return { ok: false, reason: "placement_path_escape" };
  }

  // The allowed root must exist so it can be realpath-resolved; otherwise containment is undefined.
  let realRoot: string;
  try {
    if (!fs.existsSync(allowedRoot)) {
      return { ok: false, reason: "placement_root_missing" };
    }
    realRoot = fs.realpathSync(allowedRoot);
  } catch {
    return { ok: false, reason: "placement_root_missing" };
  }

  const logicalRoot = path.resolve(allowedRoot);
  const sourceLogical = path.resolve(sourceRoot);
  const targetLogical = path.resolve(targetRoot);

  // Logical containment first: reject arbitrary paths (/etc, repo, home, other tenant) outright.
  if (!isWithin(logicalRoot, sourceLogical) || !isWithin(logicalRoot, targetLogical)) {
    return { ok: false, reason: "placement_outside_allowed_root" };
  }

  // Symlink-escape: a path that is logically inside but whose realpath resolves outside the root.
  const sourceReal = realPathOfNearestExisting(sourceRoot);
  const targetReal = realPathOfNearestExisting(targetRoot);
  if (!isWithin(realRoot, sourceReal) || !isWithin(realRoot, targetReal)) {
    return { ok: false, reason: "placement_symlink_escape" };
  }

  // Distinct source/target by realpath (a symlink must not alias them together).
  if (sourceReal === targetReal) {
    return { ok: false, reason: "placement_source_target_collision" };
  }

  return {
    ok: true,
    handle: {
      tenantId: input.tenantId,
      userId: input.userId,
      resourceId: input.resourceId,
      allowedRoot: realRoot,
      sourceRoot: sourceLogical,
      targetRoot: targetLogical,
      sourceReal,
      targetReal,
      decidedAtMs: nowMs ?? Date.now(),
    },
  };
}

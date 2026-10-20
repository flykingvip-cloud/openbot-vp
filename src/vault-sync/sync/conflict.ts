import fs from "node:fs";
import path from "node:path";

export type ConflictCopyResult = {
  leftPath: string;
  rightPath: string;
  conflictLeftPath: string;
  conflictRightPath: string;
};

function isTextLike(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [".md", ".markdown", ".txt", ".csv", ".json", ".yaml", ".yml", ".toml"].includes(ext);
}

/**
 * Binary files: never auto-merge — write conflict copies only.
 * Text: P1 writes conflict copies; optional line-based 3-way can be added later.
 */
export function writeConflictCopies(params: {
  rootPath: string;
  relativePath: string;
  leftContent: Buffer;
  rightContent: Buffer;
  leftDeviceId: string;
  rightDeviceId: string;
  at?: Date;
}): ConflictCopyResult {
  const at = params.at ?? new Date();
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  const parsed = path.posix.parse(params.relativePath.replace(/\\/g, "/"));
  const dir = parsed.dir;
  const base = parsed.name;
  const ext = parsed.ext;

  const leftName = `${base}.${params.leftDeviceId.slice(0, 8)}.${stamp}.sync-conflict${ext}`;
  const rightName = `${base}.${params.rightDeviceId.slice(0, 8)}.${stamp}.sync-conflict${ext}`;
  const leftRel = dir ? `${dir}/${leftName}` : leftName;
  const rightRel = dir ? `${dir}/${rightName}` : rightName;

  const absLeft = path.join(params.rootPath, leftRel);
  const absRight = path.join(params.rootPath, rightRel);
  fs.mkdirSync(path.dirname(absLeft), { recursive: true });
  fs.writeFileSync(absLeft, params.leftContent);
  fs.writeFileSync(absRight, params.rightContent);

  return {
    leftPath: params.relativePath,
    rightPath: params.relativePath,
    conflictLeftPath: leftRel,
    conflictRightPath: rightRel,
  };
}

export function canAttemptTextMerge(relativePath: string): boolean {
  return isTextLike(relativePath);
}

/**
 * Naive 3-way line merge. Returns null when unsafe (overlapping changes).
 */
export function tryThreeWayTextMerge(params: {
  ancestor: string;
  left: string;
  right: string;
}): string | null {
  const a = params.ancestor.split("\n");
  const l = params.left.split("\n");
  const r = params.right.split("\n");
  // Identical sides
  if (params.left === params.right) {
    return params.left;
  }
  if (params.left === params.ancestor) {
    return params.right;
  }
  if (params.right === params.ancestor) {
    return params.left;
  }
  // If both diverge from ancestor with different line counts in overlapping regions — unsafe for P1
  // Keep it conservative: only auto-merge when one side equals ancestor (handled above)
  // or when concatenation of unique non-overlapping append-only tails.
  if (l.length >= a.length && r.length >= a.length) {
    const lPrefix = l.slice(0, a.length).join("\n");
    const rPrefix = r.slice(0, a.length).join("\n");
    const aText = a.join("\n");
    if (lPrefix === aText && rPrefix === aText) {
      // both only appended
      const lTail = l.slice(a.length);
      const rTail = r.slice(a.length);
      return [...a, ...lTail, ...rTail].join("\n");
    }
  }
  void r;
  return null;
}

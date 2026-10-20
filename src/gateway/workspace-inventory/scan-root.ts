import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isPathInside } from "./path-safety.js";

export type ScanRootLimits = {
  maxFiles: number;
  maxDepth: number;
  maxBytesRead: number;
  maxFullHashBytes: number;
};

export type ScanRootResult = {
  fileCount: number;
  byteCount: number;
  contentDigest: string | null;
  truncated: boolean;
  errors: string[];
  bytesRead: number;
};

type ScanBudget = {
  filesSeen: number;
  bytesRead: number;
  truncated: boolean;
  errors: string[];
};

function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function hashFileLimited(
  filePath: string,
  limits: ScanRootLimits,
  budget: ScanBudget,
): { fingerprint: string | null; size: number } {
  let st: fs.Stats;
  try {
    st = fs.statSync(filePath);
  } catch (err) {
    budget.errors.push(`stat failed: ${String((err as Error)?.message ?? err)}`);
    return { fingerprint: null, size: 0 };
  }
  if (!st.isFile()) {
    return { fingerprint: null, size: 0 };
  }
  const toRead = st.size <= limits.maxFullHashBytes ? st.size : Math.min(1024 * 1024, st.size);
  if (budget.bytesRead + toRead > limits.maxBytesRead) {
    budget.truncated = true;
    return { fingerprint: null, size: st.size };
  }
  const fd = fs.openSync(filePath, "r");
  try {
    const hash = crypto.createHash("sha256");
    if (st.size <= limits.maxFullHashBytes) {
      const data = fs.readFileSync(fd);
      budget.bytesRead += data.length;
      hash.update(data);
      return { fingerprint: hash.digest("hex"), size: st.size };
    }
    const buf = Buffer.alloc(1024 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    budget.bytesRead += n;
    hash.update(buf.subarray(0, n));
    return { fingerprint: `partial1MiB:${hash.digest("hex")}`, size: st.size };
  } catch (err) {
    budget.errors.push(`read failed: ${String((err as Error)?.message ?? err)}`);
    return { fingerprint: null, size: st.size };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Bounded, read-only scan of a workspace candidate root.
 * Does not use mtime for ownership inference.
 */
export function scanWorkspaceRoot(params: {
  containmentRoot: string;
  candidateRoot: string;
  limits: ScanRootLimits;
}): ScanRootResult {
  const root = path.resolve(params.candidateRoot);
  const budget: ScanBudget = {
    filesSeen: 0,
    bytesRead: 0,
    truncated: false,
    errors: [],
  };
  const fingerprints: string[] = [];
  let byteCount = 0;

  if (!fs.existsSync(root)) {
    return {
      fileCount: 0,
      byteCount: 0,
      contentDigest: null,
      truncated: false,
      errors: [],
      bytesRead: 0,
    };
  }

  let rootStat: fs.Stats;
  try {
    rootStat = fs.statSync(root);
  } catch (err) {
    return {
      fileCount: 0,
      byteCount: 0,
      contentDigest: null,
      truncated: false,
      errors: [`root stat failed: ${String((err as Error)?.message ?? err)}`],
      bytesRead: 0,
    };
  }
  if (!rootStat.isDirectory()) {
    return {
      fileCount: 0,
      byteCount: 0,
      contentDigest: null,
      truncated: false,
      errors: ["candidate root is not a directory"],
      bytesRead: 0,
    };
  }

  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (depth > params.limits.maxDepth) {
      budget.truncated = true;
      continue;
    }
    if (!isPathInside(params.containmentRoot, dir)) {
      budget.errors.push("directory escapes containment root");
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      budget.errors.push(`readdir failed: ${String((err as Error)?.message ?? err)}`);
      continue;
    }
    for (const ent of entries) {
      if (ent.name === "." || ent.name === ".." || ent.name.startsWith("._")) {
        continue;
      }
      if (ent.name.includes("\0") || ent.name.includes("/") || ent.name.includes("\\")) {
        budget.errors.push(`unsafe entry name: ${JSON.stringify(ent.name)}`);
        continue;
      }
      const full = path.resolve(dir, ent.name);
      if (!isPathInside(root, full) || !isPathInside(params.containmentRoot, full)) {
        budget.errors.push("entry escapes scan root");
        continue;
      }
      if (ent.isDirectory()) {
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      budget.filesSeen += 1;
      if (budget.filesSeen > params.limits.maxFiles) {
        budget.truncated = true;
        break;
      }
      const rel = path.relative(root, full).split(path.sep).join("/");
      const hashed = hashFileLimited(full, params.limits, budget);
      if (hashed.fingerprint) {
        fingerprints.push(`${rel}:${hashed.fingerprint}:${hashed.size}`);
        byteCount += hashed.size;
      } else if (budget.truncated) {
        break;
      }
    }
    if (budget.truncated && budget.filesSeen > params.limits.maxFiles) {
      break;
    }
  }

  fingerprints.sort();
  const contentDigest =
    fingerprints.length > 0 && !budget.truncated
      ? sha256Hex(fingerprints.join("\n"))
      : fingerprints.length > 0
        ? sha256Hex(`truncated:${fingerprints.join("\n")}`)
        : null;

  return {
    fileCount: budget.filesSeen,
    byteCount,
    contentDigest,
    truncated: budget.truncated,
    errors: budget.errors.slice(0, 50),
    bytesRead: budget.bytesRead,
  };
}

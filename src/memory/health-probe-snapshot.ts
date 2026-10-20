import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Fixed-order probe snapshot entry (rev.4.1 §6.4.2). */
export type ProbeSnapshotEntry = {
  path: string;
  present: boolean;
  type?: "file" | "directory" | "symlink" | "missing";
  size?: number | null;
  mtimeMs?: number | null;
  contentSha256?: string;
  symlinkTarget?: string;
};

const ENTRY_FIELD_ORDER = [
  "path",
  "present",
  "type",
  "size",
  "mtimeMs",
  "contentSha256",
  "symlinkTarget",
] as const satisfies readonly (keyof ProbeSnapshotEntry)[];

/** Serialize one entry with stable field order; omit undefined fields. */
export function serializeProbeSnapshotEntry(entry: ProbeSnapshotEntry): string {
  const parts: string[] = [];
  for (const key of ENTRY_FIELD_ORDER) {
    const value = entry[key];
    if (value === undefined) {
      continue;
    }
    parts.push(`${key}=${String(value)}`);
  }
  return parts.join("|");
}

/** Stable canonical text: sort by path, then serialize each entry. */
export function canonicalizeProbeSnapshot(entries: ProbeSnapshotEntry[]): string {
  const sorted = [...entries].toSorted((a, b) => a.path.localeCompare(b.path, "en"));
  return sorted.map(serializeProbeSnapshotEntry).join("\n");
}

export function hashProbeSnapshot(entries: ProbeSnapshotEntry[]): string {
  return crypto.createHash("sha256").update(canonicalizeProbeSnapshot(entries)).digest("hex");
}

export function diffProbeSnapshots(
  before: ProbeSnapshotEntry[],
  after: ProbeSnapshotEntry[],
): { mutationsDetected: boolean; changedPaths: string[] } {
  const beforeMap = new Map(
    before.map((entry) => [entry.path, serializeProbeSnapshotEntry(entry)]),
  );
  const afterMap = new Map(after.map((entry) => [entry.path, serializeProbeSnapshotEntry(entry)]));
  const paths = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changedPaths: string[] = [];
  for (const probePath of [...paths].toSorted((a, b) => a.localeCompare(b, "en"))) {
    if (beforeMap.get(probePath) !== afterMap.get(probePath)) {
      changedPaths.push(probePath);
    }
  }
  return { mutationsDetected: changedPaths.length > 0, changedPaths };
}

export function statPathForSnapshot(targetPath: string): ProbeSnapshotEntry {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      let symlinkTarget = "";
      try {
        symlinkTarget = fs.readlinkSync(targetPath);
      } catch {
        symlinkTarget = "";
      }
      return {
        path: targetPath,
        present: true,
        type: "symlink",
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        symlinkTarget,
      };
    }
    if (stat.isDirectory()) {
      return {
        path: targetPath,
        present: true,
        type: "directory",
        size: null,
        mtimeMs: stat.mtimeMs,
      };
    }
    if (stat.isFile()) {
      const content = fs.readFileSync(targetPath);
      // Node SQLite readonly open can refresh *-shm mtime without changing
      // size or bytes; integrity uses size + content hash for those sidecars.
      const omitMtime = path.basename(targetPath).endsWith("-shm");
      return {
        path: targetPath,
        present: true,
        type: "file",
        size: stat.size,
        contentSha256: crypto.createHash("sha256").update(content).digest("hex"),
        ...(omitMtime ? {} : { mtimeMs: stat.mtimeMs }),
      };
    }
    return {
      path: targetPath,
      present: true,
      type: "file",
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return { path: targetPath, present: false, type: "missing" };
  }
}

/** Collect snapshot entries for probe integrity (read-only stat). */
export function collectProbeSnapshotPaths(paths: string[]): ProbeSnapshotEntry[] {
  const unique = [...new Set(paths.map((p) => path.resolve(p)))].toSorted((a, b) =>
    a.localeCompare(b, "en"),
  );
  return unique.map(statPathForSnapshot);
}

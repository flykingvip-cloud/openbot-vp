/**
 * CQ-O0 read-only memory health probe.
 *
 * MUST NOT import manager search stack or chokidar.
 * Does not ensure schema, create directories, or mutate sqlite/workspace.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  collectProbeSnapshotPaths,
  diffProbeSnapshots,
  hashProbeSnapshot,
  type ProbeSnapshotEntry,
} from "./health-probe-snapshot.js";
import type { MemoryOpsStatus, ProbeArtifactDiff } from "./health-report.js";
import {
  isKnownConflictSqlite,
  normalizeRootFingerprint,
  normalizeSqliteInstanceId,
  readSidecar,
  resolveV1RootGuardIndexStatus,
  sidecarPathForSqlite,
} from "./v1-root-guard.js";

export type MemoryHealthProbeAgentInput = {
  agentId: string;
  workspaceRoot: string;
  indexPath: string;
  backend?: string;
};

export type MemoryHealthProbeResult = {
  agent: MemoryOpsStatus;
  snapshotPaths: string[];
};

export type MemoryHealthProbe = {
  probeAgent: (input: MemoryHealthProbeAgentInput) => MemoryHealthProbeResult;
  collectSnapshot: (paths: string[]) => ProbeSnapshotEntry[];
  runIntegrityCheck: (
    paths: string[],
    fn: () => void | Promise<void>,
  ) => Promise<ProbeArtifactDiff>;
};

function listMemoryMarkdownPaths(workspaceRoot: string): string[] {
  const roots = [
    path.join(workspaceRoot, "MEMORY.md"),
    path.join(workspaceRoot, "memory.md"),
    path.join(workspaceRoot, "memory"),
  ];
  const files: string[] = [];
  const walk = (current: string, depth: number) => {
    if (depth > 8 || files.length > 5000) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(full);
      }
    }
  };
  for (const candidate of roots.slice(0, 2)) {
    try {
      if (fs.statSync(candidate).isFile()) {
        files.push(candidate);
      }
    } catch {
      // missing
    }
  }
  const memoryDir = roots[2];
  try {
    if (fs.statSync(memoryDir).isDirectory()) {
      walk(memoryDir, 0);
    }
  } catch {
    // missing
  }
  return files;
}

function countMemoryMarkdown(workspaceRoot: string): number {
  return listMemoryMarkdownPaths(workspaceRoot).length;
}

function isSqliteFile(indexPath: string): boolean {
  try {
    const fd = fs.openSync(indexPath, "r");
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    return header.toString("utf8", 0, 15) === "SQLite format 3";
  } catch {
    return false;
  }
}

function readSearchableDocumentCountReadOnly(indexPath: string): number | null {
  if (!fs.existsSync(indexPath) || !isSqliteFile(indexPath)) {
    return null;
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(indexPath, { readOnly: true, allowExtension: false });
    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'files'`)
      .get() as { name?: string } | undefined;
    if (!table?.name) {
      return null;
    }
    const row = db.prepare(`SELECT COUNT(*) AS count FROM files`).get() as { count?: number };
    return typeof row?.count === "number" ? row.count : null;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

function classifyTopology(params: {
  sidecarFingerprints: string[];
  incomingFingerprint: string;
  knownConflict: boolean;
}): Pick<
  MemoryOpsStatus,
  "authority" | "rootTopology" | "topologyEvidence" | "destructiveOps" | "reasonCode" | "reason"
> {
  const { sidecarFingerprints, incomingFingerprint, knownConflict } = params;
  if (knownConflict || sidecarFingerprints.length > 1) {
    return {
      authority: sidecarFingerprints.length > 0 ? "registered" : "unknown",
      rootTopology: "multiple",
      topologyEvidence: "sidecar-fingerprints",
      destructiveOps: "denied",
      reasonCode: "topology.multiple",
      reason: "Multiple workspace fingerprints recorded in v1 sidecar",
    };
  }
  if (sidecarFingerprints.length === 0) {
    return {
      authority: "unknown",
      rootTopology: "unobserved",
      topologyEvidence: "unknown",
      destructiveOps: "maintenance-grant-required",
      reasonCode: "authority.unknown",
      reason: "No v1 root fingerprint registered",
    };
  }
  if (sidecarFingerprints[0] !== incomingFingerprint) {
    return {
      authority: "registered",
      rootTopology: "mismatch",
      topologyEvidence: "sidecar-fingerprints",
      destructiveOps: "maintenance-grant-required",
      reasonCode: "topology.mismatch",
      reason: "Registered fingerprint does not match current workspace",
    };
  }
  return {
    authority: "registered",
    rootTopology: "single",
    topologyEvidence: "sidecar-fingerprints",
    destructiveOps: "allowed",
    reasonCode: "topology.single",
    reason: "Single registered workspace fingerprint matches",
  };
}

function deriveSearchStatus(params: {
  documentCount: number | null;
  guardIndexStatus: "ok" | "unknown" | "degraded";
  memoryMdCount: number;
}): Pick<MemoryOpsStatus, "search" | "documentState" | "reasonCode"> {
  if (params.guardIndexStatus === "degraded" || params.guardIndexStatus === "unknown") {
    return {
      search: "unknown",
      documentState: "unknown",
      reasonCode:
        params.guardIndexStatus === "degraded" ? "topology.multiple" : "authority.unknown",
    };
  }
  if (params.documentCount === null) {
    return {
      search: params.memoryMdCount > 0 ? "unknown" : "empty",
      documentState: "unknown",
      reasonCode: params.memoryMdCount > 0 ? "search.unknown" : "search.empty",
    };
  }
  if (params.documentCount === 0) {
    return {
      search: "empty",
      documentState: "empty",
      reasonCode: "search.empty",
    };
  }
  return {
    search: "ready",
    documentState: "populated",
    reasonCode: "search.ready",
  };
}

export function listAgentProbeWatchPaths(input: MemoryHealthProbeAgentInput): string[] {
  const sidecarPath = sidecarPathForSqlite(input.indexPath);
  const walPath = `${input.indexPath}-wal`;
  const shmPath = `${input.indexPath}-shm`;
  return [
    input.indexPath,
    walPath,
    shmPath,
    sidecarPath,
    ...listMemoryMarkdownPaths(input.workspaceRoot),
    path.join(input.workspaceRoot, "memory"),
    path.join(input.workspaceRoot, "MEMORY.md"),
    path.join(input.workspaceRoot, "memory.md"),
  ];
}

export function probeAgentReadOnly(input: MemoryHealthProbeAgentInput): MemoryHealthProbeResult {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  let workspaceFingerprint: string;
  try {
    workspaceFingerprint = normalizeRootFingerprint(workspaceRoot);
  } catch {
    const agent: MemoryOpsStatus = {
      agentId: input.agentId,
      storage: "unknown",
      authority: "unknown",
      rootTopology: "unobserved",
      topologyEvidence: "unknown",
      destructiveOps: "maintenance-grant-required",
      search: "unknown",
      documentState: "unknown",
      searchableDocumentCount: null,
      reasonCode: "topology.unobserved",
      reason: "Workspace root could not be resolved",
      backend: input.backend ?? "unknown",
      workspaceRoot,
      workspaceFingerprint: "",
      indexPath: path.resolve(input.indexPath),
      sqliteInstanceId: "",
      sidecarFingerprintCount: 0,
      guardIndexStatus: "unknown",
      lastSyncAt: null,
      lastRebuildAt: null,
    };
    return { agent, snapshotPaths: listAgentProbeWatchPaths(input) };
  }

  const indexPath = path.resolve(input.indexPath);
  const sidecarPath = sidecarPathForSqlite(indexPath);
  const sidecar = readSidecar(sidecarPath);
  const knownConflict = isKnownConflictSqlite(indexPath);
  const guard = resolveV1RootGuardIndexStatus({
    incomingFingerprint: workspaceFingerprint,
    recordedFingerprints: sidecar.fingerprints,
    sqlitePath: indexPath,
  });
  const memoryMdCount = countMemoryMarkdown(workspaceRoot);
  const storage =
    memoryMdCount > 0 ? "ready" : memoryMdCount === 0 ? "missing" : ("unknown" as const);
  const documentCount = readSearchableDocumentCountReadOnly(indexPath);
  const topology = classifyTopology({
    sidecarFingerprints: sidecar.fingerprints,
    incomingFingerprint: workspaceFingerprint,
    knownConflict,
  });
  const search = deriveSearchStatus({
    documentCount,
    guardIndexStatus: guard.indexStatus,
    memoryMdCount,
  });

  let sqliteInstanceId = "";
  try {
    sqliteInstanceId = normalizeSqliteInstanceId(indexPath);
  } catch {
    sqliteInstanceId = "";
  }

  const storageReasonCode = storage === "ready" ? "storage.ready" : "storage.missing";

  const agent: MemoryOpsStatus = {
    agentId: input.agentId,
    storage,
    ...topology,
    ...search,
    reasonCode: search.reasonCode === "search.ready" ? storageReasonCode : search.reasonCode,
    reason:
      search.reasonCode === "search.ready"
        ? storage === "ready"
          ? "Memory markdown and index probe completed"
          : "No memory markdown files at workspace"
        : topology.reason,
    backend: input.backend ?? "builtin",
    searchableDocumentCount: documentCount,
    workspaceRoot,
    workspaceFingerprint,
    indexPath,
    sqliteInstanceId,
    sidecarFingerprintCount: sidecar.fingerprints.length,
    guardIndexStatus: guard.indexStatus,
    guardReason: guard.reason,
    lastSyncAt: null,
    lastRebuildAt: null,
    fields: {
      storage: "existing",
      authority: "derived",
      rootTopology: "derived",
      searchableDocumentCount: "derived",
      lastSyncAt: "unknown",
      lastRebuildAt: "unknown",
    },
  };

  return {
    agent,
    snapshotPaths: listAgentProbeWatchPaths({ ...input, workspaceRoot, indexPath }),
  };
}

export function createMemoryHealthProbe(): MemoryHealthProbe {
  return {
    probeAgent: probeAgentReadOnly,
    collectSnapshot: collectProbeSnapshotPaths,
    async runIntegrityCheck(paths, fn) {
      const before = collectProbeSnapshotPaths(paths);
      const preSnapshotHash = hashProbeSnapshot(before);
      await fn();
      const after = collectProbeSnapshotPaths(paths);
      const postSnapshotHash = hashProbeSnapshot(after);
      const diff = diffProbeSnapshots(before, after);
      return {
        preSnapshotHash,
        postSnapshotHash,
        mutationsDetected: diff.mutationsDetected,
        changedPaths: diff.changedPaths.length > 0 ? diff.changedPaths : undefined,
      };
    },
  };
}

/** Test helper: module identity hash for build-info alignment. */
export function probeModuleShaFromSource(source: string): string {
  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
}

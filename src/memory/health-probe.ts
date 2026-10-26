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
  configuredBackend?: string;
  /** CogniWeave mode when configuredBackend is cogniweave. */
  cogniweaveMode?: "embedded" | "rest";
  /**
   * When true, searchableDocumentCount was derived from a trusted complete scope
   * (workspaceId+projectId+agentId+visibility). Otherwise leave count null.
   */
  scopeCountTrusted?: boolean;
  /** Optional per-agent scoped document count when scopeCountTrusted. */
  scopedDocumentCount?: number | null;
  /** QMD collection roots for read-only existence checks (qmd backend only). */
  qmdCollectionPaths?: string[];
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

function readSqliteTableCountReadOnly(indexPath: string, tableName: string): number | null {
  if (!fs.existsSync(indexPath) || !isSqliteFile(indexPath)) {
    return null;
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(indexPath, { readOnly: true, allowExtension: false });
    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(tableName) as { name?: string } | undefined;
    if (!table?.name) {
      return null;
    }
    // tableName is a fixed literal from callers — never interpolate user input into SQL idents.
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
      count?: number;
    };
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

function detectObservedBackend(indexPath: string): string {
  if (!fs.existsSync(indexPath) || !isSqliteFile(indexPath)) {
    return "unknown";
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(indexPath, { readOnly: true, allowExtension: false });
    const names = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{
      name?: string;
    }>;
    const set = new Set(names.map((row) => row.name).filter(Boolean));
    if (set.has("cogniweave_atoms") || set.has("cogniweave_events")) {
      return "cogniweave";
    }
    if (set.has("files")) {
      return "builtin";
    }
    return "unknown";
  } catch {
    return "unknown";
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
  /** When false, never report search=ready (storage readable ≠ retrieval proven). */
  retrievalEvidence?: boolean;
  /**
   * When true, null documentCount means scope/count unresolved → search stays unknown
   * (do not infer empty from missing scoped evidence).
   */
  countUnresolvedMeansUnknown?: boolean;
}): Pick<MemoryOpsStatus, "search" | "documentState" | "reasonCode"> {
  const documentStateFromCount =
    params.documentCount === null ? "unknown" : params.documentCount === 0 ? "empty" : "populated";

  if (params.documentCount === null) {
    if (params.guardIndexStatus === "degraded") {
      return { search: "unknown", documentState: "unknown", reasonCode: "topology.multiple" };
    }
    if (params.countUnresolvedMeansUnknown) {
      return {
        search: "unknown",
        documentState: "unknown",
        reasonCode: "search.scope-unresolved",
      };
    }
    return {
      search: params.memoryMdCount > 0 ? "unknown" : "empty",
      documentState: "unknown",
      reasonCode:
        params.guardIndexStatus === "unknown"
          ? "authority.unknown"
          : params.memoryMdCount > 0
            ? "search.unknown"
            : "search.empty",
    };
  }
  if (params.documentCount === 0) {
    return {
      search: "empty",
      documentState: "empty",
      reasonCode: "search.empty",
    };
  }
  // Storage readable with rows: documentState populated, but search stays unknown without retrieval evidence.
  if (!params.retrievalEvidence || params.guardIndexStatus !== "ok") {
    return {
      search: "unknown",
      documentState: documentStateFromCount,
      reasonCode:
        params.guardIndexStatus === "degraded"
          ? "topology.multiple"
          : params.guardIndexStatus === "unknown"
            ? "search.storage-readable-only"
            : "search.storage-readable-only",
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
      configuredBackend: input.configuredBackend ?? input.backend ?? "unknown",
      observedBackend: "unknown",
      probeExecution: "ok",
      backendHealth: "unknown",
      retrievalStatus: "unknown",
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
  const configuredBackend = input.configuredBackend ?? input.backend ?? "unknown";
  const observedBackend = detectObservedBackend(indexPath);

  const cogniweaveMode = input.cogniweaveMode ?? "embedded";
  let documentCount: number | null = null;
  let storage: MemoryOpsStatus["storage"] = "unknown";
  let storageReadableOnly = false;
  if (configuredBackend === "cogniweave") {
    // REST mode does not require a local canonical.sqlite — missing file is not unhealthy.
    if (cogniweaveMode === "rest") {
      documentCount = null;
      storage = fs.existsSync(indexPath) && isSqliteFile(indexPath) ? "ready" : "unknown";
      storageReadableOnly = storage === "ready";
    } else {
      // Embedded: report storage independently; never assign full-DB atom totals per agent.
      const atomCount = readSqliteTableCountReadOnly(indexPath, "cogniweave_atoms");
      if (!fs.existsSync(indexPath)) {
        storage = "missing";
        documentCount = null;
      } else if (atomCount === null) {
        storage = isSqliteFile(indexPath) ? "unknown" : "missing";
        documentCount = null;
      } else {
        storage = "ready";
        storageReadableOnly = true;
        // Only fill searchableDocumentCount when caller supplied a trusted complete scope count.
        // Full-library atom totals must never be attributed to each digital human.
        if (input.scopeCountTrusted === true && typeof input.scopedDocumentCount === "number") {
          documentCount = input.scopedDocumentCount;
        } else {
          documentCount = null;
        }
      }
    }
  } else if (configuredBackend === "qmd") {
    const collections = input.qmdCollectionPaths ?? [];
    const existing = collections.filter((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
    // Collection path existence proves source path only — not QMD backend/index health.
    documentCount = null;
    if (collections.length === 0) {
      storage = "unknown";
    } else if (existing.length > 0) {
      storage = "ready";
      storageReadableOnly = true;
    } else {
      storage = "missing";
    }
  } else {
    // builtin / unknown: legacy markdown + files table probe
    storage = memoryMdCount > 0 ? "ready" : memoryMdCount === 0 ? "missing" : ("unknown" as const);
    documentCount = readSearchableDocumentCountReadOnly(indexPath);
  }

  const topology = classifyTopology({
    sidecarFingerprints: sidecar.fingerprints,
    incomingFingerprint: workspaceFingerprint,
    knownConflict,
  });
  // Read-only health probe never executes retrieval — keep search unknown when only storage is proven.
  const search = deriveSearchStatus({
    documentCount,
    guardIndexStatus: configuredBackend === "builtin" ? guard.indexStatus : "ok",
    memoryMdCount,
    retrievalEvidence: false,
    countUnresolvedMeansUnknown: configuredBackend === "cogniweave" || configuredBackend === "qmd",
  });

  let sqliteInstanceId = "";
  try {
    sqliteInstanceId = normalizeSqliteInstanceId(indexPath);
  } catch {
    sqliteInstanceId = "";
  }

  const backendMismatch =
    observedBackend !== "unknown" &&
    configuredBackend !== "unknown" &&
    observedBackend !== configuredBackend;

  // Storage readability is reported independently and must NOT alone force backendHealth=healthy.
  // Keep unknown when scope/freshness/retrieval evidence is missing.
  let backendHealth: NonNullable<MemoryOpsStatus["backendHealth"]> = "unknown";
  if (configuredBackend === "unknown" && observedBackend === "unknown") {
    backendHealth = "unknown";
  } else if (configuredBackend === "cogniweave" && cogniweaveMode === "rest") {
    // Local sqlite absence is expected/irrelevant for REST diagnostics.
    backendHealth = backendMismatch ? "degraded" : "unknown";
  } else if (configuredBackend === "qmd") {
    // Path existence ≠ QMD index health.
    backendHealth = backendMismatch ? "degraded" : "unknown";
  } else if (
    storage === "missing" &&
    configuredBackend === "cogniweave" &&
    cogniweaveMode === "embedded"
  ) {
    backendHealth = "unhealthy";
  } else if (backendMismatch) {
    backendHealth = "degraded";
  } else if (storageReadableOnly || storage === "ready") {
    backendHealth = "unknown";
  } else {
    backendHealth = "unknown";
  }

  const reportedBackend =
    observedBackend !== "unknown"
      ? observedBackend
      : configuredBackend !== "unknown"
        ? configuredBackend
        : "unknown";

  const agent: MemoryOpsStatus = {
    agentId: input.agentId,
    storage,
    ...topology,
    ...search,
    reasonCode: backendMismatch
      ? "backend.mismatch"
      : search.reasonCode === "search.storage-readable-only"
        ? "storage.readable"
        : search.reasonCode === "search.ready"
          ? storage === "ready"
            ? "storage.ready"
            : "storage.missing"
          : search.reasonCode,
    reason: backendMismatch
      ? `Configured backend ${configuredBackend} differs from observed store ${observedBackend}`
      : search.reasonCode === "search.storage-readable-only"
        ? "Storage readable; retrieval not verified by this probe"
        : search.reasonCode === "search.ready"
          ? storage === "ready"
            ? "Memory markdown and index probe completed"
            : "No memory markdown files at workspace"
          : topology.reason,
    backend: reportedBackend,
    configuredBackend,
    observedBackend,
    probeExecution: "ok",
    backendHealth,
    retrievalStatus: "unknown",
    searchableDocumentCount: documentCount,
    workspaceRoot,
    workspaceFingerprint,
    indexPath,
    sqliteInstanceId,
    sidecarFingerprintCount: sidecar.fingerprints.length,
    guardIndexStatus: guard.indexStatus,
    guardReason: guard.reason,
    // Freshness: do not infer from sqlite mtime alone.
    lastSyncAt: null,
    lastRebuildAt: null,
    fields: {
      storage: "existing",
      authority: "derived",
      rootTopology: "derived",
      searchableDocumentCount: "derived",
      lastSyncAt: "unknown",
      lastRebuildAt: "unknown",
      configuredBackend: "derived",
      observedBackend: "derived",
      probeExecution: "derived",
      backendHealth: "derived",
      retrievalStatus: "unknown",
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

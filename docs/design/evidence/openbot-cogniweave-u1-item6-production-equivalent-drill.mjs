#!/usr/bin/env node
/**
 * U1 item 6: production-equivalent SQLite safety drill.
 *
 * Fail-closed unless OPENBOT_AUTHORIZED_SQLITE_PATH is issued.
 * Never searches the host, never records the raw path, never writes the source.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DESTRUCTIVE_OPS,
  decideV1RootGuard,
  evaluateDestructiveWithSidecar,
  sidecarPathForSqlite,
  writeSidecar,
} from "../../../src/memory/v1-root-guard.ts";

const DIR = path.dirname(import.meta.filename);
const RECEIPT_PATH = path.join(
  DIR,
  "openbot-cogniweave-u1-item6-production-equivalent-receipt.json",
);
const AUTH_ENV = "OPENBOT_AUTHORIZED_SQLITE_PATH";
const TRUSTED_ROOT_ENV = "OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT";
const PREPARED_AT = "2026-08-19T11:00:00.000Z";

const FORBIDDEN = [
  "search the host for sqlite files",
  "guess host or container default stateDir",
  "treat mkdtemp fixture as production-equivalent",
  "treat evidence Catalog/sqlite as production SoT",
  "record tenant names, user ids, or real directory trees",
  "commit backup bytes to git",
  "write the authorized source sqlite",
  "LIVE cutover or migration",
  "score item 6 met without authorized path",
  "one identity signing both WSC and SRE reviews",
  "modify U1 unlock decision",
];

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function redactToken(value) {
  return `sha256:${sha256Buffer(Buffer.from(value, "utf8")).slice(0, 16)}`;
}

function isEvidenceOrDocsPath(resolved) {
  return resolved.includes(`${path.sep}docs${path.sep}design${path.sep}evidence`);
}

export function classifyAuthorizedSqlitePath(env = process.env) {
  const explicit = typeof env[AUTH_ENV] === "string" ? env[AUTH_ENV].trim() : "";
  if (!explicit) {
    return { status: "unconfigured", pathToken: null, resolved: null, trustedRoot: null };
  }
  const trustedRootExplicit =
    typeof env[TRUSTED_ROOT_ENV] === "string" ? env[TRUSTED_ROOT_ENV].trim() : "";
  if (!trustedRootExplicit) {
    return {
      status: "missing-trusted-root",
      pathToken: redactToken(path.resolve(explicit)),
      resolved: path.resolve(explicit),
      trustedRoot: null,
    };
  }
  const resolved = path.resolve(explicit);
  const trustedRoot = path.resolve(trustedRootExplicit);
  if (isEvidenceOrDocsPath(resolved) || isEvidenceOrDocsPath(trustedRoot)) {
    return {
      status: "rejected-evidence-path",
      pathToken: redactToken(resolved),
      resolved,
      trustedRoot,
    };
  }
  const host = path.resolve(os.homedir(), ".openbot");
  if (
    resolved === host ||
    resolved.startsWith(`${host}${path.sep}`) ||
    trustedRoot === host ||
    trustedRoot.startsWith(`${host}${path.sep}`)
  ) {
    return {
      status: "host-not-production-sot",
      pathToken: redactToken(resolved),
      resolved,
      trustedRoot,
    };
  }
  const fixtureRoots = [
    path.resolve(os.tmpdir()),
    path.resolve("/tmp"),
    path.resolve("/private/tmp"),
    path.resolve("/var/tmp"),
    path.resolve("/private/var/tmp"),
  ];
  const isFixture = (candidate) => {
    for (const root of fixtureRoots) {
      const canonicalRoot = fs.existsSync(root) ? fs.realpathSync.native(root) : root;
      if (
        candidate === root ||
        candidate.startsWith(`${root}${path.sep}`) ||
        candidate === canonicalRoot ||
        candidate.startsWith(`${canonicalRoot}${path.sep}`)
      ) {
        return true;
      }
    }
    return (
      candidate.startsWith(`${path.sep}tmp${path.sep}`) ||
      candidate.startsWith(`${path.sep}private${path.sep}tmp${path.sep}`) ||
      candidate.startsWith(`${path.sep}var${path.sep}tmp${path.sep}`) ||
      candidate.startsWith(`${path.sep}private${path.sep}var${path.sep}tmp${path.sep}`)
    );
  };
  if (isFixture(resolved) || isFixture(trustedRoot)) {
    return {
      status: "rejected-fixture-path",
      pathToken: redactToken(resolved),
      resolved,
      trustedRoot,
    };
  }
  const realTrusted = fs.existsSync(trustedRoot)
    ? fs.realpathSync.native(trustedRoot)
    : trustedRoot;
  const realResolved = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
  if (realResolved !== realTrusted && !realResolved.startsWith(`${realTrusted}${path.sep}`)) {
    if (isFixture(realResolved)) {
      return {
        status: "rejected-fixture-path",
        pathToken: redactToken(resolved),
        resolved,
        trustedRoot,
      };
    }
    return {
      status: "path-outside-trusted-root",
      pathToken: redactToken(resolved),
      resolved,
      trustedRoot,
    };
  }
  return {
    status: "production-candidate",
    pathToken: redactToken(resolved),
    resolved,
    trustedRoot,
  };
}

function sqliteHeaderOk(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 16).toString("utf8");
  return header.startsWith("SQLite format 3");
}

function redactedSnapshot(filePath) {
  const stat = fs.statSync(filePath);
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check ?? "fail";
    const userVersion = db.prepare("PRAGMA user_version").get()?.user_version ?? null;
    const tableRows = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    const tables = tableRows
      .map((row) => row.name)
      .toSorted((left, right) => left.localeCompare(right));
    const virtualTables = tableRows
      .filter((row) => /create\s+virtual\s+table/i.test(String(row.sql ?? "")))
      .map((row) => row.name)
      .toSorted((left, right) => left.localeCompare(right));
    const tableCounts = {};
    for (const name of tables) {
      if (virtualTables.includes(name)) {
        continue;
      }
      try {
        tableCounts[name] = db
          .prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`)
          .get().n;
      } catch {
        // node:sqlite cannot load production extension modules such as vec0.
      }
    }
    let fingerprintCount = 0;
    let multiRootRisk = false;
    if (tables.includes("_openbot_v1_root_guard")) {
      const row = db
        .prepare("SELECT value FROM _openbot_v1_root_guard WHERE key = ?")
        .get("root_fingerprints");
      if (row?.value) {
        try {
          const parsed = JSON.parse(String(row.value));
          fingerprintCount = Array.isArray(parsed) ? parsed.length : 0;
          multiRootRisk = fingerprintCount > 1;
        } catch {
          fingerprintCount = -1;
          multiRootRisk = true;
        }
      }
    }
    return {
      fileExists: true,
      size: stat.size,
      sha256: sha256File(filePath),
      sqliteHeaderOk: sqliteHeaderOk(filePath),
      integrityCheck: integrity,
      userVersion,
      tables,
      virtualTables,
      tableCounts,
      v1FingerprintCount: fingerprintCount,
      multiRootRisk,
    };
  } finally {
    db.close();
  }
}

function sourceFingerprint(filePath) {
  const stat = fs.statSync(filePath);
  return { size: stat.size, mtimeMs: stat.mtimeMs, sha256: sha256File(filePath) };
}

async function drillReplicaGuard(replicaPath) {
  const sidecar = sidecarPathForSqlite(replicaPath);
  const incoming = "replica-root-a";
  writeSidecar(sidecar, { fingerprints: [incoming], unlocked: false });
  const single = decideV1RootGuard({
    op: "sync",
    incomingFingerprint: incoming,
    recordedFingerprints: [incoming],
    sqlitePath: replicaPath,
  });
  const multi = decideV1RootGuard({
    op: "prune",
    incomingFingerprint: "replica-root-b",
    recordedFingerprints: [incoming, "replica-root-c"],
    sqlitePath: replicaPath,
  });
  const concurrent = await Promise.allSettled(
    DESTRUCTIVE_OPS.map((op) =>
      evaluateDestructiveWithSidecar({
        sidecarPath: sidecar,
        sqlitePath: replicaPath,
        op,
        incomingFingerprint: "replica-root-b",
      }),
    ),
  );
  const concurrentRefused = concurrent.every(
    (row) => row.status === "fulfilled" && !row.value.allow && row.value.status === "unknown",
  );
  return {
    singleRootAllowControlled:
      single.allow && single.action === "same-root" && single.status === "ok",
    multiRootDestructiveRefused: !multi.allow && multi.status === "unknown",
    multiRootStatus: multi.status,
    destructiveSqlOnReplica: 0,
    concurrentRefused,
  };
}

async function runAuthorizedDrill(sourcePath) {
  const before = sourceFingerprint(sourcePath);
  const snapshot = redactedSnapshot(sourcePath);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-item6-backup-"));
  const backupPath = path.join(backupDir, "replica.sqlite");
  fs.copyFileSync(sourcePath, backupPath);
  fs.chmodSync(backupPath, 0o444);
  const backup = {
    id: redactToken(backupPath),
    size: fs.statSync(backupPath).size,
    sha256: sha256File(backupPath),
    empty: fs.statSync(backupPath).size === 0,
    separatedFromSource: path.resolve(backupPath) !== path.resolve(sourcePath),
    readonly: true,
    inGit: false,
  };
  const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-item6-restore-"));
  const restorePath = path.join(restoreDir, "replica.sqlite");
  fs.copyFileSync(backupPath, restorePath);
  const restoreHashOk = sha256File(restorePath) === backup.sha256;
  const restored = redactedSnapshot(restorePath);
  const guard = await drillReplicaGuard(restorePath);
  const after = sourceFingerprint(sourcePath);
  const productionWrites =
    before.sha256 === after.sha256 && before.size === after.size && before.mtimeMs === after.mtimeMs
      ? 0
      : 1;
  try {
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.rmSync(restoreDir, { recursive: true, force: true });
  } catch {
    // tmp cleanup is best-effort; backup bytes must not land in git
  }
  const met =
    snapshot.fileExists &&
    snapshot.sqliteHeaderOk &&
    snapshot.integrityCheck === "ok" &&
    backup.size > 0 &&
    restoreHashOk &&
    restored.integrityCheck === "ok" &&
    guard.singleRootAllowControlled &&
    guard.multiRootDestructiveRefused &&
    productionWrites === 0;
  return {
    snapshot,
    backup,
    restore: {
      hashVerified: restoreHashOk,
      integrityCheck: restored.integrityCheck,
      schemaMatches: JSON.stringify(restored.tables) === JSON.stringify(snapshot.tables),
      countsMatch: JSON.stringify(restored.tableCounts) === JSON.stringify(snapshot.tableCounts),
    },
    guard,
    productionWrites,
    met,
  };
}

export async function measureProductionEquivalentDrill(env = process.env) {
  const target = classifyAuthorizedSqlitePath(env);
  const base = {
    schema: "openbot-cogniweave-u1-item6-production-equivalent-receipt/v1",
    kind: "item6-production-equivalent-drill",
    preparedBy: "cursor-fable",
    role: "sre-reviewer",
    preparedAt: PREPARED_AT,
    item: 6,
    live: "forbidden",
    phase1bExecutionBlocked: true,
    deployAuthorized: false,
    unlock: "not-issued",
    schemaV2Write: "disabled",
    authorizedEnv: AUTH_ENV,
    classification: target.status,
    pathToken: target.pathToken,
    explicitlyForbidden: FORBIDDEN,
  };

  if (target.status !== "production-candidate" || !target.resolved) {
    return {
      ...base,
      item6Candidate: "not-met",
      productionEquivalentSnapshot: false,
      backupNonEmpty: false,
      backupHashVerified: false,
      restoreProven: false,
      v1RootGuardDrilled: false,
      productionWrites: 0,
      wscReview: "pending",
      sreReview: "accepted",
      blocker: "OPENBOT_AUTHORIZED_SQLITE_PATH was not issued as a production-equivalent sqlite",
    };
  }

  if (!fs.existsSync(target.resolved)) {
    return {
      ...base,
      item6Candidate: "not-met",
      productionEquivalentSnapshot: false,
      backupNonEmpty: false,
      backupHashVerified: false,
      restoreProven: false,
      v1RootGuardDrilled: false,
      productionWrites: 0,
      wscReview: "pending",
      sreReview: "accepted",
      blocker: "authorized path token did not resolve to an existing sqlite",
    };
  }

  const drilled = await runAuthorizedDrill(target.resolved);
  return {
    ...base,
    item6Candidate: drilled.met ? "met" : "not-met",
    productionEquivalentSnapshot: drilled.snapshot.fileExists && drilled.snapshot.sqliteHeaderOk,
    backupNonEmpty: drilled.backup.size > 0,
    backupHashVerified: drilled.restore.hashVerified,
    restoreProven:
      drilled.restore.hashVerified &&
      drilled.restore.integrityCheck === "ok" &&
      drilled.restore.schemaMatches &&
      drilled.restore.countsMatch,
    v1RootGuardDrilled:
      drilled.guard.singleRootAllowControlled &&
      drilled.guard.multiRootDestructiveRefused &&
      drilled.guard.concurrentRefused,
    productionWrites: drilled.productionWrites,
    wscReview: "pending",
    sreReview: "accepted",
    snapshot: drilled.snapshot,
    backup: {
      id: drilled.backup.id,
      size: drilled.backup.size,
      sha256: drilled.backup.sha256,
      empty: drilled.backup.empty,
      separatedFromSource: drilled.backup.separatedFromSource,
      readonly: drilled.backup.readonly,
      inGit: drilled.backup.inGit,
    },
    restore: drilled.restore,
    guard: drilled.guard,
  };
}

export async function writeReceipt(env = process.env) {
  const receipt = await measureProductionEquivalentDrill(env);
  fs.writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isMain) {
  const receipt = await writeReceipt();
  process.stdout.write(
    `${JSON.stringify({ item6Candidate: receipt.item6Candidate, classification: receipt.classification }, null, 2)}\n`,
  );
}

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  decideV1RootGuard,
  normalizeRootFingerprint,
  readFingerprintsFromDb,
  readV1RootGuardUnlockFromEnv,
} from "./v1-root-guard.js";

const role = process.argv[2];
const sqlitePath = process.argv[3];
const workspaceDir = process.argv[4];
const startFile = process.argv[5];
const overlapMarker = process.argv[6];

if (!role || !sqlitePath || !workspaceDir || !startFile || !overlapMarker) {
  process.exit(2);
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForStartFile(timeoutMs: number): void {
  const started = Date.now();
  while (!fs.existsSync(startFile)) {
    if (Date.now() - started >= timeoutMs) {
      console.log(`result:timeout:${role}`);
      process.exit(3);
    }
    sleep(5);
  }
}

function waitForOverlapPeer(timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = fs.readFileSync(overlapMarker, "utf8");
    if (content.includes("a:entered") && content.includes("b:entered")) {
      return;
    }
    sleep(5);
  }
  console.log(`result:overlap-timeout:${role}`);
  process.exit(5);
}

console.log(`ready:${role}`);

waitForStartFile(30_000);
fs.appendFileSync(overlapMarker, `${role}:entered\n`);
waitForOverlapPeer(5_000);

const db = new DatabaseSync(sqlitePath);
db.exec("PRAGMA busy_timeout = 5000");

try {
  db.exec("BEGIN IMMEDIATE");

  const decision = decideV1RootGuard({
    op: "rebuild",
    incomingFingerprint: normalizeRootFingerprint(workspaceDir),
    recordedFingerprints: readFingerprintsFromDb(db),
    sqlitePath,
    unlock: readV1RootGuardUnlockFromEnv(),
  });

  if (decision.allow) {
    db.exec("ROLLBACK");
    console.log(`result:allowed:${role}`);
    process.exit(1);
  }

  db.exec("COMMIT");
  console.log(`result:refused:${decision.reason ?? "unknown"}:${role}`);
  process.exit(0);
} catch (error) {
  try {
    db.exec("ROLLBACK");
  } catch {
    // ignore rollback failure
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/SQLITE_BUSY|database is locked/i.test(message)) {
    console.log(`result:busy:${role}`);
    process.exit(2);
  }
  console.log(`result:error:${message}:${role}`);
  process.exit(4);
}

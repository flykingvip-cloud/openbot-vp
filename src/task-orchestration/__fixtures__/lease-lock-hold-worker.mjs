/**
 * Hold a raw lease .lock file (alive PID), optionally backdated, then
 * ownership-safe release. Uses the same companion+hardlink publish protocol
 * as lease-file-lock.ts. Modes via env:
 * - OPENBOT_LEASE_LOCK_CRASH=1 → exit without release
 * - OPENBOT_LEASE_LOCK_RELEASE_AFTER_REPLACE=1 → wait for signal file, then release-if-owned
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const lockPath = process.env.OPENBOT_LEASE_LOCK_PATH;
const holdMs = Number.parseInt(process.env.OPENBOT_LEASE_LOCK_HOLD_MS ?? "35000", 10);
const createdAtOffsetMs = Number.parseInt(
  process.env.OPENBOT_LEASE_LOCK_CREATED_AT_OFFSET_MS ?? "0",
  10,
);
const crash = process.env.OPENBOT_LEASE_LOCK_CRASH === "1";
const releaseAfterReplace = process.env.OPENBOT_LEASE_LOCK_RELEASE_AFTER_REPLACE === "1";

if (!lockPath) {
  console.error("worker-misconfigured");
  process.exit(2);
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tokenFileSafe(ownerToken) {
  return ownerToken.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function ownerCompanionPath(lockPath, ownerToken) {
  return `${lockPath}.owner.${tokenFileSafe(ownerToken)}`;
}

function releaseOwned(lockPath, ownerToken) {
  const companion = ownerCompanionPath(lockPath, ownerToken);
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.ownerToken !== ownerToken) {
      console.log(`lock-release-skipped:${parsed?.ownerToken ?? "missing"}`);
      return;
    }
  } catch (err) {
    console.log(`lock-release-error:${err?.code ?? "unknown"}`);
    try {
      fs.unlinkSync(companion);
    } catch {
      // ignore
    }
    return;
  }

  // Companion-claim release: rename companion → tomb, unlink public only if same inode.
  const tomb = `${companion}.reclaimed.${randomUUID()}`;
  try {
    if (fs.existsSync(companion)) {
      fs.renameSync(companion, tomb);
    } else {
      // Legacy single-file: only unlink public when token still matches.
      fs.unlinkSync(lockPath);
      console.log("lock-released:own");
      return;
    }
  } catch (err) {
    console.log(`lock-release-error:${err?.code ?? "unknown"}`);
    return;
  }

  try {
    const claimed = JSON.parse(fs.readFileSync(tomb, "utf8"));
    if (claimed?.ownerToken !== ownerToken) {
      try {
        fs.renameSync(tomb, companion);
      } catch {
        // ignore
      }
      console.log(`lock-release-skipped:${claimed?.ownerToken ?? "missing"}`);
      return;
    }
    try {
      const stT = fs.statSync(tomb);
      const stL = fs.statSync(lockPath);
      if (stT.dev === stL.dev && stT.ino === stL.ino) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // public already gone
    }
    try {
      fs.unlinkSync(tomb);
    } catch {
      // ignore
    }
    console.log("lock-released:own");
  } catch (err) {
    console.log(`lock-release-error:${err?.code ?? "unknown"}`);
  }
}

fs.mkdirSync(path.dirname(lockPath), { recursive: true });

const ownerToken = randomUUID();
const createdAt = new Date(Date.now() - Math.max(0, createdAtOffsetMs)).toISOString();
const companion = ownerCompanionPath(lockPath, ownerToken);
const payload = JSON.stringify({ pid: process.pid, createdAt, ownerToken }, null, 2) + "\n";

const fd = fs.openSync(companion, "wx");
fs.writeFileSync(fd, payload, "utf8");
fs.closeSync(fd);
try {
  fs.linkSync(companion, lockPath);
} catch (err) {
  try {
    fs.unlinkSync(companion);
  } catch {
    // ignore
  }
  console.error(`lock-publish-failed:${err?.code ?? "unknown"}`);
  process.exit(3);
}
console.log(`lock-held:${ownerToken}:${process.pid}`);

if (crash) {
  process.exit(0);
}

if (releaseAfterReplace) {
  const signalPath = `${lockPath}.release-signal`;
  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(signalPath) && Date.now() < deadline) {
    sleepMs(25);
  }
  releaseOwned(lockPath, ownerToken);
  process.exit(0);
}

const sleepDeadline = Date.now() + holdMs;
while (Date.now() < sleepDeadline) {
  sleepMs(50);
}

releaseOwned(lockPath, ownerToken);

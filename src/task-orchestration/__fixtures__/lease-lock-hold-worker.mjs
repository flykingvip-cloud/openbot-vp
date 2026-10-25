/**
 * Hold a raw lease .lock file (alive PID), optionally backdated, then
 * ownership-safe release. Modes via env:
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

fs.mkdirSync(path.dirname(lockPath), { recursive: true });

const ownerToken = randomUUID();
const createdAt = new Date(Date.now() - Math.max(0, createdAtOffsetMs)).toISOString();
const fd = fs.openSync(lockPath, "wx");
fs.writeFileSync(
  fd,
  `${JSON.stringify({ pid: process.pid, createdAt, ownerToken }, null, 2)}\n`,
  "utf8",
);
console.log(`lock-held:${ownerToken}:${process.pid}`);

if (crash) {
  try {
    fs.closeSync(fd);
  } catch {
    // ignore
  }
  process.exit(0);
}

if (releaseAfterReplace) {
  const signalPath = `${lockPath}.release-signal`;
  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(signalPath) && Date.now() < deadline) {
    sleepMs(25);
  }
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.ownerToken === ownerToken) {
      fs.unlinkSync(lockPath);
      console.log("lock-released:own");
    } else {
      console.log(`lock-release-skipped:${parsed?.ownerToken ?? "missing"}`);
    }
  } catch (err) {
    console.log(`lock-release-error:${err?.code ?? "unknown"}`);
  }
  try {
    fs.closeSync(fd);
  } catch {
    // ignore
  }
  process.exit(0);
}

const sleepDeadline = Date.now() + holdMs;
while (Date.now() < sleepDeadline) {
  sleepMs(50);
}

try {
  const raw = fs.readFileSync(lockPath, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed?.ownerToken === ownerToken) {
    fs.unlinkSync(lockPath);
    console.log("lock-released:own");
  } else {
    console.log(`lock-release-skipped:${parsed?.ownerToken ?? "missing"}`);
  }
} catch {
  console.log("lock-release-missing");
}
try {
  fs.closeSync(fd);
} catch {
  // ignore
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireFileLockSync } from "../../../src/plugin-sdk/file-lock.js";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reaper-probe-"));
const file = path.join(fs.realpathSync(dir), "state");
const lock = file + ".lock";
fs.writeFileSync(lock, JSON.stringify({ pid: 2147483647, createdAt: new Date(0).toISOString() }));
const original = fs.rmSync;
let replaced = false;
fs.rmSync = ((target, ...args) => {
  if (String(target) === lock && !replaced) {
    replaced = true;
    // Peer removes the dead lock and acquires a new live lock after stale inspection.
    original(lock, { force: true });
    fs.writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), peer: true }),
    );
  }
  return original(target, ...args);
}) as typeof fs.rmSync;
try {
  const held = acquireFileLockSync(file, {
    retries: { retries: 1, factor: 1, minTimeout: 1, maxTimeout: 1 },
    stale: 1,
  });
  console.log(
    JSON.stringify({
      replacementInjected: replaced,
      acquiredOverLivePeer: !fs.readFileSync(lock, "utf8").includes("peer"),
    }),
  );
  held.release();
} finally {
  fs.rmSync = original;
  fs.rmSync(dir, { recursive: true, force: true });
}

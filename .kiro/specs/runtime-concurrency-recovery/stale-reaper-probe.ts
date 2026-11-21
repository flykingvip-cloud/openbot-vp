/** Run with Node/tsx. All simulated participants use the upgraded arbitration protocol. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireFileLock, acquireFileLockSync } from "../../../src/plugin-sdk/file-lock.js";

for (const mode of ["sync", "async"] as const) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reaper-probe-"));
  const file = path.join(fs.realpathSync(dir), "state");
  const lock = `${file}.lock`;
  const options = { retries: { retries: 0, factor: 1, minTimeout: 1, maxTimeout: 1 }, stale: 1 };
  fs.writeFileSync(lock, JSON.stringify({ pid: 2147483647, createdAt: new Date(0).toISOString() }));
  const original = fs.rmSync;
  let checked = false;
  fs.rmSync = ((target, settings) => {
    if (String(target) === lock && !checked) {
      checked = true;
      assert.throws(() => acquireFileLockSync(file, options), /timeout/);
    }
    return original(target, settings);
  }) as typeof fs.rmSync;
  try {
    if (mode === "sync") {
      const held = acquireFileLockSync(file, options);
      assert.equal(checked, true);
      held.release();
    } else {
      const held = await acquireFileLock(file, options);
      assert.equal(checked, true);
      await held.release();
    }
    console.log(
      JSON.stringify({
        mode,
        staleUnlinkWindowChecked: checked,
        cooperatingReplacementBlocked: true,
      }),
    );
  } finally {
    fs.rmSync = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

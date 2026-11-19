import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { tryWithFileLockArbitration } from "./file-lock-arbitration.js";
import { acquireFileLock, acquireFileLockSync } from "./file-lock.js";

it.each([
  ["resume", false],
  ["kill", false],
  ["kill", true],
] as const)(
  "a paused reclaimer safely recovers on %s (public lock removed: %s)",
  async (mode, removed) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reclaimer-barrier-"));
    const file = path.join(fs.realpathSync(dir), "state");
    const lock = `${file}.lock`;
    fs.writeFileSync(
      lock,
      JSON.stringify({ pid: 2147483647, createdAt: new Date(0).toISOString() }),
    );
    const options = { retries: { retries: 0, factor: 1, minTimeout: 1, maxTimeout: 1 }, stale: 1 };
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
    import fs from 'node:fs';
    import { tryWithFileLockArbitration } from './src/plugin-sdk/file-lock-arbitration.ts';
    tryWithFileLockArbitration(process.env.LOCK_PATH, () => {
      if (process.env.REMOVE_FIRST === 'true') fs.rmSync(process.env.LOCK_PATH, {force: true});
      fs.writeSync(1, 'reclaiming');
      while (!fs.existsSync(process.env.LOCK_PATH + '.resume')) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      fs.rmSync(process.env.LOCK_PATH, {force: true});
    });
  `,
      ],
      {
        env: { ...process.env, LOCK_PATH: lock, REMOVE_FIRST: String(removed) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const closed = once(child, "close");
    try {
      const ready = once(child.stdout, "data").then(([data]) => String(data));
      expect(await Promise.race([ready, closed.then(() => "early exit")])).toBe("reclaiming");
      child.kill("SIGSTOP");
      expect(() => acquireFileLockSync(file, options)).toThrow(/timeout/);
      await expect(acquireFileLock(file, options)).rejects.toThrow(/timeout/);
      expect(fs.existsSync(lock)).toBe(!removed);
      if (mode === "resume") {
        fs.writeFileSync(`${lock}.resume`, "");
        child.kill("SIGCONT");
      } else {
        child.kill("SIGKILL");
      }
      const [code, signal] = await closed;
      expect(mode === "resume" ? code : signal).toBe(mode === "resume" ? 0 : "SIGKILL");
      const held = await acquireFileLock(file, options);
      await held.release();
      const syncHeld = acquireFileLockSync(file, options);
      syncHeld.release();
      expect(fs.readdirSync(`${lock}.arbitration`)).toEqual([]);
    } finally {
      child.kill("SIGKILL");
      await closed;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  20_000,
);

it("exclusive action prevents same-process competing arbitration", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arbitration-exclusive-"));
  try {
    const lock = path.join(dir, "lock");
    const outer = tryWithFileLockArbitration(lock, () =>
      tryWithFileLockArbitration(lock, () => "must not enter"),
    );
    expect(outer).toEqual({ acquired: true, value: { acquired: false } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("prevents a cooperating acquirer replacing the lock inside the stale-unlink window", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reaper-replacement-"));
  const file = path.join(fs.realpathSync(dir), "state");
  const lock = `${file}.lock`;
  fs.writeFileSync(lock, JSON.stringify({ pid: 2147483647, createdAt: new Date(0).toISOString() }));
  const options = { retries: { retries: 0, factor: 1, minTimeout: 1, maxTimeout: 1 }, stale: 1 };
  const original = fs.rmSync;
  let checked = false;
  const spy = vi.spyOn(fs, "rmSync").mockImplementation((target, settings) => {
    if (String(target) === lock && !checked) {
      checked = true;
      // Another participant runs precisely after stale inspection, before unlink.
      expect(() => acquireFileLockSync(file, options)).toThrow(/timeout/);
    }
    return original(target, settings);
  });
  try {
    const held = await acquireFileLock(file, options);
    expect(checked).toBe(true);
    await held.release();
  } finally {
    spy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

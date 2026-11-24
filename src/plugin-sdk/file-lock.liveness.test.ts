import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireFileLock, acquireFileLockSync } from "./file-lock.js";

const roots: string[] = [];
const options = { retries: { retries: 2, factor: 1, minTimeout: 1, maxTimeout: 1 }, stale: 1 };
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-file-lock-"));
  roots.push(root);
  return path.join(root, "store.json");
}
for (const [name, payload] of [
  ["dead PID", JSON.stringify({ pid: 2147483647, createdAt: "1970-01-01T00:00:00Z" })],
  ["living PID", JSON.stringify({ pid: process.pid, createdAt: "1970-01-01T00:00:00Z" })],
  ["malformed contents", "not-json"],
  ["empty contents", ""],
]) {
  it(`sync and async bounded rejection preserves an aged lock with ${name}`, async () => {
    const file = fixture();
    fs.writeFileSync(`${file}.lock`, payload);
    fs.utimesSync(`${file}.lock`, 0, 0);
    const before = fs.statSync(`${file}.lock`);
    expect(() => acquireFileLockSync(file, options)).toThrow(/timeout/);
    await expect(acquireFileLock(file, options)).rejects.toThrow(/timeout/);
    expect(fs.readFileSync(`${file}.lock`, "utf8")).toBe(payload);
    expect(fs.statSync(`${file}.lock`).ino).toBe(before.ino);
    expect(fs.statSync(`${file}.lock`).mtimeMs).toBe(before.mtimeMs);
  });
}
it("normal async and sync release allow fresh acquisition", async () => {
  const file = fixture();
  const first = await acquireFileLock(file, options);
  await first.release();
  expect(fs.existsSync(`${file}.lock`)).toBe(false);
  const second = acquireFileLockSync(file, options);
  second.release();
  const third = await acquireFileLock(file, options);
  await third.release();
});
it("two real processes serialize critical sections", async () => {
  const file = fixture();
  const marker = `${file}.critical`;
  const script = `import fs from 'node:fs';import {acquireFileLock} from ${JSON.stringify(new URL("./file-lock.ts", import.meta.url).href)};const lock=await acquireFileLock(${JSON.stringify(file)},{retries:{retries:200,factor:1,minTimeout:5,maxTimeout:5},stale:1});const fd=fs.openSync(${JSON.stringify(marker)},'wx');await new Promise(r=>setTimeout(r,40));fs.closeSync(fd);fs.unlinkSync(${JSON.stringify(marker)});await lock.release();`;
  const run = () =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`child exit ${code}: ${stderr}`)),
      );
    });
  await Promise.all([run(), run()]);
  expect(fs.existsSync(marker)).toBe(false);
  expect(fs.existsSync(`${file}.lock`)).toBe(false);
});

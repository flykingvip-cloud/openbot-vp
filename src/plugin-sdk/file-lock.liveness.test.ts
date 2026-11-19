import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { acquireFileLock, acquireFileLockSync } from "./file-lock.js";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it("does not delete a replacement lock when stale inspection loses its snapshot", () => {
  const { file, payload } = fixture();
  fs.writeFileSync(`${file}.lock`, "");
  const normalizedLock = path.join(
    fs.realpathSync(path.dirname(file)),
    `${path.basename(file)}.lock`,
  );
  const originalStat = fs.statSync;
  vi.spyOn(fs, "statSync").mockImplementation((...args: Parameters<typeof fs.statSync>) => {
    if (String(args[0]) === normalizedLock) {
      fs.writeFileSync(`${file}.lock`, payload);
      throw Object.assign(new Error("previous lock disappeared"), { code: "ENOENT" });
    }
    return originalStat(...args);
  });
  expect(() => acquireFileLockSync(file, options)).toThrow(/timeout/);
  expect(fs.readFileSync(`${file}.lock`, "utf8")).toBe(payload);
});
const options = { retries: { retries: 0, factor: 1, minTimeout: 1, maxTimeout: 1 }, stale: 1 };
it("async stale inspection cannot delete a replacement lock after ENOENT", async () => {
  const { file, payload } = fixture();
  fs.writeFileSync(`${file}.lock`, "");
  const stat = fs.statSync;
  vi.spyOn(fs, "statSync").mockImplementation((...args: Parameters<typeof fs.statSync>) => {
    if (
      String(args[0]) ===
      path.join(fs.realpathSync(path.dirname(file)), `${path.basename(file)}.lock`)
    ) {
      fs.writeFileSync(`${file}.lock`, payload);
      throw Object.assign(new Error("previous lock disappeared"), { code: "ENOENT" });
    }
    return stat(...args);
  });
  await expect(acquireFileLock(file, options)).rejects.toThrow(/timeout/);
  expect(fs.readFileSync(`${file}.lock`, "utf8")).toBe(payload);
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "live-file-lock-"));
  roots.push(root);
  const file = path.join(root, "store.json");
  const payload = JSON.stringify({
    pid: process.pid,
    createdAt: new Date(Date.now() - 60000).toISOString(),
  });
  fs.writeFileSync(`${file}.lock`, payload);
  return { file, payload };
}
it("sync acquisition cannot steal an aged lock from a living owner", () => {
  const { file, payload } = fixture();
  expect(() => acquireFileLockSync(file, options)).toThrow(/timeout/);
  expect(fs.readFileSync(`${file}.lock`, "utf8")).toBe(payload);
});
it("async acquisition cannot steal an aged lock from a living owner", async () => {
  const { file, payload } = fixture();
  await expect(acquireFileLock(file, options)).rejects.toThrow(/timeout/);
  expect(fs.readFileSync(`${file}.lock`, "utf8")).toBe(payload);
});

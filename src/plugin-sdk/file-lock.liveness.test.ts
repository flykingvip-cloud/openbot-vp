import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireFileLock, acquireFileLockSync } from "./file-lock.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const options = { retries: { retries: 0, factor: 1, minTimeout: 1, maxTimeout: 1 }, stale: 1 };
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

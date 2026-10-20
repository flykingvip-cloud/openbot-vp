import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ShadowLogBook, type TenantHmacKey } from "./shadow.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "__fixtures__");

function workerArgv(workerFile: string, args: string[]): string[] {
  const workerPath = path.join(FIXTURES, workerFile);
  const underBun = Boolean((process as unknown as { versions?: { bun?: string } }).versions?.bun);
  return underBun ? [workerPath, ...args] : ["--import", "tsx", workerPath, ...args];
}

function spawnWorker(workerFile: string, args: string[]): ChildProcess {
  return spawn(process.execPath, workerArgv(workerFile, args), {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runWorker(workerFile: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnWorker(workerFile, args);
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (err += String(d)));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(`worker exited ${code}: ${err}`));
      }
    });
  });
}

const KEY: TenantHmacKey = { keyId: "k-xproc", secret: "secret-xproc", issuedAtMs: 0 };

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-shadow-xproc-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("shadow store — real cross-process composite-UNIQUE idempotency (AC4/#9)", () => {
  it("yields exactly one row for one tuple across many concurrent worker processes", async () => {
    // Pre-create the tenant shadow DB (schema + meta) so workers open an initialized DB.
    new ShadowLogBook({ tenantId: "tenant-a", storeRoot: root, keyProvider: () => KEY }).close();

    const WORKERS = 8;
    const ATTEMPTS = 15; // 120 real cross-process append races on one tuple
    const outputs = await Promise.all(
      Array.from({ length: WORKERS }, () =>
        runWorker("shadow-cas-worker.ts", ["tenant-a", root, "conv-1", "msg-1", String(ATTEMPTS)]),
      ),
    );

    const totals = outputs.reduce(
      (acc, out) => {
        const line = out.trim().split("\n").filter(Boolean).at(-1) ?? "{}";
        const r = JSON.parse(line) as {
          attempted: number;
          appended: number;
          failed: number;
          inserted: number;
        };
        return {
          attempted: acc.attempted + r.attempted,
          appended: acc.appended + r.appended,
          failed: acc.failed + r.failed,
          inserted: acc.inserted + r.inserted,
        };
      },
      { attempted: 0, appended: 0, failed: 0, inserted: 0 },
    );

    // Exactly one insert won the composite UNIQUE across all processes.
    expect(totals.inserted).toBe(1);
    // No process threw (busy_timeout handles contention on short transactions).
    expect(totals.failed).toBe(0);
    expect(totals.attempted).toBe(WORKERS * ATTEMPTS);

    // And the shared DB holds exactly one row for that tuple.
    const book = new ShadowLogBook({
      tenantId: "tenant-a",
      storeRoot: root,
      keyProvider: () => KEY,
    });
    expect(book.size()).toBe(1);
    expect(book.find("conv-1")).toHaveLength(1);
    book.close();
  });
});

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
const exec = promisify(execFile);
it("retains the scoped owner stop when the Gateway process is replaced", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-task-stop-restart-"));
  const child = path.resolve("test/fixtures/runtime-convergence/task-stop.restart-child.ts");
  try {
    await exec(process.execPath, ["--import", "tsx", child, root, "write"], { timeout: 25000 });
    const { stdout } = await exec(process.execPath, ["--import", "tsx", child, root, "read"], {
      timeout: 25000,
    });
    expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toEqual({ state: "active" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60000);

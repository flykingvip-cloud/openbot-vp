import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const child = path.resolve("test/fixtures/runtime-convergence/async-wait-recovery-child.ts");

async function run(root: string, mode: string) {
  const { stdout } = await exec(process.execPath, ["--import", "tsx", child, root, mode], {
    timeout: 60000,
  });
  const line = stdout.trim().split("\n").at(-1)!;
  return JSON.parse(line) as Record<string, unknown>;
}

it("Process A writes wait → Process B arms continue and completes real claim+delivery receipt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-cross-loop-"));
  try {
    await run(root, "write-wait");
    const result = await run(root, "arm-and-execute");
    expect(result.arm).toBe("continue_armed");
    expect(result.claimKind).toBe("accepted");
    expect(result.recoveryStage).toBe("delivered");
    expect(result.boundRunId).toEqual(result.runId);
    expect(result.pendingAfter).toBe(false);
    expect(result.taskUnfinished).toBe(false);
    expect(result.promptHasEvidence).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 90000);

it("two processes claim under lock: single claimToken generation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-cross-race-"));
  try {
    await run(root, "write-wait");
    const [a, b] = await Promise.all([run(root, "claim-once"), run(root, "claim-once")]);
    const files = fs.readdirSync(root).filter((name) => name.startsWith("claim-"));
    expect(files.length).toBe(2);
    const claims = files.map((name) =>
      JSON.parse(fs.readFileSync(path.join(root, name), "utf8")),
    ) as Array<{ ok: boolean; claimToken: string | null; freshClaim: boolean; generation: number }>;
    expect(claims.every((row) => row.ok)).toBe(true);
    const tokens = new Set(claims.map((row) => row.claimToken));
    // Exactly one fresh claim; the other retries the same token.
    expect(tokens.size).toBe(1);
    expect(claims.filter((row) => row.freshClaim).length).toBe(1);
    expect(a.pid).not.toBe(b.pid);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 90000);

it("crash after claim before enqueue → retry arms continue", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-cross-crash-"));
  try {
    await run(root, "write-wait");
    await run(root, "crash-after-claim");
    const crash = JSON.parse(fs.readFileSync(path.join(root, "crash-claim.json"), "utf8"));
    expect(crash.ok).toBe(true);
    expect(crash.stage).toBe("claimed");
    const retry = await run(root, "retry-after-crash");
    expect(retry.enqueued).toBe(1);
    expect(["continue_armed", "retried_open"]).toContain(retry.outcome);
    expect(retry.stage).toBe("continue_armed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 90000);

it("stop/pause concurrent with recovery clears intent", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-cross-stop-"));
  try {
    await run(root, "write-wait");
    const cleared = await run(root, "clear-stop");
    expect(cleared.cleared).toBe(true);
    expect(cleared.status).toBe("cleared");
    const retry = await run(root, "retry-after-crash");
    expect(retry.outcome).toBe("cleared");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 90000);

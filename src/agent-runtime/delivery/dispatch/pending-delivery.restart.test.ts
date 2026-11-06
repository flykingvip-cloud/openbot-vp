import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
const exec = promisify(execFile);
it.each(["active", "paused", "cancelled"])(
  "rehydrates durable delivery in a new process: %s",
  async (mode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "delivery-restart-"));
    try {
      const child = path.resolve(
        "test/fixtures/runtime-convergence/pending-delivery.restart-child.ts",
      );
      await exec(process.execPath, ["--import", "tsx", child, root, "prepare"]);
      const { stdout } = await exec(process.execPath, ["--import", "tsx", child, root, mode]);
      const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
      expect(result.hydrated).toBe(1);
      expect(result.pending.checkedTask.binding).toEqual({
        taskId: "board-a",
        executionAttempt: "run-a",
        deliverableVersion: "v1",
      });
      expect(result.repeated).toEqual(result.after);
      if (mode === "active") {
        expect(result.after.current.unfinished).toBe(false);
        expect(result.closes).toBe(1);
      } else {
        expect(result.after).toEqual(result.before);
        expect(result.closes).toBe(0);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  60000,
);

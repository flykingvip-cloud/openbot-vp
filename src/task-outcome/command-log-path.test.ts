import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DurableTaskOutcomeStore } from "./store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("DurableTaskOutcomeStore.commandLogPath", () => {
  it("keeps short commandIds URL-encoded", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "outcome-cmd-short-"));
    tempDirs.push(root);
    const store = new DurableTaskOutcomeStore(root);
    const p = store.commandLogPath("cmd:simple");
    expect(path.basename(p)).toBe(`${encodeURIComponent("cmd:simple")}.json`);
  });

  it("hashes long commandIds to avoid ENAMETOOLONG", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "outcome-cmd-long-"));
    tempDirs.push(root);
    const store = new DurableTaskOutcomeStore(root);
    const longId = `space:${"x".repeat(300)}:session:${"y".repeat(200)}`;
    const p = store.commandLogPath(longId);
    const base = path.basename(p);
    expect(base.startsWith("h-")).toBe(true);
    expect(base.length).toBeLessThan(80);
    // Round-trip save/load still works under the hashed name.
    store.saveCommand(longId, { digest: "abc", taskId: "t1", outcomeVersion: 1 });
    expect(store.loadCommand(longId)).toEqual({
      digest: "abc",
      taskId: "t1",
      outcomeVersion: 1,
      // saveCommand does not invent a commit id for logs that never had one.
      commitId: null,
      snapshotFingerprint: null,
      committedSpend: null,
      commandDisposition: null,
      callBinding: null,
    });
  });

  it("different long ids do not collide under sha256 prefix", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "outcome-cmd-collision-"));
    tempDirs.push(root);
    const store = new DurableTaskOutcomeStore(root);
    const a = `space:${"a".repeat(250)}:one`;
    const b = `space:${"b".repeat(250)}:two`;
    expect(store.commandLogPath(a)).not.toBe(store.commandLogPath(b));
  });
});

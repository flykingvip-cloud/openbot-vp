/**
 * Exec-approval restart (v4.1 §9 gate 3). Pending work resumes; nothing missing becomes allow.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  approvalGrantFromJournal,
  readExecApprovalJournal,
  upsertExecApprovalJournal,
} from "./exec-approval-journal.js";
import { ExecApprovalManager } from "./exec-approval-manager.js";

describe("exec approval journal", () => {
  const managers: ExecApprovalManager[] = [];
  let dir = "";

  afterEach(async () => {
    for (const manager of managers) {
      manager.close();
    }
    managers.length = 0;
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  function open(journalPath: string): ExecApprovalManager {
    const manager = new ExecApprovalManager({ journalPath });
    managers.push(manager);
    return manager;
  }

  it("resumes a pending exec approval without granting it", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-exec-journal-"));
    const journalPath = path.join(dir, "exec.json");
    const first = open(journalPath);
    const record = first.create({ command: "echo hi" }, 60_000, "appr-1");
    const waiting = first.register(record, 60_000);
    void first.register(record, 60_000);
    expect(readExecApprovalJournal(journalPath)["appr-1"]?.state).toBe("PENDING");
    first.close();

    const second = open(journalPath);
    expect(second.getSnapshot("appr-1")?.decision).toBeUndefined();
    expect(second.consumeAllowOnce("appr-1")).toBe(false);
    expect(second.listPending().map((row) => row.id)).toEqual(["appr-1"]);
    expect(approvalGrantFromJournal(readExecApprovalJournal(journalPath)["appr-1"])).toEqual({
      grant: null,
      state: "PENDING",
    });
    expect(second.register(second.getSnapshot("appr-1")!, 60_000)).toBe(
      second.awaitDecision("appr-1"),
    );
    expect(waiting).toBeInstanceOf(Promise);
  });

  it("expires, denies, and cancels as explicit failures", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-exec-journal-fail-"));
    const journalPath = path.join(dir, "exec.json");
    const first = open(journalPath);
    const pending = first.create({ command: "echo hi" }, 60_000, "appr-exp");
    void first.register(pending, 60_000);
    const stored = readExecApprovalJournal(journalPath)["appr-exp"];
    if (!stored) {
      throw new Error("expected a pending exec approval journal row");
    }
    upsertExecApprovalJournal(journalPath, {
      ...stored,
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    first.close();
    const expired = open(journalPath);
    expect(readExecApprovalJournal(journalPath)["appr-exp"]?.state).toBe("EXPIRED");
    expect(expired.consumeAllowOnce("appr-exp")).toBe(false);
    expect(expired.getSnapshot("appr-exp")).toBeNull();
    expect(
      approvalGrantFromJournal(readExecApprovalJournal(journalPath)["appr-exp"]).grant,
    ).toBeNull();

    const denied = first.create({ command: "echo no" }, 60_000, "appr-deny");
    const denyManager = open(journalPath);
    const denyPromise = denyManager.register(denied, 60_000);
    expect(denyManager.resolve("appr-deny", "deny")).toBe(true);
    expect(denyManager.resolve("appr-deny", "deny")).toBe(false);
    await expect(denyPromise).resolves.toBe("deny");
    expect(readExecApprovalJournal(journalPath)["appr-deny"]?.state).toBe("FAILED");
    denyManager.close();
    const afterDeny = open(journalPath);
    expect(
      approvalGrantFromJournal(readExecApprovalJournal(journalPath)["appr-deny"]).grant,
    ).toBeNull();
    expect(() => afterDeny.register(denied, 60_000)).toThrow(/FAILED/);

    const cancelManager = open(journalPath);
    const cancelRecord = cancelManager.create({ command: "echo stop" }, 60_000, "appr-cancel");
    const cancelPromise = cancelManager.register(cancelRecord, 60_000);
    expect(cancelManager.cancel("appr-cancel")).toBe(true);
    await expect(cancelPromise).resolves.toBeNull();
    expect(cancelManager.consumeAllowOnce("appr-cancel")).toBe(false);
    expect(readExecApprovalJournal(journalPath)["appr-cancel"]?.state).toBe("CANCELLED");
    cancelManager.close();
    const afterCancel = open(journalPath);
    expect(afterCancel.consumeAllowOnce("appr-cancel")).toBe(false);
    expect(approvalGrantFromJournal(readExecApprovalJournal(journalPath)["appr-cancel"])).toEqual({
      grant: null,
      state: "CANCELLED",
    });
  });

  it("restores an explicit allow once and does not spend it twice", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-exec-journal-allow-"));
    const journalPath = path.join(dir, "exec.json");
    const otherPath = path.join(dir, "local-file.json");
    const first = open(journalPath);
    const record = first.create({ command: "echo ok" }, 60_000, "appr-ok");
    const decision = first.register(record, 60_000);
    expect(first.resolve("appr-ok", "allow-once")).toBe(true);
    await expect(decision).resolves.toBe("allow-once");
    first.close();

    const second = open(journalPath);
    expect(second.consumeAllowOnce("appr-ok")).toBe(true);
    expect(second.consumeAllowOnce("appr-ok")).toBe(false);
    second.close();

    const third = open(journalPath);
    expect(third.consumeAllowOnce("appr-ok")).toBe(false);
    expect(
      approvalGrantFromJournal(readExecApprovalJournal(journalPath)["appr-ok"]).grant,
    ).toBeNull();
    expect(readExecApprovalJournal(otherPath)["appr-ok"]).toBeUndefined();
  });
});

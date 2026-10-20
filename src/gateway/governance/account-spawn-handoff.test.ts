/**
 * Account Computer v4.1 §9 gate 3: spawn handoff survives restart and stays idempotent.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AccountSpawnHandoffStore,
  handoffAllowsExecution,
  resolveAccountSpawnHandoffPath,
  type AccountSpawnHandoff,
} from "./account-spawn-handoff.js";
import {
  buildSpawnGovernanceSnapshot,
  configureAccountSpawnHandoffStore,
  discardStagedSpawnGovernanceSnapshot,
  recoverAccountSpawnHandoffs,
  resetSpawnGovernanceSnapshotHandoffForTest,
  stageSpawnGovernanceSnapshot,
  takeStagedSpawnGovernanceSnapshot,
} from "./spawn-snapshot-handoff.js";

const expiresAt = "2026-10-06T00:30:00.000Z";
const nowMs = Date.parse("2026-10-06T00:05:00.000Z");

function pending(handoffId: string, decisionId = "gd-handoff"): Omit<AccountSpawnHandoff, "state"> {
  return {
    handoffId,
    parentExecutionId: "parent-1",
    childExecutionId: "child-1",
    decisionId,
    snapshotVersion: 2,
    expiresAt,
  };
}

describe("account spawn handoff", () => {
  it("uses an explicit handoff file when one is configured", () => {
    expect(
      resolveAccountSpawnHandoffPath({
        OPENBOT_ACCOUNT_SPAWN_HANDOFF: "/tmp/account-spawn-handoff.json",
      }),
    ).toBe("/tmp/account-spawn-handoff.json");
  });

  let dir = "";

  afterEach(() => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("resumes or fails explicitly across gateway and worker restart", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-handoff-"));
    const file = path.join(dir, "handoff.json");
    const first = new AccountSpawnHandoffStore(file);
    const created = first.putPending(pending("h-1"));
    expect(created.accepted).toBe(true);
    expect(created.record.state).toBe("PENDING");
    expect(first.putPending(pending("h-1")).accepted).toBe(true);
    expect(first.putPending(pending("h-1", "gd-other")).accepted).toBe(false);
    expect(first.get("h-1")?.decisionId).toBe("gd-handoff");
    expect(first.complete("h-1")?.accepted).toBe(false);
    expect(first.get("h-1")?.state).toBe("PENDING");
    expect(first.markRunning("h-1")?.record.state).toBe("RUNNING");
    expect(first.markRunning("h-1")?.accepted).toBe(true);

    const restarted = new AccountSpawnHandoffStore(file);
    const recovered = restarted.recover(nowMs);
    expect(recovered.resumed.map((row) => row.handoffId)).toEqual(["h-1"]);
    const resume = restarted.admit("h-1", nowMs);
    expect(resume.disposition).toBe("resume");
    expect(handoffAllowsExecution(resume)).toBe(true);
    expect(restarted.admit("h-1", nowMs)).toEqual(resume);

    expect(restarted.complete("h-1")?.record.state).toBe("COMPLETED");
    const done = restarted.admit("h-1", nowMs);
    expect(done.disposition).toBe("already-completed");
    expect(handoffAllowsExecution(done)).toBe(false);
    expect(restarted.complete("h-1")?.accepted).toBe(true);

    expect(restarted.admit("missing", nowMs)).toEqual({
      disposition: "fail",
      state: "FAILED",
      record: null,
    });
    expect(restarted.get("missing")).toBeNull();
    expect(handoffAllowsExecution(restarted.admit("missing", nowMs))).toBe(false);
  });

  it("expires, cancels, and fails without turning absence into allow", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-handoff-end-"));
    const store = new AccountSpawnHandoffStore(path.join(dir, "handoff.json"));
    store.putPending({ ...pending("h-exp"), expiresAt: "2020-01-01T00:00:00.000Z" });
    const expired = store.admit("h-exp", nowMs);
    expect(expired.disposition).toBe("fail");
    expect(expired.state).toBe("EXPIRED");
    expect(handoffAllowsExecution(expired)).toBe(false);
    expect(store.admit("h-exp", nowMs).state).toBe("EXPIRED");

    store.putPending(pending("h-cancel"));
    expect(store.cancel("h-cancel")?.record.state).toBe("CANCELLED");
    expect(handoffAllowsExecution(store.admit("h-cancel", nowMs))).toBe(false);

    store.putPending(pending("h-fail"));
    expect(store.fail("h-fail")?.record.state).toBe("FAILED");
    expect(store.fail("h-fail")?.accepted).toBe(true);
    expect(store.admit("h-fail", nowMs).disposition).toBe("fail");
  });

  it("persists the existing spawn handoff and does not allow a missing memory snapshot", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-handoff-stage-"));
    const file = path.join(dir, "handoff.json");
    const snapshot = buildSpawnGovernanceSnapshot({
      parentRunId: "parent-1",
      tenantId: "tenant-a",
      now: "2026-10-06T00:00:00.000Z",
    });
    expect(snapshot?.snapshotId.startsWith("gd-")).toBe(true);
    configureAccountSpawnHandoffStore(new AccountSpawnHandoffStore(file));
    stageSpawnGovernanceSnapshot("child-1", snapshot);
    stageSpawnGovernanceSnapshot("child-1", snapshot);
    const live = new AccountSpawnHandoffStore(file).get("child-1");
    expect(live?.state).toBe("PENDING");
    expect(live?.decisionId).toBe(snapshot?.snapshotId);
    expect(live?.parentExecutionId).toBe("parent-1");
    expect(takeStagedSpawnGovernanceSnapshot("child-1")?.runId).toBe("parent-1");
    expect(new AccountSpawnHandoffStore(file).get("child-1")?.state).toBe("RUNNING");

    resetSpawnGovernanceSnapshotHandoffForTest();
    expect(takeStagedSpawnGovernanceSnapshot("child-1")).toBeUndefined();
    const restarted = new AccountSpawnHandoffStore(file);
    configureAccountSpawnHandoffStore(restarted);
    const recovered = recoverAccountSpawnHandoffs(nowMs);
    expect(recovered.resumed.map((row) => row.state)).toEqual(["RUNNING"]);
    expect(handoffAllowsExecution(restarted.admit("child-1", nowMs))).toBe(true);
    expect(takeStagedSpawnGovernanceSnapshot("child-1")).toBeUndefined();

    configureAccountSpawnHandoffStore(new AccountSpawnHandoffStore(path.join(dir, "other.json")));
    const other = buildSpawnGovernanceSnapshot({ parentRunId: "parent-2", now: expiresAt });
    stageSpawnGovernanceSnapshot("child-2", other);
    discardStagedSpawnGovernanceSnapshot("child-2");
    expect(new AccountSpawnHandoffStore(path.join(dir, "other.json")).get("child-2")?.state).toBe(
      "CANCELLED",
    );
    expect(recoverAccountSpawnHandoffs(Date.parse("2099-01-01T00:00:00.000Z")).resumed).toEqual([]);
  });
});

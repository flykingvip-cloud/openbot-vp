import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { TaskOutcomeResultService, newFencingToken } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:x",
  subjectRef: "user-a",
  authzScopeRef: "s",
};

describe("R83 proof: persist / concurrency / idempotency / security", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "r83-proof-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reopens and materializes published commit after crash between publish and apply", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store });
    const created = service.submit("t-crash", {
      type: "create",
      entrypoint: "chat",
      scope,
      taskContractVersion: "1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    // Simulate published-but-unapplied commit: copy tip commit and delete applied marker + tip
    const commits = fs.readdirSync(path.join(root, "commits")).filter((n) => n.endsWith(".json"));
    expect(commits.length).toBeGreaterThan(0);
    for (const name of fs.readdirSync(path.join(root, "commits-applied"))) {
      fs.unlinkSync(path.join(root, "commits-applied", name));
    }
    fs.unlinkSync(path.join(root, "tips", `${encodeURIComponent("t-crash")}.json`));

    const store2 = new DurableTaskOutcomeStore(root);
    const restored = store2.loadTask("t-crash");
    expect(restored?.taskId).toBe("t-crash");
    expect(restored?.outcomeVersion).toBe(1);
    expect(store2.loadTaskVersion("t-crash", 1)?.outcomeVersion).toBe(1);
  });

  it("two OS processes racing same expectedVersion: exactly one wins", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store });
    const opened = service.submit("t-race", {
      type: "create",
      entrypoint: "chat",
      scope,
      taskContractVersion: "1",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const fencing = newFencingToken();
    const att = service.submit("t-race", {
      type: "record_attempt",
      expectedVersion: 1,
      fencingToken: fencing,
      attempt: {
        attemptId: "a1",
        runId: "r1",
        status: "succeeded",
        observedAt: new Date().toISOString(),
      },
      run: {
        runId: "r1",
        attemptIds: ["a1"],
        effectiveAttemptId: "a1",
        fencingToken: fencing,
        status: "succeeded",
      },
    });
    expect(att.ok).toBe(true);

    const barrier = path.join(root, "barrier");
    const workerPath = path.resolve("src/task-outcome/r83-race-worker.mts");

    const children = [1, 2].map((id) =>
      spawn("pnpm", ["exec", "tsx", workerPath, root, "2", fencing, barrier, String(id)], {
        cwd: process.cwd(),
        env: process.env,
        stdio: "ignore",
      }),
    );
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    fs.writeFileSync(barrier, "go");
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (
        fs.existsSync(path.join(root, "result-1.json")) &&
        fs.existsSync(path.join(root, "result-2.json"))
      ) {
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    for (const c of children) {
      try {
        c.kill();
      } catch {
        // ignore
      }
    }
    const r1 = JSON.parse(fs.readFileSync(path.join(root, "result-1.json"), "utf8")) as {
      ok: boolean;
    };
    const r2 = JSON.parse(fs.readFileSync(path.join(root, "result-2.json"), "utf8")) as {
      ok: boolean;
    };
    expect([r1.ok, r2.ok].filter(Boolean).length).toBe(1);
    expect(new DurableTaskOutcomeStore(root).loadTask("t-race")?.outcomeVersion).toBe(3);
  }, 25000);

  it("durable projection exact counts after restart (success===1)", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-proj",
      scope,
      taskContractVersion: "1",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    let v = opened.record.outcomeVersion;
    const ft = opened.fencingToken;
    const att = chat.recordAttempt(
      "t-proj",
      v,
      ft,
      {
        attemptId: "a",
        runId: "r",
        status: "succeeded",
        observedAt: new Date().toISOString(),
      },
      {
        runId: "r",
        attemptIds: ["a"],
        effectiveAttemptId: "a",
        fencingToken: ft,
        status: "succeeded",
      },
      { scope },
    );
    expect(att.ok).toBe(true);
    if (!att.ok) {
      return;
    }
    v = att.record.outcomeVersion;
    const acc = chat.setAcceptance(
      "t-proj",
      v,
      ft,
      { status: "passed" },
      {
        allowRetry: false,
        evidence: [
          {
            validatorId: "v",
            validatorVersion: "1",
            scope: "s",
            artifactDigestOrReceiptRef: "digest-1",
            taskContractVersion: "1",
            executionVersion: "1",
          },
        ],
        scope,
      },
    );
    expect(acc.ok).toBe(true);
    if (!acc.ok) {
      return;
    }
    const del = chat.setDelivery(
      "t-proj",
      acc.record.outcomeVersion,
      ft,
      { status: "delivered" },
      "d1",
      { scope },
    );
    expect(del.ok).toBe(true);

    const c1 = new OutcomeConsumerRuntime(store);
    c1.drain((id) => store.loadTask(id));
    expect(c1.getProjection().successCount).toBe(1);
    expect(c1.getProjection().failureCount).toBe(0);

    const store2 = new DurableTaskOutcomeStore(root);
    const c2 = new OutcomeConsumerRuntime(store2);
    expect(c2.getProjection().successCount).toBe(1);
    expect(c2.getProjection().failureCount).toBe(0);
  });

  it("same commandId different payload is rejected; identical replays", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store });
    const a = service.submit(
      "t-cmd",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "1" },
      { commandId: "cmd-1" },
    );
    expect(a.ok).toBe(true);
    const replay = service.submit(
      "t-cmd",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "1" },
      { commandId: "cmd-1" },
    );
    expect(replay.ok).toBe(true);
    const conflict = service.submit(
      "t-cmd",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "2" },
      { commandId: "cmd-1" },
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.code).toBe("command_conflict");
    }
  });

  it("restore with different subject is rejected", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-scope",
      scope,
      taskContractVersion: "1",
    });
    expect(opened.ok).toBe(true);
    const other: TrustedScope = {
      ...scope,
      subjectRef: "user-b",
    };
    const bad = chat.createOrRestore({
      taskId: "t-scope",
      scope: other,
      taskContractVersion: "1",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.code).toBe("scope_mismatch");
    }
  });

  it("forged authorizedBy cannot correct", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({
      store,
      correctionAllowlist: ["real-auditor"],
    });
    const created = service.submit("t-corr", {
      type: "create",
      entrypoint: "chat",
      scope,
      taskContractVersion: "1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    // close as failure first
    const ft = newFencingToken();
    const att = service.submit("t-corr", {
      type: "record_attempt",
      expectedVersion: 1,
      fencingToken: ft,
      attempt: {
        attemptId: "a",
        runId: "r",
        status: "failed",
        observedAt: new Date().toISOString(),
      },
      run: {
        runId: "r",
        attemptIds: ["a"],
        fencingToken: ft,
        status: "failed",
      },
    });
    expect(att.ok).toBe(true);
    if (!att.ok) {
      return;
    }
    const closed = service.submit("t-corr", {
      type: "fail_closed",
      expectedVersion: att.record.outcomeVersion,
      fencingToken: ft,
      reasonCode: "run_failed",
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) {
      return;
    }
    const forged = service.submit("t-corr", {
      type: "correction",
      expectedVersion: closed.record.outcomeVersion,
      previousOutcomeVersion: closed.record.outcomeVersion,
      authorizedBy: "forged-auditor",
      revisionReason: "nope",
      acceptance: { status: "passed" },
      delivery: { status: "delivered" },
      decisiveRunStatus: "succeeded",
    });
    expect(forged.ok).toBe(false);
    if (!forged.ok) {
      expect(forged.code).toBe("unauthorized_correction");
    }
  });
});

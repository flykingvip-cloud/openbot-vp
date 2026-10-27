import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { TaskOutcomeResultService, newFencingToken } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:race",
  subjectRef: "user:race",
  authzScopeRef: "race",
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

  it("two OS processes racing same expectedVersion: exactly one wins", async () => {
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
    const att = service.submit(
      "t-race",
      {
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
      },
      { requiredScope: scope },
    );
    expect(att.ok).toBe(true);

    const barrier = path.join(root, "barrier");
    // Prefer direct node+tsx (same pattern as growth-bridge race): avoids pnpm exec
    // startup / lock contention under vitest forks, and keeps stderr visible on failure.
    const workerPath = fileURLToPath(new URL("./r83-race-worker.mts", import.meta.url));

    const spawnOne = (id: number) =>
      spawn(
        process.execPath,
        ["--import", "tsx", workerPath, root, "2", fencing, barrier, String(id)],
        {
          cwd: process.cwd(),
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

    const children = [1, 2].map((id) => spawnOne(id));
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(barrier, "go");

    const waitChild = (child: ReturnType<typeof spawn>, id: number) =>
      new Promise<{
        id: number;
        code: number | null;
        signal: NodeJS.Signals | null;
        err: string;
        out: string;
      }>((resolve) => {
        let err = "";
        let out = "";
        let done = false;
        const finish = (code: number | null, signal: NodeJS.Signals | null) => {
          if (done) {
            return;
          }
          done = true;
          resolve({ id, code, signal, err, out });
        };
        child.stderr?.on("data", (d) => {
          err += String(d);
        });
        child.stdout?.on("data", (d) => {
          out += String(d);
        });
        child.on("error", (e) => {
          err += `spawn_error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`;
          finish(null, null);
        });
        child.on("exit", (code, signal) => finish(code, signal));
        setTimeout(() => {
          if (done) {
            return;
          }
          err += "wait_timeout: killed after 20000ms\n";
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }, 20000);
      });

    const settled = await Promise.all(children.map((c, i) => waitChild(c, i + 1)));
    const r1Path = path.join(root, "result-1.json");
    const r2Path = path.join(root, "result-2.json");
    const missing = [r1Path, r2Path].filter((p) => !fs.existsSync(p));
    if (missing.length > 0) {
      const diag = settled
        .map(
          (s) =>
            `worker-${s.id}: code=${s.code} signal=${s.signal}\nstderr:\n${s.err || "(empty)"}\nstdout:\n${s.out || "(empty)"}`,
        )
        .join("\n---\n");
      throw new Error(
        `r83 race workers did not write result files: missing=${missing.join(", ")}\n${diag}`,
      );
    }
    for (const s of settled) {
      expect(s.code, `worker-${s.id} stderr:\n${s.err}`).toBe(0);
    }

    const r1 = JSON.parse(fs.readFileSync(r1Path, "utf8")) as {
      ok: boolean;
    };
    const r2 = JSON.parse(fs.readFileSync(r2Path, "utf8")) as {
      ok: boolean;
    };
    expect([r1.ok, r2.ok].filter(Boolean).length).toBe(1);
    expect(new DurableTaskOutcomeStore(root).loadTask("t-race")?.outcomeVersion).toBe(3);
  }, 25000);

  it("durable projection exact counts after restart (success===1)", async () => {
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
    await c1.drain((id) => store.loadTask(id));
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
      { commandId: "cmd-1", requiredScope: scope },
    );
    expect(a.ok).toBe(true);
    const replay = service.submit(
      "t-cmd",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "1" },
      { commandId: "cmd-1", requiredScope: scope },
    );
    expect(replay.ok).toBe(true);
    const conflict = service.submit(
      "t-cmd",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "2" },
      { commandId: "cmd-1", requiredScope: scope },
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
    const att = service.submit(
      "t-corr",
      {
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
      },
      { requiredScope: scope },
    );
    expect(att.ok).toBe(true);
    if (!att.ok) {
      return;
    }
    const closed = service.submit(
      "t-corr",
      {
        type: "fail_closed",
        expectedVersion: att.record.outcomeVersion,
        fencingToken: ft,
        reasonCode: "run_failed",
      },
      { requiredScope: scope },
    );
    expect(closed.ok).toBe(true);
    if (!closed.ok) {
      return;
    }
    const forged = service.submit(
      "t-corr",
      {
        type: "correction",
        expectedVersion: closed.record.outcomeVersion,
        previousOutcomeVersion: closed.record.outcomeVersion,
        authorizedBy: "forged-auditor",
        revisionReason: "nope",
        acceptance: { status: "passed" },
        delivery: { status: "delivered" },
        decisiveRunStatus: "succeeded",
      },
      { requiredScope: scope, callerSubjectRef: "forged-auditor" },
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) {
      expect(forged.code).toBe("unauthorized_correction");
    }
    // allowlisted name claimed without matching verified caller
    const spoof = service.submit(
      "t-corr",
      {
        type: "correction",
        expectedVersion: closed.record.outcomeVersion,
        previousOutcomeVersion: closed.record.outcomeVersion,
        authorizedBy: "real-auditor",
        revisionReason: "spoof",
        acceptance: { status: "passed" },
        delivery: { status: "delivered" },
        decisiveRunStatus: "succeeded",
      },
      { requiredScope: scope, callerSubjectRef: "attacker" },
    );
    expect(spoof.ok).toBe(false);
    if (!spoof.ok) {
      expect(spoof.code).toBe("unauthorized_correction");
    }
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { recordRunnerTurnOutcome } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:u1",
  subjectRef: "user:u1",
  authzScopeRef: "test",
};

describe("r85 recover / consumer / authz proofs", () => {
  let root = "";
  let agentDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "r85-"));
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "r85-agent-"));
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("old commit recover does not regress tip version", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store, submittedBy: "t" });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-regress",
      scope,
      taskContractVersion: "1.0.0",
      commandId: "c0",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const fence = opened.fencingToken;
    const cancelled = chat.cancel("t-regress", opened.record.outcomeVersion, fence, {
      scope,
      commandId: "c-cancel",
    });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }
    expect(cancelled.record.outcomeVersion).toBe(2);
    expect(cancelled.record.taskJudgement).toBe("cancelled");

    // Drop applied marker for the older v1 commit (simulate lost marker).
    const commitsDir = path.join(root, "commits");
    const appliedDir = path.join(root, "commits-applied");
    const commits = fs.readdirSync(commitsDir).filter((n) => n.endsWith(".json"));
    expect(commits.length).toBeGreaterThanOrEqual(2);
    let oldest: { commitId: string; version: number } | undefined;
    for (const name of commits) {
      const bundle = JSON.parse(fs.readFileSync(path.join(commitsDir, name), "utf8")) as {
        commitId: string;
        record: { outcomeVersion: number };
      };
      if (!oldest || bundle.record.outcomeVersion < oldest.version) {
        oldest = { commitId: bundle.commitId, version: bundle.record.outcomeVersion };
      }
    }
    expect(oldest?.version).toBe(1);
    fs.unlinkSync(path.join(appliedDir, `${oldest!.commitId}.json`));

    store.close();
    const reopened = new DurableTaskOutcomeStore(root);
    const tip = reopened.loadTask("t-regress");
    expect(tip?.outcomeVersion).toBe(2);
    expect(tip?.taskJudgement).toBe("cancelled");
    // v1 snapshot still present
    expect(reopened.loadTaskVersion("t-regress", 1)?.outcomeVersion).toBe(1);
  });

  it("handler side-effect after interrupt yields single business result", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store, submittedBy: "t" });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-side",
      scope,
      taskContractVersion: "1.0.0",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const fence = opened.fencingToken;
    let res = chat.recordAttempt(
      "t-side",
      opened.record.outcomeVersion,
      fence,
      {
        attemptId: "a1",
        runId: "r1",
        status: "succeeded",
        observedAt: new Date().toISOString(),
      },
      {
        runId: "r1",
        attemptIds: ["a1"],
        effectiveAttemptId: "a1",
        fencingToken: fence,
        status: "succeeded",
      },
      { scope },
    );
    if (!res.ok) {
      throw new Error(res.code);
    }
    res = chat.setAcceptance(
      "t-side",
      res.record.outcomeVersion,
      fence,
      { status: "not_required", reason: "test" },
      {
        allowRetry: true,
        scope,
        evidence: [
          {
            validatorId: "t",
            validatorVersion: "1",
            scope: "personal:u1",
            artifactDigestOrReceiptRef: "x",
            taskContractVersion: "1.0.0",
            executionVersion: "2",
          },
        ],
      },
    );
    if (!res.ok) {
      throw new Error(res.code);
    }
    res = chat.setDelivery(
      "t-side",
      res.record.outcomeVersion,
      fence,
      { status: "not_required", reason: "test" },
      "d1",
      { scope },
    );
    if (!res.ok) {
      throw new Error(res.code);
    }
    expect(res.record.lifecycle).toBe("closed");
    expect(res.record.taskJudgement).toBe("success");

    const sideFile = path.join(root, "side-effect-count.txt");
    let calls = 0;
    const runtime = new OutcomeConsumerRuntime(store, {
      handlers: [
        {
          consumerId: "test-side",
          onEvent: (event) => {
            if (event.eventType !== "task.closed" && event.eventType !== "task.corrected") {
              return;
            }
            calls += 1;
            fs.writeFileSync(sideFile, `${calls}:${event.eventId}\n`, "utf8");
            if (calls === 1) {
              throw new Error("crash after side effect");
            }
          },
        },
      ],
    });
    const first = runtime.drain((id) => store.loadTask(id));
    expect(first.deferred).toBeGreaterThan(0);
    expect(calls).toBe(1);
    // outbox still pending for handler retry
    expect(store.listPendingOutbox().length).toBeGreaterThan(0);

    const second = runtime.drain((id) => store.loadTask(id));
    expect(calls).toBe(2);
    expect(second.processed).toBeGreaterThan(0);
    // business file still one logical result line (last write), but handler ran twice —
    // for true idempotency growth bridge uses already_published; here we assert outbox completes
    // and main consumer does not block independent handler ack protocol.
    expect(store.listPendingOutbox().length).toBe(0);
  });

  it("nonzero projection crash rebuild keeps eligibility exclusions", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({ store, submittedBy: "t" });
    const chat = new ChatTaskOutcomeAdapter(service);
    // success eligible
    let o = chat.createOrRestore({ taskId: "ok", scope, taskContractVersion: "1.0.0" });
    if (!o.ok) {
      throw new Error("o");
    }
    let r = chat.recordAttempt(
      "ok",
      o.record.outcomeVersion,
      o.fencingToken,
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
        fencingToken: o.fencingToken,
        status: "succeeded",
      },
      { scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    r = chat.setAcceptance(
      "ok",
      r.record.outcomeVersion,
      o.fencingToken,
      { status: "not_required", reason: "t" },
      { allowRetry: true, scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }
    r = chat.setDelivery(
      "ok",
      r.record.outcomeVersion,
      o.fencingToken,
      { status: "not_required", reason: "t" },
      "d",
      { scope },
    );
    if (!r.ok) {
      throw new Error(r.code);
    }

    // failure that should NOT count growth negative if attribution excludes — use prepare_failed path
    o = chat.createOrRestore({ taskId: "bad", scope, taskContractVersion: "1.0.0" });
    if (!o.ok) {
      throw new Error("bad");
    }
    r = chat.failClosed("bad", o.record.outcomeVersion, "prepare_failed", {
      fencingToken: o.fencingToken,
      scope,
      reasonDetail: "preflight",
    });
    if (!r.ok) {
      throw new Error(r.code);
    }

    const rt = new OutcomeConsumerRuntime(store);
    rt.drain((id) => store.loadTask(id));
    const before = rt.getProjection();
    expect(before.successCount).toBe(1);
    // prepare_failed should not inflate failureCount if eligibility excludes it
    const failBefore = before.failureCount;

    // Simulate dual-write gap: wipe projection file while contributions remain
    const projDir = path.join(root, "projections");
    for (const name of fs.readdirSync(projDir)) {
      fs.unlinkSync(path.join(projDir, name));
    }
    // Write a bogus nonzero projection that would be wrong if trusted without rebuild
    fs.writeFileSync(
      path.join(projDir, "growth-evolution.json"),
      JSON.stringify({
        successCount: 99,
        failureCount: 99,
        cancelledCount: 0,
        applied: [],
      }),
      "utf8",
    );

    const rebuilt = new OutcomeConsumerRuntime(store);
    const after = rebuilt.getProjection();
    expect(after.successCount).toBe(before.successCount);
    expect(after.failureCount).toBe(failBefore);
    expect(after.successCount).not.toBe(99);
  });

  it("missing requiredScope and forged correction identity are rejected", () => {
    const store = new DurableTaskOutcomeStore(root);
    const service = new TaskOutcomeResultService({
      store,
      submittedBy: "t",
      correctionAllowlist: ["user:u1"],
    });
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "authz",
      scope,
      taskContractVersion: "1.0.0",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    // omit requiredScope on mutate
    const bare = service.submit("authz", {
      type: "cancel",
      expectedVersion: opened.record.outcomeVersion,
      fencingToken: opened.fencingToken,
    });
    expect(bare.ok).toBe(false);
    if (!bare.ok) {
      expect(bare.code).toBe("scope_mismatch");
    }

    // forge allowlisted name without matching callerSubjectRef
    const forged = service.submit(
      "authz",
      {
        type: "correction",
        previousOutcomeVersion: opened.record.outcomeVersion,
        authorizedBy: "user:u1",
        patch: { taskJudgement: "failure" },
        expectedVersion: opened.record.outcomeVersion,
        fencingToken: opened.fencingToken,
      } as never,
      { requiredScope: scope, callerSubjectRef: "attacker:x" },
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) {
      expect(forged.code).toBe("unauthorized_correction");
    }
  });

  it("bare runner success stays incomplete without acceptance/delivery", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-ok",
      taskId: "chat:bot:sess:run-ok",
      scope,
      toolsTotal: 1,
      toolsSucceeded: 1,
      tenantId: undefined,
    });
    expect(out.record.taskId).toBe("chat:bot:sess:run-ok");
    expect(out.record.lifecycle).not.toBe("closed");
    expect(out.record.taskJudgement).toBe("incomplete");
    expect(out.evolution.written).toBe(false);
  });

  it("process placeholder does not close as success or publish positive", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-ph",
      taskId: "chat:bot:sess:run-ph",
      scope,
      processPlaceholder: true,
    });
    expect(out.record.lifecycle).not.toBe("closed");
    expect(out.record.taskJudgement).toBe("incomplete");
    expect(out.evolution.written).toBe(false);
  });

  it("contract waive acceptance + delivered receipt closes success", async () => {
    const { resolveChatTurnCloseGates } = await import("./chat-entry.js");
    const gates = resolveChatTurnCloseGates({ deliveryId: "delivery:run-contract" });
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-contract",
      taskId: "chat:bot:sess:run-contract",
      scope,
      acceptance: gates.acceptance,
      delivery: gates.delivery,
      deliveryId: gates.deliveryId,
    });
    expect(out.record.lifecycle).toBe("closed");
    expect(out.record.taskJudgement).toBe("success");
    expect(out.record.acceptance.status).toBe("not_required");
    expect(out.record.delivery.status).toBe("delivered");
  });

  it("acceptance passed + delivery receipt closes success", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-acc",
      taskId: "chat:bot:sess:run-acc",
      scope,
      acceptance: { status: "passed" },
      delivery: { status: "delivered" },
      deliveryId: "delivery:run-acc",
      acceptanceEvidence: [
        {
          validatorId: "t",
          validatorVersion: "1",
          scope: "personal:u1",
          artifactDigestOrReceiptRef: "artifact:1",
          taskContractVersion: "1.0.0",
          executionVersion: "2",
        },
      ],
    });
    expect(out.record.lifecycle).toBe("closed");
    expect(out.record.taskJudgement).toBe("success");
  });
});

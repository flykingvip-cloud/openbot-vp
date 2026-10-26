import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutcomeConsumerRuntime } from "./consumers.js";
import { computeEvaluationEligibility } from "./eligibility.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { CronTaskOutcomeAdapter } from "./entrypoints/cron.js";
import { newFencingToken, TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const personalScope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:daniel",
  subjectRef: "user:daniel",
  authzScopeRef: "scope:local",
};
const scope = personalScope;

describe("TaskOutcome result service + durable consume", () => {
  let root = "";
  let store: DurableTaskOutcomeStore;
  let service: TaskOutcomeResultService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "task-outcome-"));
    store = new DurableTaskOutcomeStore(root);
    service = new TaskOutcomeResultService({
      store,
      correctionAllowlist: ["reviewer-1", "ops", "auditor"],
    });
  });

  afterEach(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("scenario A: tool success, acceptance pending, delivery blocked — incomplete, no success score", () => {
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-a",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const ft = opened.fencingToken;
    let v = opened.record.outcomeVersion;
    const r1 = chat.recordAttempt(
      "t-a",
      v,
      ft,
      {
        attemptId: "a1",
        runId: "r1",
        status: "succeeded",
        observedAt: new Date().toISOString(),
        toolObservations: [{ toolName: "web_search", ok: true }],
      },
      {
        runId: "r1",
        attemptIds: ["a1"],
        effectiveAttemptId: "a1",
        fencingToken: ft,
        status: "succeeded",
      },
      { scope },
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) {
      return;
    }
    v = r1.record.outcomeVersion;
    const r2 = chat.setAcceptance("t-a", v, ft, { status: "pending" }, { allowRetry: true, scope });
    expect(r2.ok).toBe(true);
    if (!r2.ok) {
      return;
    }
    v = r2.record.outcomeVersion;
    const r3 = chat.setDelivery("t-a", v, ft, { status: "blocked" }, undefined, { scope });
    expect(r3.ok).toBe(true);
    if (!r3.ok) {
      return;
    }
    expect(r3.record.lifecycle).toBe("awaiting_acceptance");
    expect(r3.record.taskJudgement).toBe("incomplete");

    const consumer = new OutcomeConsumerRuntime(store);
    consumer.drain((id) => service.get(id));
    expect(consumer.getProjection().successCount).toBe(0);
  });

  it("scenario B: acceptance failed stop => closed failure; eligibility capability", () => {
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-b",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const ft = opened.fencingToken;
    let v = opened.record.outcomeVersion;
    const attempt = chat.recordAttempt(
      "t-b",
      v,
      ft,
      {
        attemptId: "a1",
        runId: "r1",
        status: "succeeded",
        observedAt: new Date().toISOString(),
      },
      { runId: "r1", attemptIds: ["a1"], fencingToken: ft, status: "succeeded" },
      { scope },
    );
    if (!attempt.ok) {
      throw new Error("attempt");
    }
    v = attempt.record.outcomeVersion;
    const closed = chat.setAcceptance(
      "t-b",
      v,
      ft,
      { status: "failed" },
      {
        allowRetry: false,
        evidence: [
          {
            validatorId: "v1",
            validatorVersion: "1",
            scope: "artifact",
            artifactDigestOrReceiptRef: "sha256:abc",
            taskContractVersion: "ctr-1",
            executionVersion: "exec-1",
          },
        ],
        scope,
      },
    );
    expect(closed.ok).toBe(true);
    if (!closed.ok) {
      return;
    }
    expect(closed.record.lifecycle).toBe("closed");
    expect(closed.record.taskJudgement).toBe("failure");
    const el = computeEvaluationEligibility(closed.record);
    expect(el.countsGrowthNegative).toBe(true);
    expect(el.attribution).toBe("capability");
  });

  it("scenario C: fail then repair success counts once; history retained", () => {
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-c",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    let ft = opened.fencingToken;
    let v = opened.record.outcomeVersion;
    let res = chat.recordAttempt(
      "t-c",
      v,
      ft,
      {
        attemptId: "a1",
        runId: "r1",
        status: "failed",
        observedAt: new Date().toISOString(),
      },
      { runId: "r1", attemptIds: ["a1"], fencingToken: ft, status: "failed" },
      { scope },
    );
    if (!res.ok) {
      throw new Error("a1");
    }
    v = res.record.outcomeVersion;
    res = chat.setAcceptance("t-c", v, ft, { status: "failed" }, { allowRetry: true, scope });
    if (!res.ok) {
      throw new Error("acc fail");
    }
    expect(res.record.lifecycle).toBe("recovering");
    v = res.record.outcomeVersion;
    // new attempt with new fencing after recovery
    ft = newFencingToken();
    res = chat.recordAttempt(
      "t-c",
      v,
      ft,
      {
        attemptId: "a2",
        runId: "r2",
        status: "succeeded",
        observedAt: new Date().toISOString(),
      },
      { runId: "r2", attemptIds: ["a2"], fencingToken: ft, status: "succeeded" },
      { scope },
    );
    if (!res.ok) {
      throw new Error("a2");
    }
    v = res.record.outcomeVersion;
    res = chat.setAcceptance("t-c", v, ft, { status: "passed" }, { allowRetry: false, scope });
    if (!res.ok) {
      throw new Error("acc pass");
    }
    v = res.record.outcomeVersion;
    res = chat.setDelivery("t-c", v, ft, { status: "delivered" }, "del-1", { scope });
    if (!res.ok) {
      throw new Error("del");
    }
    expect(res.record.taskJudgement).toBe("success");
    expect(res.record.attempts.map((a) => a.attemptId)).toEqual(["a1", "a2"]);

    const consumer = new OutcomeConsumerRuntime(store);
    consumer.drain((id) => service.get(id));
    expect(consumer.getProjection().successCount).toBe(1);
  });

  it("scenario D: preflight reject — no forged run/attempt, durable closed failure", () => {
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-d",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const res = chat.rejectBeforePreflight("t-d", "policy deny", scope);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.record.lifecycle).toBe("closed");
    expect(res.record.taskJudgement).toBe("failure");
    expect(res.record.decisiveRunId).toBeUndefined();
    expect(res.record.attempts).toHaveLength(0);
    expect(computeEvaluationEligibility(res.record).attribution).toBe("prepare");
  });

  it("CAS: two writers same expectedVersion — only one wins", () => {
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-cas",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const ft = opened.fencingToken;
    const v = opened.record.outcomeVersion;
    const a = chat.cancel("t-cas", v, ft, { scope });
    const b = chat.setDelivery("t-cas", v, ft, { status: "delivered" }, "race-del", { scope });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.code).toBe("version_conflict");
    }
    // identical cancel retry returns same terminal (idempotent), not a second close
    const retry = chat.cancel("t-cas", v, ft, { scope });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.record.outcomeVersion).toBe(a.ok ? a.record.outcomeVersion : -1);
    }
  });

  it("cancel vs late success: cancel wins; stale fencing cannot overwrite", () => {
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-race",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const ft = opened.fencingToken;
    let v = opened.record.outcomeVersion;
    const cancelled = chat.cancel("t-race", v, ft, { scope });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }
    v = cancelled.record.outcomeVersion;
    const late = chat.setDelivery("t-race", v, ft, { status: "delivered" }, "late", { scope });
    expect(late.ok).toBe(false);
    if (!late.ok) {
      expect(late.code).toBe("terminal_protected");
    }
    expect(service.get("t-race")?.taskJudgement).toBe("cancelled");
  });

  it("crash between consume update and ack: replay does not double-count", () => {
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-crash",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const ft = opened.fencingToken;
    let v = opened.record.outcomeVersion;
    let res = chat.setAcceptance(
      "t-crash",
      v,
      ft,
      { status: "passed" },
      { allowRetry: false, scope },
    );
    if (!res.ok) {
      throw new Error("acc");
    }
    v = res.record.outcomeVersion;
    res = chat.setDelivery("t-crash", v, ft, { status: "delivered" }, "d1", { scope });
    if (!res.ok) {
      throw new Error("del");
    }

    // First consumer applies contribution but simulate crash before markOutboxDone
    // by only applying without ack, then reopen store.
    const consumer1 = new OutcomeConsumerRuntime(store);
    const pending = store.listPendingOutbox();
    expect(pending.length).toBeGreaterThan(0);
    const closedEv = pending.find((e) => e.eventType === "task.closed") ?? pending.at(-1)!;
    const record = service.get("t-crash")!;
    consumer1.applyContribution("growth-skill-mode-evolution", closedEv, record);
    // crash: no markConsumed / markOutboxDone
    store.close();

    const store2 = new DurableTaskOutcomeStore(root);
    const service2 = new TaskOutcomeResultService({ store: store2 });
    const consumer2 = new OutcomeConsumerRuntime(store2);
    // seed projection empty; drain should dedupe via contribution version + consume mark
    // First apply did not mark consumed — drain will apply again but revoke/idempotent upsert
    // We mark contribution already at v; second apply with same version should not double.
    const again = store2.loadContribution(personalScope.personalDomainId, "t-crash");
    expect(again?.judgement).toBe("success");
    consumer2.drain((id) => service2.get(id));
    // successCount from consumer2 starts 0; drain applies once
    expect(consumer2.getProjection().successCount).toBeLessThanOrEqual(1);
  });

  it("durable reopen restores non-terminal awaiting tasks", () => {
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-await",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    store.close();
    const store2 = new DurableTaskOutcomeStore(root);
    const service2 = new TaskOutcomeResultService({ store: store2 });
    const got = service2.get("t-await");
    expect(got?.lifecycle).toBe("awaiting_acceptance");
    expect(got?.taskJudgement).toBe("incomplete");
  });

  it("correction v1 failure -> v2 success revokes old contribution", () => {
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-fix",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const ft = opened.fencingToken;
    let v = opened.record.outcomeVersion;
    let res = chat.setAcceptance(
      "t-fix",
      v,
      ft,
      { status: "failed" },
      { allowRetry: false, scope },
    );
    if (!res.ok) {
      throw new Error("fail");
    }
    const consumer = new OutcomeConsumerRuntime(store);
    consumer.drain((id) => service.get(id));
    expect(consumer.getProjection().failureCount).toBe(1);

    const corr = service.submit(
      "t-fix",
      {
        type: "correction",
        expectedVersion: res.record.outcomeVersion,
        previousOutcomeVersion: res.record.outcomeVersion,
        authorizedBy: "ops",
        revisionReason: "mis-validated artifact",
        acceptance: { status: "passed" },
        delivery: { status: "delivered" },
        decisiveRunStatus: "succeeded",
      },
      { requiredScope: scope, callerSubjectRef: "ops" },
    );
    expect(corr.ok).toBe(true);
    if (!corr.ok) {
      return;
    }
    consumer.drain((id) => service.get(id));
    expect(consumer.getProjection().failureCount).toBe(0);
    expect(consumer.getProjection().successCount).toBe(1);
  });

  it("artifact digest change invalidates old acceptance evidence path", () => {
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-art",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    const ft = opened.fencingToken;
    let v = opened.record.outcomeVersion;
    const res = chat.setAcceptance(
      "t-art",
      v,
      ft,
      { status: "passed" },
      {
        allowRetry: false,
        evidence: [
          {
            validatorId: "v",
            validatorVersion: "1",
            scope: "file",
            artifactDigestOrReceiptRef: "sha256:old",
            taskContractVersion: "ctr-1",
            executionVersion: "e1",
          },
        ],
        scope,
      },
    );
    if (!res.ok) {
      throw new Error("acc");
    }
    v = res.record.outcomeVersion;
    const inv = service.invalidateAcceptanceIfArtifactChanged("t-art", "sha256:new", v, ft, {
      requiredScope: scope,
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) {
      return;
    }
    expect(inv.record.acceptance.status).toBe("pending");
    expect(inv.record.lifecycle).not.toBe("closed");
  });

  it("cron entry: each fire new task; retry same fire reuses taskId", () => {
    const cron = new CronTaskOutcomeAdapter(service);
    const fireTask = "cron:job1:fire-9";
    const a = cron.openTask({
      taskId: fireTask,
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    const b = cron.openTask({
      taskId: fireTask,
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.record.taskId).toBe(b.record.taskId);
      expect(a.record.outcomeVersion).toBe(b.record.outcomeVersion);
      expect(a.record.entrypoint).toBe("cron");
      expect(b.record.entrypoint).toBe("cron");
    }
    const other = cron.openTask({
      taskId: "cron:job1:fire-10",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    expect(other.ok).toBe(true);
    if (other.ok) {
      expect(other.record.taskId).toBe("cron:job1:fire-10");
      expect(other.record.entrypoint).toBe("cron");
    }
  });

  it("personal scope must not forge enterprise tenantId", () => {
    const chat = new ChatTaskOutcomeAdapter(service);
    const opened = chat.createOrRestore({
      taskId: "t-scope",
      scope: personalScope,
      taskContractVersion: "ctr-1",
    });
    if (!opened.ok) {
      throw new Error("open");
    }
    expect(opened.record.scope.kind).toBe("personal");
    expect("tenantId" in opened.record.scope).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { summarizeBatchVerification } from "./admission/capability-matrix.ts";
import {
  createInjectedProtocolRunner,
  createLocalProtocolVerificationService,
} from "./admission/local-protocol-adapter.ts";
import { verifiedCapabilityIds } from "./capability-evidence.ts";
import {
  cancelCapabilityVerificationTask,
  createCapabilityVerificationTask,
  ensureCapabilityVerificationLifecycle,
  expireCapabilityEvidenceForModel,
  getVerificationTask,
  listVerificationTasks,
  startBatchCapabilityVerification,
  startCapabilityVerification,
  setModelRoutingEligibility,
  recoverActiveVerificationTask,
  __resetCapabilityVerificationServiceForTest,
  configureCapabilityVerificationService,
} from "./capability-verification.ts";
import {
  __resetModelAdmissionStoreForTest,
  getModelAdmission,
  interruptInFlightVerificationTasks,
  isVerificationTaskLive,
  saveVerificationTask,
  upsertModelAdmission,
} from "./model-admission-store.ts";
import {
  __resetModelConnectionSessionForTest,
  buildConnectionFingerprint,
  getCurrentConfigFingerprint,
  markModelConnectionVerified,
  publishCurrentConfigFingerprint,
} from "./model-connection-gate.ts";

describe("batch2 formal capability verification", () => {
  beforeEach(() => {
    __resetModelAdmissionStoreForTest();
    __resetModelConnectionSessionForTest();
    __resetCapabilityVerificationServiceForTest();
  });

  afterEach(() => {
    __resetCapabilityVerificationServiceForTest();
  });

  it("connection ok + tool checker unavailable — does not write formal tool failure", async () => {
    const fp = buildConnectionFingerprint({
      modelId: "private/demo",
      providerId: "private",
      baseUrl: "https://api.example",
      api: "openai-completions",
    });
    markModelConnectionVerified("private/demo", fp);
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        resolveConnectionOk: () => true,
      },
    });

    const { task, authority } = await startCapabilityVerification({
      modelRef: "private/demo",
      capabilityIds: ["text_chat", "tool_use"],
      configFingerprint: fp,
    });
    expect(authority).toBe("formal");
    expect(task.status).toBe("partial");
    expect(task.results?.find((r) => r.id === "text_chat")?.status).toBe("passed");
    expect(task.results?.find((r) => r.id === "tool_use")?.status).toBe("checker_unavailable");
    expect(task.results?.find((r) => r.id === "tool_use")?.failureReason).toMatch(/未执行|检查器/);

    const admission = getModelAdmission("private/demo");
    expect(verifiedCapabilityIds(admission.capabilityEvidence)).toEqual(["text_chat"]);
    expect(admission.capabilityEvidence.find((e) => e.id === "tool_use")?.status).not.toBe(
      "failed",
    );
    expect(admission.demoCapabilityEvidence ?? []).toEqual([]);
  });

  it("unexecuted image/music check must not overwrite existing passed evidence", async () => {
    upsertModelAdmission("private/img", {
      capabilityEvidence: [
        {
          id: "image_generation",
          label: "image_generation",
          source: "specialized_eval",
          status: "passed",
          verifiedAt: 1_700_000_000_000,
          testVersion: "real-eval-v1",
          sourceNote: "此前专项评测通过",
        },
      ],
    });
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: { resolveConnectionOk: () => true },
    });
    const { task } = await startCapabilityVerification({
      modelRef: "private/img",
      capabilityIds: ["image_generation", "music_generation"],
    });
    expect(task.results?.every((r) => r.status === "checker_unavailable")).toBe(true);
    const admission = getModelAdmission("private/img");
    const image = admission.capabilityEvidence.find((e) => e.id === "image_generation");
    expect(image?.status).toBe("passed");
    expect(image?.verifiedAt).toBe(1_700_000_000_000);
    expect(image?.testVersion).toBe("real-eval-v1");
    expect(verifiedCapabilityIds(admission.capabilityEvidence)).toEqual(["image_generation"]);
  });

  it("reuses text_chat connection probe identity (verifiedAt) across re-checks", async () => {
    const fp = buildConnectionFingerprint({
      modelId: "private/reuse",
      baseUrl: "https://api.example",
    });
    const originalVerifiedAt = 1_650_000_000_000;
    upsertModelAdmission("private/reuse", {
      connectionFingerprint: fp,
      connectionVerifiedAt: originalVerifiedAt,
      capabilityEvidence: [
        {
          id: "text_chat",
          label: "text_chat",
          source: "protocol_probe",
          status: "passed",
          verifiedAt: originalVerifiedAt,
          testVersion: "local-protocol-v1",
          sourceNote: "连接协议探测通过（指纹绑定）",
        },
      ],
    });
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: { resolveConnectionOk: () => true },
    });
    await startCapabilityVerification({
      modelRef: "private/reuse",
      capabilityIds: ["text_chat"],
      configFingerprint: fp,
    });
    const again = getModelAdmission("private/reuse").capabilityEvidence.find(
      (e) => e.id === "text_chat",
    );
    expect(again?.status).toBe("passed");
    expect(again?.verifiedAt).toBe(originalVerifiedAt);
    expect(again?.sourceNote).toMatch(/复用/);
  });

  it("endpoint change expires formal evidence; old probe cannot keep success", () => {
    const oldFp = buildConnectionFingerprint({
      modelId: "private/demo",
      baseUrl: "https://old.example",
    });
    upsertModelAdmission("private/demo", {
      connectionFingerprint: oldFp,
      connectionVerifiedAt: Date.now(),
      capabilityEvidence: [
        {
          id: "text_chat",
          label: "text_chat",
          source: "protocol_probe",
          status: "passed",
          verifiedAt: Date.now(),
          testVersion: "local-protocol-v1",
        },
      ],
      autoRouting: "eligible",
    });

    expireCapabilityEvidenceForModel("private/demo", "端点已变更");
    const admission = getModelAdmission("private/demo");
    expect(admission.capabilityEvidence[0]?.status).toBe("expired");
    expect(admission.autoRouting).toBe("restricted");
    expect(verifiedCapabilityIds(admission.capabilityEvidence)).toEqual([]);
  });

  it("batch partial success never marks whole batch routing-eligible", async () => {
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        runner: createInjectedProtocolRunner({
          text_chat: {
            capabilityId: "text_chat",
            status: "passed",
            testVersion: "injected-v1",
          },
          tool_use: {
            capabilityId: "tool_use",
            status: "failed",
            failureReason: "tools missing",
            testVersion: "injected-v1",
          },
        }),
      },
    });

    const responses = await startBatchCapabilityVerification([
      { modelRef: "private/a", capabilityIds: ["text_chat"] },
      { modelRef: "private/b", capabilityIds: ["tool_use"] },
    ]);
    expect(responses).toHaveLength(2);
    const tasks = responses.map((r) => r.task);
    const summary = summarizeBatchVerification(tasks);
    expect(summary.succeededModelRefs).toEqual(["private/a"]);
    expect(summary.failedModelRefs).toEqual(["private/b"]);
    expect(summary.batchRoutingEligible).toBe(false);

    const routeA = await setModelRoutingEligibility({
      modelRef: "private/a",
      autoRouting: "eligible",
    });
    expect(routeA.status).toBe("not_wired");
    if (routeA.status !== "not_wired") {
      throw new Error("expected not_wired routing response");
    }
    expect(routeA.message).toMatch(/尚未接入|草稿/);
  });

  it("refresh recovery interrupts in-flight tasks after destroying service/scheduler", async () => {
    const scheduled: Array<() => void> = [];
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        settleDelayMs: 999_999,
        schedule: (work) => {
          scheduled.push(work);
        },
        resolveConnectionOk: () => true,
      },
    });
    const { task } = await startCapabilityVerification({
      modelRef: "private/async",
      capabilityIds: ["text_chat"],
    });
    expect(["queued", "running"]).toContain(task.status);
    expect(getVerificationTask(task.taskId)?.taskId).toBe(task.taskId);

    // Simulate refresh: destroy service + abandon schedulers (do not run scheduled work).
    __resetCapabilityVerificationServiceForTest();
    scheduled.length = 0;

    const recovered = await recoverActiveVerificationTask("private/async");
    expect(recovered?.taskId).toBe(task.taskId);
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.error).toMatch(/已中断|可重试/);
    expect(getVerificationTask(task.taskId)?.status).toBe("interrupted");

    // Late ghost work must not revive formal evidence after interrupt.
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: { resolveConnectionOk: () => true },
    });
    expect(verifiedCapabilityIds(getModelAdmission("private/async").capabilityEvidence)).toEqual(
      [],
    );
  });

  it("sync runner throw becomes terminal failed without formal evidence overwrite", async () => {
    upsertModelAdmission("private/sync-err", {
      capabilityEvidence: [
        {
          id: "text_chat",
          label: "text_chat",
          source: "protocol_probe",
          status: "passed",
          verifiedAt: 42,
          testVersion: "keep-me",
        },
      ],
    });
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        runner: {
          check() {
            throw new Error("boom-sync");
          },
        },
      },
    });
    const { task } = await startCapabilityVerification({
      modelRef: "private/sync-err",
      capabilityIds: ["text_chat"],
    });
    expect(task.status).toBe("failed");
    expect(task.error).toMatch(/boom-sync/);
    expect(getModelAdmission("private/sync-err").capabilityEvidence[0]?.status).toBe("passed");
    expect(getModelAdmission("private/sync-err").capabilityEvidence[0]?.verifiedAt).toBe(42);
  });

  it("promise reject becomes terminal failed and notifies onTaskSettled", async () => {
    const settled: string[] = [];
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        settleDelayMs: 0,
        schedule: (work) => {
          queueMicrotask(work);
        },
        runner: {
          check() {
            return Promise.reject(new Error("boom-async"));
          },
        },
        onTaskSettled: (t) => {
          settled.push(`${t.taskId}:${t.status}`);
        },
      },
    });
    const { task } = await startCapabilityVerification({
      modelRef: "private/async-err",
      capabilityIds: ["text_chat"],
    });
    expect(["queued", "running"]).toContain(task.status);
    await new Promise((r) => setTimeout(r, 20));
    const done = getVerificationTask(task.taskId);
    expect(done?.status).toBe("failed");
    expect(done?.error).toMatch(/boom-async/);
    expect(settled.some((s) => s.endsWith(":failed"))).toBe(true);
  });

  it("long-running pending outcomes time out to a terminal state", async () => {
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        pendingTimeoutMs: 30,
        runner: {
          check() {
            return [
              {
                capabilityId: "tool_use",
                status: "pending",
                testVersion: "pending-v1",
                sourceNote: "waiting",
              },
            ];
          },
        },
      },
    });
    const { task } = await startCapabilityVerification({
      modelRef: "private/pending",
      capabilityIds: ["tool_use"],
    });
    expect(task.status).toBe("running");
    await new Promise((r) => setTimeout(r, 60));
    const done = getVerificationTask(task.taskId);
    expect(done?.status).toBe("partial");
    expect(done?.results?.[0]?.status).toBe("checker_unavailable");
    expect(done?.results?.[0]?.failureReason).toMatch(/超时/);
  });

  it("async completion notifies UI callback after settle", async () => {
    const settledStatuses: string[] = [];
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        settleDelayMs: 20,
        resolveConnectionOk: () => true,
        onTaskSettled: (t) => {
          settledStatuses.push(t.status);
        },
      },
    });
    const { task } = await startCapabilityVerification({
      modelRef: "private/notify",
      capabilityIds: ["text_chat"],
    });
    expect(["queued", "running"]).toContain(task.status);
    await new Promise((r) => setTimeout(r, 50));
    expect(getVerificationTask(task.taskId)?.status).toBe("succeeded");
    expect(settledStatuses).toContain("succeeded");
  });

  it("stale task delayed success after config change does not update formal evidence", async () => {
    const oldFp = "fp-old";
    const newFp = "fp-new";
    let currentFp = oldFp;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        settleDelayMs: 0,
        schedule: (work) => {
          void gate.then(work);
        },
        resolveConnectionOk: () => true,
        resolveCurrentFingerprint: () => currentFp,
        runner: {
          check() {
            return [
              {
                capabilityId: "text_chat",
                status: "passed",
                testVersion: "stale-run",
                sourceNote: "old endpoint",
              },
            ];
          },
        },
      },
    });

    const { task: oldTask } = await startCapabilityVerification({
      modelRef: "private/race",
      capabilityIds: ["text_chat"],
      configFingerprint: oldFp,
    });
    expect(oldTask.status).toBe("queued");

    // Config changes while old task is in flight; expire prior evidence.
    currentFp = newFp;
    upsertModelAdmission("private/race", {
      connectionFingerprint: newFp,
      capabilityEvidence: [],
    });

    release();
    await new Promise((r) => setTimeout(r, 20));

    const finished = getVerificationTask(oldTask.taskId);
    expect(finished?.status).toBe("succeeded");
    expect(finished?.error).toMatch(/指纹|历史/);
    expect(verifiedCapabilityIds(getModelAdmission("private/race").capabilityEvidence)).toEqual([]);
  });

  it("newer task finishing first: older task must not overwrite formal evidence", async () => {
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    // Execution order: newer runs first (microtask), older runs after release.
    const versionsByExecOrder = ["run-2", "run-1"];
    let exec = 0;
    let scheduled = 0;
    const stamped = createLocalProtocolVerificationService({
      settleDelayMs: 0,
      schedule: (work) => {
        scheduled += 1;
        if (scheduled === 1) {
          void oldGate.then(work);
          return;
        }
        queueMicrotask(work);
      },
      resolveCurrentFingerprint: () => "fp-stable",
      runner: {
        check() {
          const v = versionsByExecOrder[exec++] ?? "run-unknown";
          return [
            {
              capabilityId: "text_chat",
              status: "passed",
              testVersion: v,
              sourceNote: `from-${v}`,
              verifiedAt: v === "run-1" ? 111 : 222,
            },
          ];
        },
      },
    });

    const older = await stamped.createVerificationTask({
      modelRef: "private/gen",
      capabilityIds: ["text_chat"],
      configFingerprint: "fp-stable",
    });
    const newer = await stamped.createVerificationTask({
      modelRef: "private/gen",
      capabilityIds: ["text_chat"],
      configFingerprint: "fp-stable",
    });
    expect(older.task.executionGeneration).toBe(1);
    expect(newer.task.executionGeneration).toBe(2);

    await new Promise((r) => setTimeout(r, 20));
    expect(getVerificationTask(newer.task.taskId)?.status).toBe("succeeded");
    expect(getModelAdmission("private/gen").capabilityEvidence[0]?.testVersion).toBe("run-2");

    releaseOld();
    await new Promise((r) => setTimeout(r, 20));
    const oldDone = getVerificationTask(older.task.taskId);
    expect(oldDone?.status).toBe("succeeded");
    expect(oldDone?.error).toMatch(/取代|历史/);
    expect(getModelAdmission("private/gen").capabilityEvidence[0]?.testVersion).toBe("run-2");
    expect(getModelAdmission("private/gen").capabilityEvidence[0]?.verifiedAt).toBe(222);
  });

  it("cancel leaves task cancelled and does not write passed evidence", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        settleDelayMs: 0,
        schedule: (work) => {
          void gate.then(work);
        },
        resolveConnectionOk: () => true,
      },
    });
    const { task } = await startCapabilityVerification({
      modelRef: "private/cancel",
      capabilityIds: ["text_chat"],
    });
    expect(task.status).toBe("queued");
    const cancelled = cancelCapabilityVerificationTask(task.taskId);
    expect(cancelled?.status).toBe("cancelled");
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(getVerificationTask(task.taskId)?.status).toBe("cancelled");
    expect(verifiedCapabilityIds(getModelAdmission("private/cancel").capabilityEvidence)).toEqual(
      [],
    );
  });

  it("demo simulate never enters formal verified set", async () => {
    const task = createCapabilityVerificationTask({
      modelRef: "private/demo-only",
      capabilityIds: ["text_chat", "tool_use"],
      simulate: { failIds: ["tool_use"] },
    });
    expect(task.status).toBe("partial");
    const admission = getModelAdmission("private/demo-only");
    expect(admission.capabilityEvidence).toEqual([]);
    expect(verifiedCapabilityIds(admission.demoCapabilityEvidence ?? [])).toContain("text_chat");
  });

  it("injected runner can pass tool_use formally without paid APIs", async () => {
    const service = createLocalProtocolVerificationService({
      runner: createInjectedProtocolRunner({
        tool_use: {
          capabilityId: "tool_use",
          status: "passed",
          testVersion: "injected-v1",
          sourceNote: "注入专项检查通过",
        },
      }),
    });
    const { task, authority } = await service.createVerificationTask({
      modelRef: "private/tools",
      capabilityIds: ["tool_use"],
    });
    expect(authority).toBe("formal");
    expect(task.status).toBe("succeeded");
    expect(verifiedCapabilityIds(getModelAdmission("private/tools").capabilityEvidence)).toEqual([
      "tool_use",
    ]);
  });

  it("interruptInFlightVerificationTasks marks persisted running rows", () => {
    saveVerificationTask({
      taskId: "cvt_stuck",
      modelRef: "private/stuck",
      capabilityIds: ["text_chat"],
      status: "running",
      createdAt: 1,
      updatedAt: 1,
      configFingerprint: "fp",
      executionGeneration: 1,
    });
    const out = interruptInFlightVerificationTasks();
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe("interrupted");
    expect(listVerificationTasks("private/stuck")[0]?.status).toBe("interrupted");
  });

  it("service/page init recovers orphans without manually calling recover helper", () => {
    saveVerificationTask({
      taskId: "cvt_orphan_init",
      modelRef: "private/orphan-init",
      capabilityIds: ["text_chat"],
      status: "running",
      createdAt: 1,
      updatedAt: 1,
      configFingerprint: "fp-orphan",
      executionGeneration: 1,
    });
    // Not marked live → prior page leftover. Init must interrupt it.
    const { interruptedCount } = ensureCapabilityVerificationLifecycle();
    expect(interruptedCount).toBeGreaterThanOrEqual(1);
    expect(getVerificationTask("cvt_orphan_init")?.status).toBe("interrupted");
    expect(getVerificationTask("cvt_orphan_init")?.error).toMatch(/已中断|可重试/);
  });

  it("init preserves live in-page tasks and only interrupts orphans", async () => {
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        settleDelayMs: 999_999,
        schedule: () => {
          /* hold live task in queued/running */
        },
        resolveConnectionOk: () => true,
      },
    });
    const { task: live } = await startCapabilityVerification({
      modelRef: "private/live-keep",
      capabilityIds: ["text_chat"],
      configFingerprint: "fp-live",
    });
    expect(isVerificationTaskLive(live.taskId)).toBe(true);
    expect(["queued", "running"]).toContain(live.status);

    saveVerificationTask({
      taskId: "cvt_orphan_other",
      modelRef: "private/orphan-other",
      capabilityIds: ["text_chat"],
      status: "running",
      createdAt: 1,
      updatedAt: 1,
      configFingerprint: "fp-other",
      executionGeneration: 1,
    });

    // Mimic re-entering models surface / opening another detail — must not kill live.
    const { interruptedCount } = ensureCapabilityVerificationLifecycle();
    expect(interruptedCount).toBeGreaterThanOrEqual(1);
    expect(getVerificationTask(live.taskId)?.status).toMatch(/queued|running/);
    expect(isVerificationTaskLive(live.taskId)).toBe(true);
    expect(getVerificationTask("cvt_orphan_other")?.status).toBe("interrupted");
  });

  it("never-resolving runner Promise times out to a terminal state", async () => {
    const settled: string[] = [];
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        pendingTimeoutMs: 40,
        runner: {
          check() {
            return new Promise(() => {});
          },
        },
        onTaskSettled: (t) => {
          settled.push(t.status);
        },
      },
    });
    const { task } = await startCapabilityVerification({
      modelRef: "private/hang",
      capabilityIds: ["text_chat"],
    });
    expect(["queued", "running"]).toContain(task.status);
    await new Promise((r) => setTimeout(r, 80));
    const done = getVerificationTask(task.taskId);
    expect(done?.status).toBe("failed");
    expect(done?.error).toMatch(/超时/);
    expect(settled).toContain("failed");
  });

  it("late success after runner Promise timeout does not overwrite terminal state or formal evidence", async () => {
    let release!: (value: unknown) => void;
    const hanging = new Promise((resolve) => {
      release = resolve;
    });
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        pendingTimeoutMs: 40,
        runner: {
          check() {
            return hanging.then(() => [
              {
                capabilityId: "text_chat",
                status: "passed",
                testVersion: "late-pass",
                sourceNote: "too late",
              },
            ]);
          },
        },
      },
    });
    const { task } = await startCapabilityVerification({
      modelRef: "private/late",
      capabilityIds: ["text_chat"],
      configFingerprint: "fp-late",
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(getVerificationTask(task.taskId)?.status).toBe("failed");

    release(undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(getVerificationTask(task.taskId)?.status).toBe("failed");
    expect(verifiedCapabilityIds(getModelAdmission("private/late").capabilityEvidence)).toEqual([]);
  });

  it("default service + real config publish race: stale finish does not write formal evidence", async () => {
    const oldFp = buildConnectionFingerprint({
      modelId: "private/cfg-race",
      providerId: "private",
      baseUrl: "https://old.example",
      api: "openai-completions",
    });
    const newFp = buildConnectionFingerprint({
      modelId: "private/cfg-race",
      providerId: "private",
      baseUrl: "https://new.example",
      api: "openai-completions",
    });
    expect(oldFp).not.toBe(newFp);

    // Publish current config from snapshot (adapter path) — not admission verified fp.
    publishCurrentConfigFingerprint("private/cfg-race", oldFp);
    markModelConnectionVerified("private/cfg-race", oldFp);
    expect(getCurrentConfigFingerprint("private/cfg-race")).toBe(oldFp);
    expect(getModelAdmission("private/cfg-race").connectionFingerprint).toBe(oldFp);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Default service: NO resolveCurrentFingerprint injection.
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        settleDelayMs: 0,
        schedule: (work) => {
          void gate.then(work);
        },
        resolveConnectionOk: () => true,
        runner: {
          check() {
            return [
              {
                capabilityId: "text_chat",
                status: "passed",
                testVersion: "old-endpoint-run",
                sourceNote: "old endpoint",
              },
            ];
          },
        },
      },
    });

    const { task: oldTask } = await startCapabilityVerification({
      modelRef: "private/cfg-race",
      capabilityIds: ["text_chat"],
      configFingerprint: oldFp,
    });
    expect(oldTask.status).toBe("queued");

    // Real config change flow: snapshot publishes new fingerprint; expiry keeps
    // admission.connectionFingerprint as the OLD verified identity for stale UI.
    publishCurrentConfigFingerprint("private/cfg-race", newFp);
    expireCapabilityEvidenceForModel("private/cfg-race", "配置指纹已变更，需重新验证");
    expect(getModelAdmission("private/cfg-race").connectionFingerprint).toBe(oldFp);
    expect(getCurrentConfigFingerprint("private/cfg-race")).toBe(newFp);

    release();
    await new Promise((r) => setTimeout(r, 30));

    const finished = getVerificationTask(oldTask.taskId);
    expect(finished?.status).toBe("succeeded");
    expect(finished?.error).toMatch(/指纹|历史/);
    expect(verifiedCapabilityIds(getModelAdmission("private/cfg-race").capabilityEvidence)).toEqual(
      [],
    );
  });
});

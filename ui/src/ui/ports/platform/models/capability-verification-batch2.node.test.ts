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
  upsertModelAdmission,
} from "./model-admission-store.ts";
import {
  __resetModelConnectionSessionForTest,
  buildConnectionFingerprint,
  markModelConnectionVerified,
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

  it("connection ok but tool_use fails — formal partial evidence", async () => {
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
    expect(task.results?.find((r) => r.id === "tool_use")?.status).toBe("failed");
    expect(task.results?.find((r) => r.id === "tool_use")?.failureReason).toMatch(/工具/);

    const admission = getModelAdmission("private/demo");
    expect(verifiedCapabilityIds(admission.capabilityEvidence)).toEqual(["text_chat"]);
    expect(admission.demoCapabilityEvidence ?? []).toEqual([]);
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

  it("image/music taskId-only (no artifact) fails formally", async () => {
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: { resolveConnectionOk: () => true },
    });
    const { task } = await startCapabilityVerification({
      modelRef: "private/img",
      capabilityIds: ["image_generation", "music_generation"],
    });
    expect(task.status).toBe("failed");
    for (const r of task.results ?? []) {
      expect(r.status).toBe("failed");
      expect(r.failureReason).toMatch(/taskId|产物/);
    }
    expect(verifiedCapabilityIds(getModelAdmission("private/img").capabilityEvidence)).toEqual([]);
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

    // One success must not flip either model's platform routing to eligible.
    const routeA = await setModelRoutingEligibility({
      modelRef: "private/a",
      autoRouting: "eligible",
    });
    expect(routeA.status).toBe("not_wired");
    expect(routeA.message).toMatch(/尚未接入|草稿/);
  });

  it("persists taskId and recovers after refresh", async () => {
    configureCapabilityVerificationService({
      mode: "local_protocol",
      local: {
        settleDelayMs: 50,
        resolveConnectionOk: () => true,
      },
    });
    const { task } = await startCapabilityVerification({
      modelRef: "private/async",
      capabilityIds: ["text_chat"],
    });
    expect(["queued", "running", "succeeded"]).toContain(task.status);
    const restored = getVerificationTask(task.taskId);
    expect(restored?.taskId).toBe(task.taskId);
    expect(listVerificationTasks("private/async").some((t) => t.taskId === task.taskId)).toBe(true);

    const recovered = await recoverActiveVerificationTask("private/async");
    expect(recovered?.taskId).toBe(task.taskId);

    // Wait for settle if still in flight.
    if (task.status === "queued" || task.status === "running") {
      await new Promise((r) => setTimeout(r, 80));
    }
    const done = getVerificationTask(task.taskId);
    expect(done?.status).toBe("succeeded");
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

  it("demo simulate never enters formal verified set", () => {
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

  it("injected runner can pass tool_use formally without paid APIs", () => {
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
    const { task, authority } = service.createVerificationTask({
      modelRef: "private/tools",
      capabilityIds: ["tool_use"],
    });
    expect(authority).toBe("formal");
    expect(task.status).toBe("succeeded");
    expect(verifiedCapabilityIds(getModelAdmission("private/tools").capabilityEvidence)).toEqual([
      "tool_use",
    ]);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { previewRoutingDecision } from "./routing-decision.js";
import {
  __resetCapabilityAdmissionStoreForTest,
  __setCapabilityAdmissionStorePathForTest,
  getModelAdmission,
  upsertModelAdmission,
} from "./store.js";
import type { ProtocolCheckOutcome } from "./types.js";
import { createGatewayVerificationService } from "./verification-service.js";

async function waitTerminal(
  service: ReturnType<typeof createGatewayVerificationService>,
  taskId: string,
  timeoutMs = 5_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await service.getVerificationTask(taskId);
    if (task && task.status !== "queued" && task.status !== "running") {
      // First terminal observation is the contract surface: callers must not
      // need an extra flush/sleep for evidence or history-only error.
      return task;
    }
    // Do not flush ALL background work: concurrent gated runners would deadlock.
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`task ${taskId} did not reach terminal state within ${timeoutMs}ms`);
}

describe("gateway capability admission", () => {
  let storePath = "";

  beforeEach(async () => {
    storePath = path.join(
      os.tmpdir(),
      `openbot-admission-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    __setCapabilityAdmissionStorePathForTest(storePath);
    await __resetCapabilityAdmissionStoreForTest(storePath);
  });

  afterEach(() => {
    __setCapabilityAdmissionStorePathForTest(undefined);
    try {
      fs.unlinkSync(storePath);
    } catch {
      // ignore
    }
  });

  it("creates formal verification without inventing tool_use failure", async () => {
    const service = createGatewayVerificationService({
      storePath,
      resolveConnectionOk: () => true,
      interruptOrphansOnCreate: false,
    });
    const { task: created, authority } = await service.createVerificationTask({
      modelRef: "openai/gpt-test",
      capabilityIds: ["text_chat", "tool_use"],
    });
    expect(authority).toBe("formal");
    expect(created.taskId).toBeTruthy();
    const task = await waitTerminal(service, created.taskId);
    expect(task.status).toBe("partial");
    const text = task.results?.find((r) => r.id === "text_chat");
    const tools = task.results?.find((r) => r.id === "tool_use");
    expect(text?.status).toBe("passed");
    expect(tools?.status).toBe("checker_unavailable");
    const admission = await getModelAdmission("openai/gpt-test", storePath);
    expect(
      admission.capabilityEvidence.some((e) => e.id === "text_chat" && e.status === "passed"),
    ).toBe(true);
    expect(
      admission.capabilityEvidence.some((e) => e.id === "tool_use" && e.status === "failed"),
    ).toBe(false);
  });

  it("rejects client-forged connectionOk=true for formal text_chat passed", async () => {
    const service = createGatewayVerificationService({
      storePath,
      // No resolveConnectionOk — client claim alone must not mint passed.
      interruptOrphansOnCreate: false,
    });
    const { task: created } = await service.createVerificationTask({
      modelRef: "openai/forged",
      capabilityIds: ["text_chat"],
      connectionOk: true,
    });
    const task = await waitTerminal(service, created.taskId);
    const text = task.results?.find((r) => r.id === "text_chat");
    expect(text?.status).not.toBe("passed");
    expect(text?.status).toBe("failed");
    const admission = await getModelAdmission("openai/forged", storePath);
    expect(
      admission.capabilityEvidence.some((e) => e.id === "text_chat" && e.status === "passed"),
    ).toBe(false);
  });

  it("returns checker_unavailable for specialized caps without a checker", async () => {
    const service = createGatewayVerificationService({
      storePath,
      resolveConnectionOk: () => true,
      interruptOrphansOnCreate: false,
    });
    const { task: created } = await service.createVerificationTask({
      modelRef: "openai/media",
      capabilityIds: ["image_generation", "music_generation", "coding"],
      connectionOk: true,
    });
    const task = await waitTerminal(service, created.taskId);
    expect(task.status).toBe("partial");
    for (const id of ["image_generation", "music_generation", "coding"] as const) {
      const item = task.results?.find((r) => r.id === id);
      expect(item?.status).toBe("checker_unavailable");
    }
    const admission = await getModelAdmission("openai/media", storePath);
    expect(
      admission.capabilityEvidence.some(
        (e) =>
          (e.id === "image_generation" || e.id === "music_generation" || e.id === "coding") &&
          e.status === "passed",
      ),
    ).toBe(false);
  });

  it("returns taskId promptly while runner is still in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = createGatewayVerificationService({
      storePath,
      interruptOrphansOnCreate: false,
      runner: {
        async check(ctx) {
          await gate;
          return ctx.capabilityIds.map(
            (id): ProtocolCheckOutcome => ({
              capabilityId: id,
              status: "passed",
              testVersion: "gateway-protocol-v1",
              verifiedAt: Date.now(),
            }),
          );
        },
      },
    });
    const started = Date.now();
    const { task } = await service.createVerificationTask({
      modelRef: "openai/async",
      capabilityIds: ["coding"],
    });
    expect(Date.now() - started).toBeLessThan(500);
    expect(task.taskId).toMatch(/^gcvt_/);
    expect(["queued", "running"]).toContain(task.status);
    release();
    const done = await waitTerminal(service, task.taskId);
    expect(done.status).toBe("succeeded");
  });

  it("cancel wins over late runner success and does not pollute formal evidence", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = createGatewayVerificationService({
      storePath,
      interruptOrphansOnCreate: false,
      runner: {
        async check(ctx) {
          await gate;
          return ctx.capabilityIds.map(
            (id): ProtocolCheckOutcome => ({
              capabilityId: id,
              status: "passed",
              testVersion: "gateway-protocol-v1",
              verifiedAt: Date.now(),
            }),
          );
        },
      },
    });
    const { task: created } = await service.createVerificationTask({
      modelRef: "openai/cancel-race",
      capabilityIds: ["text_chat"],
    });
    const cancelled = await service.cancelVerificationTask(created.taskId);
    expect(cancelled?.status).toBe("cancelled");
    release();
    await service.__flushBackgroundForTest();
    const final = await service.getVerificationTask(created.taskId);
    expect(final?.status).toBe("cancelled");
    const admission = await getModelAdmission("openai/cancel-race", storePath);
    expect(
      admission.capabilityEvidence.some((e) => e.id === "text_chat" && e.status === "passed"),
    ).toBe(false);
  });

  it("publishes terminal status with evidence or stale reason in the same store write", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = createGatewayVerificationService({
      storePath,
      interruptOrphansOnCreate: false,
      resolveConnectionOk: () => true,
      runner: {
        async check(ctx) {
          await gate;
          return ctx.capabilityIds.map(
            (id): ProtocolCheckOutcome => ({
              capabilityId: id,
              status: "passed",
              testVersion: "gateway-protocol-v1",
              verifiedAt: Date.now(),
            }),
          );
        },
      },
    });
    const { task: created } = await service.createVerificationTask({
      modelRef: "openai/atomic-publish",
      capabilityIds: ["coding"],
      configFingerprint: "fp-atomic",
    });
    release();
    // First terminal read must already see formal evidence — no extra wait/flush.
    const done = await waitTerminal(service, created.taskId);
    expect(done.status).toBe("succeeded");
    expect(done.error).toBeUndefined();
    const admission = await getModelAdmission("openai/atomic-publish", storePath);
    expect(
      admission.capabilityEvidence.some((e) => e.id === "coding" && e.status === "passed"),
    ).toBe(true);
  });

  it("fingerprint change keeps late results in history only", async () => {
    let currentFp = "fp-v1";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = createGatewayVerificationService({
      storePath,
      interruptOrphansOnCreate: false,
      resolveCurrentFingerprint: () => currentFp,
      runner: {
        async check(ctx) {
          await gate;
          return ctx.capabilityIds.map(
            (id): ProtocolCheckOutcome => ({
              capabilityId: id,
              status: "passed",
              testVersion: "gateway-protocol-v1",
              verifiedAt: Date.now(),
            }),
          );
        },
      },
    });
    const { task: created } = await service.createVerificationTask({
      modelRef: "openai/fp",
      capabilityIds: ["coding"],
      configFingerprint: "fp-v1",
    });
    currentFp = "fp-v2";
    release();
    // First terminal observation must already carry the history-only reason.
    const done = await waitTerminal(service, created.taskId);
    expect(done.results?.some((r) => r.id === "coding" && r.status === "passed")).toBe(true);
    expect(done.error).toMatch(/指纹/);
    const admission = await getModelAdmission("openai/fp", storePath);
    expect(
      admission.capabilityEvidence.some((e) => e.id === "coding" && e.status === "passed"),
    ).toBe(false);
  });

  it("older generation late finish does not overwrite newer formal evidence", async () => {
    const gateByFp = new Map<string, { promise: Promise<void>; release: () => void }>();
    for (const fp of ["gen-old", "gen-new"]) {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      gateByFp.set(fp, { promise, release });
    }
    const service = createGatewayVerificationService({
      storePath,
      interruptOrphansOnCreate: false,
      // Keep fingerprint check from firing; this test isolates generation.
      resolveCurrentFingerprint: () => undefined,
      runner: {
        async check(ctx) {
          const fp = ctx.configFingerprint ?? "";
          await gateByFp.get(fp)?.promise;
          const status = fp === "gen-old" ? ("passed" as const) : ("failed" as const);
          return ctx.capabilityIds.map(
            (id): ProtocolCheckOutcome => ({
              capabilityId: id,
              status,
              testVersion: "gateway-protocol-v1",
              verifiedAt: Date.now(),
              failureReason: status === "failed" ? "gen2 failed" : undefined,
            }),
          );
        },
      },
    });
    const first = await service.createVerificationTask({
      modelRef: "openai/gen",
      capabilityIds: ["coding"],
      configFingerprint: "gen-old",
    });
    const second = await service.createVerificationTask({
      modelRef: "openai/gen",
      capabilityIds: ["coding"],
      configFingerprint: "gen-new",
    });
    // Finish newer generation first so it can merge.
    gateByFp.get("gen-new")!.release();
    const newer = await waitTerminal(service, second.task.taskId);
    expect(newer.status).toBe("failed");
    const mid = await getModelAdmission("openai/gen", storePath);
    expect(mid.capabilityEvidence.some((e) => e.id === "coding" && e.status === "failed")).toBe(
      true,
    );
    // Late success from older generation must not replace newer failed evidence.
    gateByFp.get("gen-old")!.release();
    // First terminal observation must already carry the superseded reason.
    const older = await waitTerminal(service, first.task.taskId);
    expect(older.error).toMatch(/取代|代次|generation|历史/i);
    const admission = await getModelAdmission("openai/gen", storePath);
    expect(
      admission.capabilityEvidence.some((e) => e.id === "coding" && e.status === "failed"),
    ).toBe(true);
    expect(
      admission.capabilityEvidence.some((e) => e.id === "coding" && e.status === "passed"),
    ).toBe(false);
  });

  it("runner wall-clock timeout yields failed without formal passed", async () => {
    const service = createGatewayVerificationService({
      storePath,
      interruptOrphansOnCreate: false,
      runnerTimeoutMs: 40,
      runner: {
        async check(ctx) {
          await new Promise((r) => setTimeout(r, 500));
          return ctx.capabilityIds.map(
            (id): ProtocolCheckOutcome => ({
              capabilityId: id,
              status: "passed",
              testVersion: "gateway-protocol-v1",
              verifiedAt: Date.now(),
            }),
          );
        },
      },
    });
    const { task: created } = await service.createVerificationTask({
      modelRef: "openai/timeout",
      capabilityIds: ["coding"],
    });
    const done = await waitTerminal(service, created.taskId, 3_000);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/超时/);
    const admission = await getModelAdmission("openai/timeout", storePath);
    expect(
      admission.capabilityEvidence.some((e) => e.id === "coding" && e.status === "passed"),
    ).toBe(false);
  });

  it("applies routing eligibility as platform-effective", async () => {
    const service = createGatewayVerificationService({
      storePath,
      interruptOrphansOnCreate: false,
    });
    const result = await service.setRoutingEligibility({
      modelRef: "openai/gpt-test",
      autoRouting: "eligible",
      tenantSelectable: true,
      reason: "test",
    });
    expect(result.status).toBe("applied");
    expect(result.admission.platformEffective).toBe(true);
    expect(result.admission.autoRouting).toBe("eligible");
    expect(result.admission.tenantSelectable).toBe(true);
  });

  it("previewRoutingDecision uses backend admissions and stays dry-run", async () => {
    const service = createGatewayVerificationService({
      storePath,
      resolveConnectionOk: () => true,
      interruptOrphansOnCreate: false,
    });
    const created = await service.createVerificationTask({
      modelRef: "private/c",
      capabilityIds: ["coding", "text_chat"],
    });
    await waitTerminal(service, created.task.taskId);
    await service.setRoutingEligibility({
      modelRef: "private/c",
      autoRouting: "eligible",
      reason: "test",
    });
    const injected = createGatewayVerificationService({
      storePath,
      interruptOrphansOnCreate: false,
      runner: {
        check(ctx) {
          return ctx.capabilityIds.map((id) =>
            id === "coding"
              ? {
                  capabilityId: id,
                  status: "passed" as const,
                  testVersion: "gateway-protocol-v1",
                  verifiedAt: Date.now(),
                }
              : {
                  capabilityId: id,
                  status: "untested" as const,
                  testVersion: "gateway-protocol-v1",
                },
          );
        },
      },
    });
    const codingTask = await injected.createVerificationTask({
      modelRef: "private/c",
      capabilityIds: ["coding"],
    });
    await waitTerminal(injected, codingTask.task.taskId);

    const preview = await previewRoutingDecision({
      storePath,
      request: {
        taskText: "refactor this module",
        outputType: "text",
        requiredCapabilities: ["code"],
      },
      candidates: [
        { modelId: "private/c", health: "healthy", costTier: "low", contextWindow: 200_000 },
        { modelId: "private/other", health: "healthy", costTier: "low", contextWindow: 200_000 },
      ],
    });
    expect(preview.backendStatus).toBe("wired");
    expect(preview.uiDemo).toBe(false);
    expect(preview.dryRun).toBe(true);
    expect(preview.primary).toEqual(["private/c"]);
    expect(preview.excluded.some((e) => e.modelId === "private/other")).toBe(true);
  });

  it("reuses fingerprint-bound formal text_chat without client connectionOk", async () => {
    await upsertModelAdmission(
      "openai/reuse",
      {
        connectionFingerprint: "bound-fp",
        connectionVerifiedAt: Date.now() - 1_000,
        capabilityEvidence: [
          {
            id: "text_chat",
            label: "文本对话",
            source: "protocol_probe",
            status: "passed",
            verifiedAt: Date.now() - 1_000,
            testVersion: "gateway-protocol-v1",
          },
        ],
      },
      storePath,
    );
    const service = createGatewayVerificationService({
      storePath,
      interruptOrphansOnCreate: false,
    });
    const { task: created } = await service.createVerificationTask({
      modelRef: "openai/reuse",
      capabilityIds: ["text_chat"],
      configFingerprint: "bound-fp",
      connectionOk: true, // still ignored; reuse comes from bound evidence
    });
    const task = await waitTerminal(service, created.taskId);
    expect(task.results?.find((r) => r.id === "text_chat")?.status).toBe("passed");
    expect(task.results?.find((r) => r.id === "text_chat")?.sourceNote).toMatch(
      /绑定指纹|正式证据/,
    );
  });
});

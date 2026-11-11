import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUCTION_EXECUTION_MODE_ENV } from "../agents/sandbox/production-execution-mode.js";
import { DIAGNOSIS_JOBS_DIR } from "./diagnosis-job-model.js";
import { diagnosisJobTenantHash16, writeDiagnosisScheduleBinding } from "./diagnosis-job-store.js";
import {
  describeDiagnosisJob,
  pauseDiagnosisJob,
  resumeDiagnosisJob,
  startDiagnosisJobRun,
} from "./diagnosis-job.js";
import { createDiagnosisHandlingGatewayHandlers } from "./handling-loop-gateway.js";
import {
  createFileHandlingStore,
  createMemoryHandlingStore,
  createTenantFileHandlingStore,
  DIAGNOSIS_HANDLING_SINGLE_WRITER_VIOLATION,
  writeHandlingSnapshotAtomic,
  type HandlingStore,
} from "./handling-loop-store.js";
import {
  DIAGNOSIS_HANDLING_EXECUTION_INTERFACE,
  DIAGNOSIS_HANDLING_ISOLATION_ENV,
  DIAGNOSIS_HANDLING_SCENARIO_ID,
  buildHandlingAdminView,
  createDiagnosisHandlingLoop,
  handlingStateLabel,
  isDiagnosisHandlingExecuteOpen,
  seedPausedDiagnosisJob,
  type HandlingActor,
  type HandlingRecord,
} from "./handling-loop.js";
import { DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED } from "./production-cutover.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-handling-loop-"));
  tmpDirs.push(dir);
  return dir;
}

function actor(patch: Partial<HandlingActor> = {}): HandlingActor {
  return {
    operatorId: "op-write",
    tenantId: "tenant-a",
    scopes: ["operator.read", "operator.write", "operator.admin"],
    ...patch,
  };
}

function approver(): HandlingActor {
  return actor({ operatorId: "op-approve", scopes: ["operator.read", "operator.approvals"] });
}

function loop(configDir: string, isolation = true) {
  return createDiagnosisHandlingLoop({ configDir, isolation });
}

function seed(configDir: string, who: HandlingActor = actor()) {
  const paused = seedPausedDiagnosisJob({ actor: who, configDir });
  expect(paused.ok).toBe(true);
  return paused;
}

describe("diagnosis handling loop · diagnosis_job_paused", () => {
  it("keeps production repair and self-evolution flags closed", () => {
    const isolatedDir = tmp();
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(
      isDiagnosisHandlingExecuteOpen({
        isolation: false,
        env: {
          [PRODUCTION_EXECUTION_MODE_ENV]: "production",
          [DIAGNOSIS_HANDLING_ISOLATION_ENV]: "1",
        },
      }),
    ).toBe(false);
    expect(isDiagnosisHandlingExecuteOpen({ isolation: false, env: {} })).toBe(false);
    expect(isDiagnosisHandlingExecuteOpen({ isolation: true, env: {} })).toBe(false);
    expect(
      isDiagnosisHandlingExecuteOpen({
        isolation: true,
        registrationPath: "isolation",
        configDir: isolatedDir,
        env: {},
      }),
    ).toBe(true);
  });

  it("exposes unified admin language and keeps technical ids in details", () => {
    const view = buildHandlingAdminView({ tenantId: "tenant-a", status: "pending_approval" });
    expect(view.whatHappened).toContain("已暂停");
    expect(view.whoIsAffected).toContain("tenant-a");
    expect(view.suggestedHandling).toContain(DIAGNOSIS_HANDLING_EXECUTION_INTERFACE);
    expect(view.whoCanApprove).toContain("operator.approvals");
    expect(view.currentStep).toBe("待审批");
    expect(view.howToConfirmRecovery).toContain("diagnosis.job.describe");
    expect(handlingStateLabel("result_unverified")).toBe("结果待核实");
  });

  it("completes the normal isolated path: submit, approve, execute, recheck, resolved", () => {
    const configDir = tmp();
    seed(configDir);
    const before = describeDiagnosisJob({
      caller: { membershipTenantId: "tenant-a", claimedTenantId: null },
      configDir,
    });
    expect(before.ok).toBe(true);
    if (before.ok) {
      expect(before.binding?.paused).toBe(true);
    }
    const machine = loop(configDir);
    const previewed = machine.preview(actor());
    expect(previewed.ok).toBe(true);
    expect(previewed.preview?.actionable).toBe(true);
    expect(previewed.preview?.evidence.paused).toBe(true);
    expect(previewed.preview?.evidence.runBlockedReason).toBe("paused_blocks_new_run");
    const submitted = machine.submit({ actor: actor() });
    expect(submitted.record?.status).toBe("pending_approval");
    expect(submitted.record?.scenarioId).toBe(DIAGNOSIS_HANDLING_SCENARIO_ID);
    expect(submitted.admin?.currentStep).toBe("待审批");
    const approved = machine.approve({
      actor: approver(),
      handlingId: submitted.record!.handlingId,
    });
    expect(approved.record?.status).toBe("pending_execution");
    expect(approved.admin?.currentStep).toBe("待执行");
    const executed = machine.execute({
      actor: actor({ operatorId: "op-exec" }),
      handlingId: submitted.record!.handlingId,
    });
    expect(executed.record?.status).toBe("executed_pending_recheck");
    expect(executed.record?.execution?.applied).toBe(true);
    expect(executed.record?.execution?.receipt.interfaceId).toBe("diagnosis.job.resume");
    const after = describeDiagnosisJob({
      caller: { membershipTenantId: "tenant-a", claimedTenantId: null },
      configDir,
    });
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.binding?.paused).toBe(false);
    }
    const unblocked = startDiagnosisJobRun({
      caller: { membershipTenantId: "tenant-a", claimedTenantId: null },
      configDir,
      evidenceRows: [],
    });
    expect(unblocked.ok).toBe(true);
    const rechecked = machine.recheck({
      actor: actor(),
      handlingId: submitted.record!.handlingId,
    });
    expect(rechecked.record?.status).toBe("resolved");
    expect(rechecked.record?.recheck?.met).toBe(true);
    expect(rechecked.admin?.currentStep).toBe("已解决");
    expect(rechecked.details?.handlingId).toBe(submitted.record?.handlingId);
  });

  it("rejects approval when the operator lacks approval scope", () => {
    const configDir = tmp();
    seed(configDir);
    const machine = loop(configDir);
    const submitted = machine.submit({
      actor: actor({ scopes: ["operator.read", "operator.write"] }),
    });
    const rejectedAuth = machine.approve({
      actor: actor({ operatorId: "writer-only", scopes: ["operator.read", "operator.write"] }),
      handlingId: submitted.record!.handlingId,
    });
    expect(rejectedAuth.ok).toBe(false);
    expect(rejectedAuth.reason).toBe("authorization_revoked");
    expect(rejectedAuth.record?.status).toBe("pending_approval");
    const rejected = machine.reject({
      actor: approver(),
      handlingId: submitted.record!.handlingId,
    });
    expect(rejected.ok).toBe(true);
    expect(rejected.record?.status).toBe("rejected");
    expect(rejected.admin?.currentStep).toBe("已拒绝");
  });

  it("does not re-execute on repeat clicks and reuses the idempotency key", () => {
    const configDir = tmp();
    seed(configDir);
    let resumeCalls = 0;
    const machine = createDiagnosisHandlingLoop({
      configDir,
      isolation: true,
      resume: (input) => {
        resumeCalls += 1;
        return resumeDiagnosisJob(input);
      },
    });
    const first = machine.submit({ actor: actor(), idempotencyKey: "idem-1" });
    const again = machine.submit({ actor: actor(), idempotencyKey: "idem-1" });
    expect(again.record?.handlingId).toBe(first.record?.handlingId);
    machine.approve({ actor: approver(), handlingId: first.record!.handlingId });
    const executed = machine.execute({ actor: actor(), handlingId: first.record!.handlingId });
    const repeated = machine.execute({ actor: actor(), handlingId: first.record!.handlingId });
    expect(executed.record?.status).toBe("executed_pending_recheck");
    expect(repeated.ok).toBe(true);
    expect(repeated.reason).toBe("already_executed");
    expect(repeated.record?.execution?.taskId).toBe(executed.record?.execution?.taskId);
    expect(resumeCalls).toBe(1);
  });

  it("keeps records after a store restart and does not auto-rerun unknown results", () => {
    const configDir = tmp();
    seed(configDir);
    const first = loop(configDir);
    const submitted = first.submit({ actor: actor(), idempotencyKey: "restart-key" });
    first.approve({ actor: approver(), handlingId: submitted.record!.handlingId });
    first.close();
    const opened = createFileHandlingStore(configDir, "tenant-a");
    opened.put({
      ...submitted.record!,
      status: "executing",
      execution: {
        taskId: "task-interrupted",
        receipt: { accepted: true },
        startedAt: submitted.record!.createdAt,
        applied: false,
      },
    });
    opened.close();
    const restarted = createFileHandlingStore(configDir, "tenant-a");
    restarted.reload();
    const recovered = restarted.get(submitted.record!.handlingId);
    expect(recovered?.status).toBe("result_unverified");
    expect(recovered?.failureReason).toBe("unknown_result_after_interrupt");
    let resumeCalls = 0;
    const guarded = createDiagnosisHandlingLoop({
      configDir,
      isolation: true,
      store: restarted,
      resume: (input) => {
        resumeCalls += 1;
        return resumeDiagnosisJob(input);
      },
    });
    const replay = guarded.execute({ actor: actor(), handlingId: submitted.record!.handlingId });
    expect(replay.ok).toBe(true);
    expect(replay.reason).toBe("already_executed");
    expect(replay.record?.status).toBe("result_unverified");
    expect(resumeCalls).toBe(0);
    const listed = guarded.list({ actor: actor() });
    expect(listed.records).toHaveLength(1);
    expect(listed.records[0]?.status).toBe("result_unverified");
    const stillPaused = describeDiagnosisJob({
      caller: { membershipTenantId: "tenant-a", claimedTenantId: null },
      configDir,
    });
    expect(stillPaused.ok).toBe(true);
    if (stillPaused.ok) {
      expect(stillPaused.binding?.paused).toBe(true);
    }
  });

  it("refuses execute after write permission is withdrawn and when production mode is on", () => {
    const configDir = tmp();
    seed(configDir);
    const machine = loop(configDir);
    const submitted = machine.submit({ actor: actor() });
    machine.approve({ actor: approver(), handlingId: submitted.record!.handlingId });
    const revoked = machine.execute({
      actor: actor({ scopes: ["operator.read"] }),
      handlingId: submitted.record!.handlingId,
    });
    expect(revoked.ok).toBe(false);
    expect(revoked.reason).toBe("authorization_revoked");
    expect(revoked.record?.status).toBe("pending_execution");
    machine.close();
    const production = createDiagnosisHandlingLoop({
      configDir,
      isolation: true,
      env: { [PRODUCTION_EXECUTION_MODE_ENV]: "production" },
    });
    const closed = production.execute({
      actor: actor(),
      handlingId: submitted.record!.handlingId,
    });
    expect(closed.ok).toBe(false);
    expect(closed.reason).toBe("production_repair_closed");
    const described = describeDiagnosisJob({
      caller: { membershipTenantId: "tenant-a", claimedTenantId: null },
      configDir,
    });
    expect(described.ok).toBe(true);
    if (described.ok) {
      expect(described.binding?.paused).toBe(true);
    }
  });

  it("keeps 已执行待复核 when recheck evidence still shows the job paused", () => {
    const configDir = tmp();
    seed(configDir);
    const machine = loop(configDir);
    const submitted = machine.submit({ actor: actor() });
    machine.approve({ actor: approver(), handlingId: submitted.record!.handlingId });
    const executed = machine.execute({ actor: actor(), handlingId: submitted.record!.handlingId });
    expect(executed.record?.status).toBe("executed_pending_recheck");
    const pausedAgain = seedPausedDiagnosisJob({ actor: actor(), configDir });
    expect(pausedAgain.ok).toBe(true);
    const rechecked = machine.recheck({ actor: actor(), handlingId: submitted.record!.handlingId });
    expect(rechecked.record?.status).toBe("executed_pending_recheck");
    expect(rechecked.record?.recheck?.met).toBe(false);
    expect(rechecked.admin?.currentStep).toBe("已执行待复核");
  });

  it("lets the gateway reject unauthorized callers and persist a normal isolated execute", async () => {
    const configDir = tmp();
    seed(configDir);
    const store = createTenantFileHandlingStore(configDir);
    const handlers = createDiagnosisHandlingGatewayHandlers(
      { resolveMembership: async () => ({ tenantId: "tenant-a", userId: "user-a" }) },
      { configDir, isolation: true, registrationPath: "isolation", store },
    );
    const denied = await invoke(
      handlers["diagnosis.handling.submit"],
      {},
      { scopes: ["operator.read"] },
    );
    expect(denied.ok).toBe(false);
    expect((denied.payload as { reason?: string }).reason).toBe("unauthorized");
    const submitted = await invoke(
      handlers["diagnosis.handling.submit"],
      {},
      { scopes: ["operator.read", "operator.write"] },
    );
    expect(submitted.ok).toBe(true);
    const handlingId = (submitted.payload as { record: { handlingId: string } }).record.handlingId;
    const approved = await invoke(
      handlers["diagnosis.handling.approve"],
      { handlingId },
      { scopes: ["operator.read", "operator.approvals"] },
    );
    expect(approved.ok).toBe(true);
    const executed = await invoke(
      handlers["diagnosis.handling.execute"],
      { handlingId },
      { scopes: ["operator.read", "operator.write"] },
    );
    expect(executed.ok).toBe(true);
    expect((executed.payload as { record: { status: string } }).record.status).toBe(
      "executed_pending_recheck",
    );
    const liveDefault = createDiagnosisHandlingGatewayHandlers(
      { resolveMembership: async () => ({ tenantId: "tenant-a", userId: "user-a" }) },
      { configDir, isolation: false, store },
    );
    seedPausedDiagnosisJob({ actor: actor(), configDir });
    const closedSubmit = await invoke(
      liveDefault["diagnosis.handling.submit"],
      { idempotencyKey: "live-closed" },
      { scopes: ["operator.read", "operator.write"] },
    );
    const closedId = (closedSubmit.payload as { record: { handlingId: string } }).record.handlingId;
    await invoke(
      liveDefault["diagnosis.handling.approve"],
      { handlingId: closedId },
      { scopes: ["operator.read", "operator.approvals"] },
    );
    const closedExec = await invoke(
      liveDefault["diagnosis.handling.execute"],
      { handlingId: closedId },
      { scopes: ["operator.read", "operator.write"] },
    );
    expect(closedExec.ok).toBe(false);
    expect((closedExec.payload as { reason?: string }).reason).toBe("production_repair_closed");
  });

  it("memory store does not imply durability; file store is the restart contract", () => {
    const memory = createMemoryHandlingStore();
    expect(memory.list()).toEqual([]);
  });

  it("does not treat a missing or replaced binding as resolved on recheck", () => {
    const configDir = tmp();
    seed(configDir);
    const machine = loop(configDir);
    const submitted = machine.submit({ actor: actor() });
    machine.approve({ actor: approver(), handlingId: submitted.record!.handlingId });
    const executed = machine.execute({ actor: actor(), handlingId: submitted.record!.handlingId });
    expect(executed.record?.status).toBe("executed_pending_recheck");
    const approvedBindingId = submitted.record!.target.bindingId;
    expect(approvedBindingId).toBeTruthy();

    fs.unlinkSync(
      path.join(
        configDir,
        DIAGNOSIS_JOBS_DIR,
        diagnosisJobTenantHash16("tenant-a"),
        "binding.json",
      ),
    );
    const missing = machine.recheck({ actor: actor(), handlingId: submitted.record!.handlingId });
    expect(missing.record?.status).toBe("result_unverified");
    expect(missing.record?.recheck?.met).toBe(false);
    expect(missing.record?.failureReason).toBe("recheck_binding_missing");
    expect(missing.record?.recheck?.after.bindingPresent).toBe(false);
    expect(missing.record?.recheck?.after.paused).toBe(false);
    expect(missing.admin?.currentStep).toBe("结果待核实");

    seedPausedDiagnosisJob({ actor: actor(), configDir });
    const described = describeDiagnosisJob({
      caller: { membershipTenantId: "tenant-a", claimedTenantId: null },
      configDir,
    });
    expect(described.ok).toBe(true);
    if (!described.ok || !described.binding) {
      throw new Error("expected a replacement binding");
    }
    writeDiagnosisScheduleBinding(
      {
        ...described.binding,
        bindingId: "djb-replaced0000001",
        paused: false,
        pausedAt: null,
        updatedAt: new Date().toISOString(),
      },
      configDir,
    );
    const replaced = machine.recheck({ actor: actor(), handlingId: submitted.record!.handlingId });
    expect(replaced.record?.status).toBe("result_unverified");
    expect(replaced.record?.recheck?.met).toBe(false);
    expect(replaced.record?.failureReason).toBe("recheck_target_mismatch");
    expect(replaced.record?.recheck?.after.bindingId).toBe("djb-replaced0000001");
    expect(replaced.record?.recheck?.after.bindingId).not.toBe(approvedBindingId);
  });

  it("re-reads the approved target before execute and conflicts when it changed", () => {
    const configDir = tmp();
    seed(configDir);
    let resumeCalls = 0;
    const machine = createDiagnosisHandlingLoop({
      configDir,
      isolation: true,
      resume: (input) => {
        resumeCalls += 1;
        return resumeDiagnosisJob(input);
      },
    });
    const submitted = machine.submit({ actor: actor() });
    machine.approve({ actor: approver(), handlingId: submitted.record!.handlingId });
    const approvedPausedAt = submitted.record!.target.bindingPausedAt;
    const rePaused = pauseDiagnosisJob({
      caller: { membershipTenantId: "tenant-a", claimedTenantId: null },
      configDir,
      now: Date.parse(approvedPausedAt ?? "2026-11-11T00:00:00.000Z") + 60_000,
    });
    expect(rePaused.ok).toBe(true);
    if (rePaused.ok) {
      expect(rePaused.binding.pausedAt).not.toBe(approvedPausedAt);
    }
    const conflict = machine.execute({ actor: actor(), handlingId: submitted.record!.handlingId });
    expect(conflict.ok).toBe(false);
    expect(conflict.reason).toBe("approved_target_conflict");
    expect(conflict.record?.status).toBe("pending_execution");
    expect(resumeCalls).toBe(0);

    const described = describeDiagnosisJob({
      caller: { membershipTenantId: "tenant-a", claimedTenantId: null },
      configDir,
    });
    expect(described.ok).toBe(true);
    if (!described.ok || !described.binding) {
      throw new Error("expected binding");
    }
    writeDiagnosisScheduleBinding(
      {
        ...described.binding,
        bindingId: "djb-replaced0000002",
        paused: true,
        pausedAt: described.binding.pausedAt,
        updatedAt: described.binding.updatedAt,
      },
      configDir,
    );
    const replaced = machine.execute({ actor: actor(), handlingId: submitted.record!.handlingId });
    expect(replaced.ok).toBe(false);
    expect(replaced.reason).toBe("approved_target_conflict");
    expect(resumeCalls).toBe(0);
    expect(machine.preview(actor()).admin?.whatHappened).toContain("管理员主动暂停并不必然是故障");
  });

  it("marks persist-after-success and throw-after-mutation as 结果待核实 and does not auto-rerun", () => {
    const configDir = tmp();
    seed(configDir);
    const inner = createMemoryHandlingStore();
    const persistStore: HandlingStore = {
      get: (id) => inner.get(id),
      getByIdempotency: (tenantId, key) => inner.getByIdempotency(tenantId, key),
      list: (filter) => inner.list(filter),
      reload: () => inner.reload(),
      close: () => inner.close(),
      put: (row) => {
        if (row.status === "executed_pending_recheck") {
          throw new Error("disk full after resume");
        }
        return inner.put(row);
      },
    };
    let resumeCalls = 0;
    const machine = createDiagnosisHandlingLoop({
      configDir,
      isolation: true,
      store: persistStore,
      resume: (input) => {
        resumeCalls += 1;
        return resumeDiagnosisJob(input);
      },
    });
    const submitted = machine.submit({ actor: actor(), idempotencyKey: "persist-after" });
    machine.approve({ actor: approver(), handlingId: submitted.record!.handlingId });
    const persisted = machine.execute({ actor: actor(), handlingId: submitted.record!.handlingId });
    expect(persisted.record?.status).toBe("result_unverified");
    expect(persisted.record?.failureReason).toBe("persist_failed_after_effect");
    expect(persisted.record?.execution?.applied).toBe(true);
    expect(persisted.record?.execution?.effectUncertain).toBe(true);
    expect(persisted.record?.execution?.receipt.mayHaveTakenEffect).toBe(true);
    const replay = machine.execute({ actor: actor(), handlingId: submitted.record!.handlingId });
    expect(replay.reason).toBe("already_executed");
    expect(replay.record?.status).toBe("result_unverified");
    expect(resumeCalls).toBe(1);

    const configDir2 = tmp();
    seed(configDir2);
    let throwResumeCalls = 0;
    const throwing = createDiagnosisHandlingLoop({
      configDir: configDir2,
      isolation: true,
      resume: (input) => {
        throwResumeCalls += 1;
        const receipt = resumeDiagnosisJob(input);
        if (!receipt.ok) {
          return receipt;
        }
        throw new Error("executor threw after mutation");
      },
    });
    const second = throwing.submit({ actor: actor(), idempotencyKey: "throw-after" });
    throwing.approve({ actor: approver(), handlingId: second.record!.handlingId });
    const unverified = throwing.execute({ actor: actor(), handlingId: second.record!.handlingId });
    expect(unverified.record?.status).toBe("result_unverified");
    expect(unverified.record?.failureReason).toBe("executor threw after mutation");
    expect(unverified.record?.execution?.effectUncertain).toBe(true);
    expect(unverified.record?.execution?.receipt.mayHaveTakenEffect).toBe(true);
    const after = describeDiagnosisJob({
      caller: { membershipTenantId: "tenant-a", claimedTenantId: null },
      configDir: configDir2,
    });
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.binding?.paused).toBe(false);
    }
    const noRerun = throwing.execute({ actor: actor(), handlingId: second.record!.handlingId });
    expect(noRerun.reason).toBe("already_executed");
    expect(throwResumeCalls).toBe(1);
  });

  it("does not leak uncommitted file-store state after a disk write failure and enforces a single writer", () => {
    const configDir = tmp();
    seed(configDir);
    const machine = loop(configDir);
    const submitted = machine.submit({ actor: actor(), idempotencyKey: "store-sample" });
    const sample = submitted.record!;
    let failNext = false;
    const store = createFileHandlingStore(configDir, "tenant-b", {
      writeSnapshot: (filePath, snapshot) => {
        if (failNext) {
          throw new Error("EIO");
        }
        writeHandlingSnapshotAtomic(filePath, snapshot);
      },
    });
    const first: HandlingRecord = { ...sample, handlingId: "hdl-store-1", tenantId: "tenant-b" };
    store.put(first);
    expect(store.get("hdl-store-1")?.status).toBe("pending_approval");
    failNext = true;
    expect(() =>
      store.put({ ...first, status: "pending_execution", updatedAt: new Date().toISOString() }),
    ).toThrow(/EIO/);
    expect(store.get("hdl-store-1")?.status).toBe("pending_approval");
    expect(() => createFileHandlingStore(configDir, "tenant-b")).toThrow(
      DIAGNOSIS_HANDLING_SINGLE_WRITER_VIOLATION,
    );
    store.close();
    const reopened = createFileHandlingStore(configDir, "tenant-b");
    expect(reopened.get("hdl-store-1")?.status).toBe("pending_approval");
    reopened.close();
  });

  it("refuses to open execute from the isolation env var or a production registration path", async () => {
    const isolatedDir = tmp();
    const notTmp = fs.mkdtempSync(path.join("/workspace", "openbot-handling-not-iso-"));
    tmpDirs.push(notTmp);
    expect(
      isDiagnosisHandlingExecuteOpen({
        isolation: false,
        env: { [DIAGNOSIS_HANDLING_ISOLATION_ENV]: "1" },
        configDir: isolatedDir,
      }),
    ).toBe(false);
    expect(
      isDiagnosisHandlingExecuteOpen({
        isolation: true,
        registrationPath: "production",
        env: { [DIAGNOSIS_HANDLING_ISOLATION_ENV]: "1" },
        configDir: isolatedDir,
      }),
    ).toBe(false);
    expect(
      isDiagnosisHandlingExecuteOpen({
        isolation: true,
        registrationPath: "isolation",
        configDir: notTmp,
      }),
    ).toBe(false);
    expect(
      isDiagnosisHandlingExecuteOpen({
        isolation: true,
        registrationPath: "isolation",
        configDir: isolatedDir,
      }),
    ).toBe(true);

    seed(isolatedDir);
    const closedByPath = createDiagnosisHandlingLoop({
      configDir: isolatedDir,
      isolation: true,
      registrationPath: "production",
      env: { [DIAGNOSIS_HANDLING_ISOLATION_ENV]: "1" },
    });
    const submitted = closedByPath.submit({ actor: actor(), idempotencyKey: "prod-path" });
    closedByPath.approve({ actor: approver(), handlingId: submitted.record!.handlingId });
    const refused = closedByPath.execute({
      actor: actor(),
      handlingId: submitted.record!.handlingId,
    });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe("production_repair_closed");
    closedByPath.close();

    seed(notTmp);
    const noBoundary = createDiagnosisHandlingLoop({
      configDir: notTmp,
      isolation: true,
      registrationPath: "isolation",
    });
    const bound = noBoundary.submit({ actor: actor(), idempotencyKey: "no-boundary" });
    noBoundary.approve({ actor: approver(), handlingId: bound.record!.handlingId });
    const blocked = noBoundary.execute({ actor: actor(), handlingId: bound.record!.handlingId });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("isolation_boundary_unverified");

    const handlers = createDiagnosisHandlingGatewayHandlers(
      { resolveMembership: async () => ({ tenantId: "tenant-a", userId: "user-a" }) },
      {
        configDir: isolatedDir,
        isolation: true,
        env: { [DIAGNOSIS_HANDLING_ISOLATION_ENV]: "1" },
      },
    );
    const submittedLive = await invoke(
      handlers["diagnosis.handling.submit"],
      { idempotencyKey: "gw-prod-path" },
      { scopes: ["operator.read", "operator.write"] },
    );
    const handlingId = (submittedLive.payload as { record: { handlingId: string } }).record
      .handlingId;
    await invoke(
      handlers["diagnosis.handling.approve"],
      { handlingId },
      { scopes: ["operator.read", "operator.approvals"] },
    );
    const closedExec = await invoke(
      handlers["diagnosis.handling.execute"],
      { handlingId },
      { scopes: ["operator.read", "operator.write"] },
    );
    expect(closedExec.ok).toBe(false);
    expect((closedExec.payload as { reason?: string }).reason).toBe("production_repair_closed");
  });
});

async function invoke(
  handler: ((...args: never[]) => Promise<void> | void) | undefined,
  params: Record<string, unknown>,
  client: Record<string, unknown> = {},
): Promise<{ ok: boolean; payload?: unknown }> {
  let captured: { ok: boolean; payload?: unknown } = { ok: false };
  if (!handler) {
    throw new Error("missing handling-loop handler");
  }
  await handler({
    req: { type: "req", id: "t137", method: "diagnosis.handling.submit" },
    params,
    client: {
      user: "user-a",
      platformUserId: "user-a",
      sessionDomain: "enterprise",
      ...client,
    },
    isWebchatConnect: () => false,
    respond: (ok: boolean, payload?: unknown) => {
      captured = { ok, payload };
    },
    context: {},
  } as never);
  return captured;
}

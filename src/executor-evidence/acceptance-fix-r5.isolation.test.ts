/**
 * R5 counterexamples. A legal chain passes, then one condition changes.
 * Isolation only: no gateway and no external model.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildTaskBudgetState } from "../task-outcome/budget.js";
import { TaskOutcomeResultService } from "../task-outcome/result-service.js";
import {
  chargeModelCallAgainstTip,
  recordRunnerTurnOutcome,
  rememberModelResultUsage,
  runModelCandidateWithSingleCharge,
  type ModelCallCloseoutLink,
} from "../task-outcome/runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import type { TrustedScope } from "../task-outcome/types.js";
import { resetEvidenceAssociations } from "./association.js";
import { SNAPSHOT_IDENTITY_COVERS, SNAPSHOT_IDENTITY_DOES_NOT_COVER } from "./identity.js";
import {
  observeModelCandidate,
  processStartToken,
  resetModelCallsForTests,
  writeBoundedEvidenceFile,
} from "./model-call-evidence.js";
import { readExecutorEvidence } from "./read-port.js";

const scope: TrustedScope = {
  kind: "enterprise",
  enterpriseDomainId: "enterprise:acme",
  tenantId: "tenant-a",
  subjectRef: "user:evidence",
  authzScopeRef: "authz:desk",
};
const rates = { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
const roots: string[] = [];

function agentCfg(agentDir: string) {
  return {
    agents: { list: [{ id: "bot", agentDir, workspace: agentDir }] },
    models: { providers: { local: { models: [{ id: "a", cost: rates }] } } },
  } as never;
}

function fullUsage(input: number, output: number) {
  return { input, output, cacheRead: 0, cacheWrite: 0 };
}

afterEach(() => {
  resetModelCallsForTests();
  resetEvidenceAssociations();
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE_DISK_CAP;
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE_LOCK_AFTER_CREATE_MS;
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE_LOCK_CRASH_BEFORE_PUBLISH;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function legalChain(label: string) {
  process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), `executor-evidence-r5-${label}-`));
  roots.push(agentDir);
  const cfg = agentCfg(agentDir);
  const taskId = `task-${label}`;
  const runId = `run-${label}`;
  const storeRoot = path.join(agentDir, "task-outcomes");
  let link: ModelCallCloseoutLink | null = null;
  await observeModelCandidate({
    context: {
      agentId: "bot",
      scope,
      taskId,
      runId,
      storeRoot,
      provenance: "injected",
      collector: "isolation",
    },
    attemptIndex: 0,
    provider: "local",
    model: "a",
    run: async () => {
      const charged = chargeModelCallAgainstTip(cfg, "bot", {
        taskId,
        scope,
        runId,
        callSeq: 1,
        provider: "local",
        model: "a",
        usage: fullUsage(1, 0),
        budgetLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
      });
      link = charged.modelCallLink;
      return "ok";
    },
  });
  if (!link) {
    throw new Error("missing link");
  }
  const closed = await recordRunnerTurnOutcome(cfg, "bot", {
    success: true,
    runId,
    taskId,
    scope,
    skipBudgetCharge: true,
    modelCallLink: link,
    acceptance: { status: "passed" },
    delivery: { status: "delivered" },
    deliveryId: "del-r5",
  });
  return { storeRoot, taskId, runId, closed };
}

describe("R5 lock and call identity", () => {
  it("does not steal a lock that exists before its owner record is published", async () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r5-lock-"));
    roots.push(storeRoot);
    const childPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "evidence-write-child.ts",
    );
    const out = path.join(storeRoot, "child-result.json");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", childPath, storeRoot, "child.json", "8", out],
      {
        cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
        env: {
          ...process.env,
          OPENBOT_EXECUTOR_EVIDENCE: "1",
          OPENBOT_EXECUTOR_EVIDENCE_LOCK_AFTER_CREATE_MS: "1500",
        },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const raced = writeBoundedEvidenceFile(storeRoot, "parent.json", { pad: "parent" });
    expect(raced).toBe("failed");
    expect(fs.existsSync(path.join(storeRoot, "executor-evidence", "write.lock"))).toBe(true);
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, "utf8"))).toMatchObject({ result: "written" });
    expect(
      fs.existsSync(path.join(storeRoot, "executor-evidence", "associations", "child.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(storeRoot, "executor-evidence", "associations", "parent.json")),
    ).toBe(false);
  });

  it("does not steal an unpublished lock after the old grace period", async () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r6-lock-grace-"));
    roots.push(storeRoot);
    const childPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "evidence-write-child.ts",
    );
    const out = path.join(storeRoot, "child-result.json");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", childPath, storeRoot, "child.json", "8", out],
      {
        cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
        env: {
          ...process.env,
          OPENBOT_EXECUTOR_EVIDENCE: "1",
          OPENBOT_EXECUTOR_EVIDENCE_LOCK_AFTER_CREATE_MS: "4000",
        },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const raced = writeBoundedEvidenceFile(storeRoot, "parent.json", { pad: "parent" });
    expect(raced).toBe("failed");
    expect(fs.existsSync(path.join(storeRoot, "executor-evidence", "write.lock"))).toBe(true);
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, "utf8"))).toMatchObject({ result: "written" });
    expect(
      fs.existsSync(path.join(storeRoot, "executor-evidence", "associations", "parent.json")),
    ).toBe(false);
  });

  it("recovers a lock whose owner died before publish and still refuses a live lock", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r8-crash-"));
    roots.push(storeRoot);
    const childPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "evidence-write-child.ts",
    );
    const out = path.join(storeRoot, "crash-result.json");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", childPath, storeRoot, "crashed.json", "4", out],
      {
        cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
        env: {
          ...process.env,
          OPENBOT_EXECUTOR_EVIDENCE: "1",
          OPENBOT_EXECUTOR_EVIDENCE_LOCK_CRASH_BEFORE_PUBLISH: "1",
        },
      },
    );
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(0);
    const lockPath = path.join(storeRoot, "executor-evidence", "write.lock");
    const crashedOwner = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
      phase?: string;
      pid?: number;
    };
    expect(crashedOwner.phase).toBe("publishing");
    expect(crashedOwner.pid).not.toBe(process.pid);
    const recovered = writeBoundedEvidenceFile(storeRoot, "recovered.json", { pad: "ok" });
    expect(recovered).toBe("written");
    expect(
      fs.existsSync(path.join(storeRoot, "executor-evidence", "associations", "recovered.json")),
    ).toBe(true);
    const liveLock = path.join(storeRoot, "executor-evidence", "write.lock");
    fs.mkdirSync(path.dirname(liveLock), { recursive: true });
    fs.writeFileSync(
      liveLock,
      JSON.stringify({
        pid: process.pid,
        startToken: processStartToken(process.pid) ?? "unknown",
        lockId: "still-alive",
        phase: "publishing",
      }),
    );
    const blocked = writeBoundedEvidenceFile(storeRoot, "stolen.json", { pad: "no" });
    expect(blocked).toBe("failed");
    expect(fs.existsSync(liveLock)).toBe(true);
    const still = JSON.parse(fs.readFileSync(liveLock, "utf8")) as { lockId?: string };
    expect(still.lockId).toBe("still-alive");
  });

  it("rejects a changed scope, run, provider, or startedAt as an immutable conflict", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const base = {
      evidenceId: "mce_frozen",
      callId: "call_frozen",
      agentId: "bot",
      scope,
      taskId: "task-frozen",
      runId: "run-frozen",
      attemptId: "attempt-frozen",
      attemptKind: "fallback_candidate",
      provider: "local",
      model: "a",
      startedAt: 10,
      provenance: "injected",
      collector: "isolation",
      status: "unknown",
      usage: { input: null, output: null, cacheRead: null, cacheWrite: null },
    };
    const changes = [
      { scope: { ...scope, tenantId: "tenant-other" } },
      { runId: "run-other" },
      { provider: "other" },
      { startedAt: 99 },
    ];
    for (const change of changes) {
      const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r5-frozen-"));
      roots.push(storeRoot);
      expect(writeBoundedEvidenceFile(storeRoot, "call.json", base, "calls")).toBe("written");
      expect(
        writeBoundedEvidenceFile(storeRoot, "call.json", { ...base, ...change }, "calls"),
      ).toBe("conflict");
    }
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r5-advance-"));
    roots.push(storeRoot);
    expect(writeBoundedEvidenceFile(storeRoot, "call.json", base, "calls")).toBe("written");
    expect(
      writeBoundedEvidenceFile(
        storeRoot,
        "call.json",
        { ...base, status: "failed", usage: fullUsage(1, 0) },
        "calls",
      ),
    ).toBe("written");
  });
});

describe("R5 original receipt binding", () => {
  it("reports call_binding_conflict when only the binding changes", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r5-bind-"));
    roots.push(storeRoot);
    const store = new DurableTaskOutcomeStore(storeRoot);
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const created = service.submit(
      "task-bind",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "create-bind", requiredScope: scope },
    );
    if (!created.ok) {
      throw new Error("create");
    }
    const bindingA = { callId: "call-a", evidenceId: "mce-a", usageFingerprint: "usage-a" };
    const first = service.submit(
      "task-bind",
      {
        type: "accumulate_budget_spend",
        iterations: 1,
        costUsd: 1,
        costEvidence: "known",
        expectedVersion: created.record.outcomeVersion,
        fencingToken: created.record.fencingToken ?? "",
      },
      { commandId: "budget-bind", requiredScope: scope, callBinding: bindingA },
    );
    expect(first.ok).toBe(true);
    const second = service.submit(
      "task-bind",
      {
        type: "accumulate_budget_spend",
        iterations: 1,
        costUsd: 1,
        costEvidence: "known",
        expectedVersion: created.record.outcomeVersion,
        fencingToken: created.record.fencingToken ?? "",
      },
      {
        commandId: "budget-bind",
        requiredScope: scope,
        callBinding: { callId: "call-b", evidenceId: "mce-b", usageFingerprint: "usage-b" },
      },
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("command_conflict");
      expect(second.commandConflict?.reason).toBe("call_binding_conflict");
      expect(second.commandConflict?.storedCallBinding).toEqual(bindingA);
      expect(second.commandReceipt).toBeUndefined();
    }
  });
});

describe("R5 read closure", () => {
  it("accepts a legal chain and states the fingerprint boundary", async () => {
    const chain = await legalChain("legal");
    const view = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: chain.taskId,
      runId: chain.runId,
      storeRoot: chain.storeRoot,
      outcomeVersion: chain.closed.record.outcomeVersion,
    });
    expect(view.completeness).toBe("complete");
    expect(view.callChainCompleteness).toBe("complete");
    expect(view.costAttributionCompleteness).toBe("complete");
    expect(SNAPSHOT_IDENTITY_COVERS).toContain("acceptance");
    expect(SNAPSHOT_IDENTITY_COVERS).toContain("delivery");
    expect(SNAPSHOT_IDENTITY_DOES_NOT_COVER).toContain("budget");
    expect(SNAPSHOT_IDENTITY_DOES_NOT_COVER).toContain("createdAt");
  });

  it("does not treat a self-complete association without a final version as closed", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r5-null-final-"));
    roots.push(storeRoot);
    fs.mkdirSync(path.join(storeRoot, "executor-evidence", "calls"), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, "executor-evidence", "associations"), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, "tips"), { recursive: true });
    fs.writeFileSync(
      path.join(storeRoot, "tips", "task-null.json"),
      JSON.stringify({ taskId: "task-null", outcomeVersion: 1, scope }),
    );
    fs.writeFileSync(
      path.join(storeRoot, "executor-evidence", "calls", "a.json"),
      JSON.stringify({
        schemaVersion: 1,
        callId: "call-a",
        evidenceId: "mce-a",
        attemptId: "attempt-a",
        provenance: "injected",
        agentId: "bot",
        taskId: "task-null",
        runId: "run-null",
        scope,
        startedAt: 1,
        observedAt: 2,
        usage: fullUsage(1, 0),
      }),
    );
    fs.writeFileSync(
      path.join(storeRoot, "executor-evidence", "associations", "a.json"),
      JSON.stringify({
        schemaVersion: 1,
        agentId: "bot",
        runId: "run-null",
        callId: "call-a",
        trustedScope: scope,
        chain: { taskId: "task-null", runId: "run-null" },
        completeness: "complete",
        finalOutcomeVersion: null,
      }),
    );
    const view = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-null",
      runId: "run-null",
      storeRoot,
    });
    expect(view.gaps).toContain("association_final_version_absent");
    expect(view.callChainCompleteness).not.toBe("complete");
    expect(view.completeness).not.toBe("complete");
  });

  it("keeps each read layer partial for one injected association fault", async () => {
    const chain = await legalChain("layers");
    const dir = path.join(chain.storeRoot, "executor-evidence", "associations");
    const read = () =>
      readExecutorEvidence({
        agentId: "bot",
        scope,
        taskId: chain.taskId,
        runId: chain.runId,
        storeRoot: chain.storeRoot,
        outcomeVersion: chain.closed.record.outcomeVersion,
      });
    fs.writeFileSync(path.join(dir, "broken.json"), "{");
    const corrupt = read();
    expect(corrupt.gaps).toContain("corrupt_association");
    expect(corrupt.callChainCompleteness).not.toBe("complete");
    expect(corrupt.costAttributionCompleteness).toBe("partial");
    fs.rmSync(path.join(dir, "broken.json"));
    fs.writeFileSync(
      path.join(dir, "bad-field.json"),
      JSON.stringify({ schemaVersion: 1, agentId: "bot", completeness: "complete" }),
    );
    const field = read();
    expect(field.gaps).toContain("association_field_invalid");
    expect(field.callChainCompleteness).not.toBe("complete");
    expect(field.costAttributionCompleteness).toBe("partial");
    fs.rmSync(dir, { recursive: true });
    fs.writeFileSync(dir, "not-a-directory");
    const unreadable = read();
    expect(unreadable.gaps).toContain("association_read_failed");
    expect(unreadable.callChainCompleteness).not.toBe("complete");
    expect(unreadable.costAttributionCompleteness).not.toBe("not_applicable");
    expect(unreadable.costAttributionCompleteness).toBe("partial");
  });
});

describe("R5 model result is noted before post-processing", () => {
  it("charges the model usage when followup-style post-processing throws", async () => {
    const order: string[] = [];
    await expect(
      runModelCandidateWithSingleCharge({
        run: async () => ({ meta: { agentMeta: { usage: fullUsage(2, 1) } } }),
        noteResponse: (value) => {
          order.push("note");
          rememberModelResultUsage(value.meta.agentMeta.usage);
        },
        afterResponse: () => {
          order.push("after");
          throw new Error("bootstrap failed");
        },
        charge: (outcome) => {
          order.push("charge");
          expect(outcome.ok).toBe(true);
          if (outcome.ok) {
            expect(outcome.value.meta.agentMeta.usage).toEqual(fullUsage(2, 1));
          }
        },
      }),
    ).rejects.toThrow("bootstrap failed");
    expect(order).toEqual(["note", "after", "charge"]);
  });
});

/**
 * R3 acceptance counterexamples. Isolation only: no gateway and no external model.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FailoverError } from "../agents/failover-error.js";
import { runWithModelFallback } from "../agents/model-fallback.js";
import { buildTaskBudgetState } from "../task-outcome/budget.js";
import { TaskOutcomeResultService } from "../task-outcome/result-service.js";
import {
  chargeModelCallAgainstTip,
  chargeRunnerTurnBudgetSpend,
  recordRunnerTurnOutcome,
  type ModelCallCloseoutLink,
} from "../task-outcome/runtime-from-runner.js";
import { boundedOutcomePathSegment, DurableTaskOutcomeStore } from "../task-outcome/store.js";
import type { TrustedScope } from "../task-outcome/types.js";
import {
  associateBudgetCharge,
  listMemoryAssociations,
  loadPersistedAssociations,
  publishFinalEvidenceLink,
  resetEvidenceAssociations,
} from "./association.js";
import { buildCostColumns } from "./cost-columns.js";
import {
  evidenceDiskByteCap,
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
    models: {
      providers: {
        local: {
          models: [
            { id: "a", cost: rates },
            { id: "b", cost: rates },
          ],
        },
      },
    },
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
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("R3 multi-candidate final set", () => {
  it("keeps failed candidate A and successful candidate B through the real fallback entry", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r3-fallback-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    const taskId = "task-r3-fallback";
    const runId = "run-r3-fallback";
    const links: ModelCallCloseoutLink[] = [];
    await runWithModelFallback({
      cfg,
      provider: "local",
      model: "a",
      fallbacksOverride: ["local/b"],
      runId,
      executorEvidence: {
        agentId: "bot",
        scope,
        taskId,
        runId,
        storeRoot: path.join(agentDir, "task-outcomes"),
        provenance: "injected",
        collector: "isolation",
      },
      run: async (provider, model) => {
        const charged = chargeModelCallAgainstTip(cfg, "bot", {
          taskId,
          scope,
          runId,
          callSeq: provider === "local" && model === "a" ? 1 : 2,
          provider,
          model,
          usage: model === "a" ? fullUsage(1, 0) : fullUsage(1, 0),
          budgetLimits: { maxIterations: 8, maxCostUsd: 30, maxDurationMinutes: 30 },
        });
        if (charged.modelCallLink) {
          links.push(charged.modelCallLink);
        }
        if (model === "a") {
          throw new FailoverError("primary failed after usage", {
            reason: "rate_limit",
            provider,
            model,
          });
        }
        return { ok: true, model };
      },
    });
    expect(links.map((link) => link.candidateAttemptId)).toHaveLength(2);
    const closed = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId,
      taskId,
      scope,
      skipBudgetCharge: true,
      modelCallLinks: links,
      acceptance: { status: "passed" },
      delivery: { status: "delivered" },
      deliveryId: "del-r3",
    });
    const finals = loadPersistedAssociations(path.join(agentDir, "task-outcomes")).filter(
      (row) => row.finalOutcomeVersion === closed.record.outcomeVersion,
    );
    expect(new Set(finals.map((row) => row.callId)).size).toBe(2);
    expect(finals.every((row) => row.completeness === "complete")).toBe(true);
    const storeRoot = path.join(agentDir, "task-outcomes");
    const associationDir = path.join(storeRoot, "executor-evidence", "associations");
    const associationFile = fs
      .readdirSync(associationDir)
      .map((name) => path.join(associationDir, name))
      .find((file) => {
        const body = JSON.parse(fs.readFileSync(file, "utf8")) as { finalOutcomeVersion?: number };
        return body.finalOutcomeVersion === closed.record.outcomeVersion;
      });
    if (!associationFile) {
      throw new Error("final association file");
    }
    const tampered = JSON.parse(fs.readFileSync(associationFile, "utf8")) as {
      finalSnapshotFingerprint: string;
      taskAttemptId: string;
    };
    tampered.finalSnapshotFingerprint = "0".repeat(64);
    tampered.taskAttemptId = "att:not-a-member";
    fs.writeFileSync(associationFile, `${JSON.stringify(tampered)}\n`);
    const isolated = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId,
      runId,
      storeRoot,
      outcomeVersion: closed.record.outcomeVersion,
    });
    expect(isolated.gaps.join(" ")).toMatch(
      /association_fingerprint_mismatch|association_attempt_mismatch/,
    );
    expect(isolated.associations.some((row) => row.taskAttemptId === "att:not-a-member")).toBe(
      false,
    );
    expect(isolated.completeness).not.toBe("complete");
    expect(
      finals.every((row) => (row.chargeOutcomeVersion ?? 0) < (row.finalOutcomeVersion ?? 0)),
    ).toBe(true);
    const dropped = [...links];
    dropped.pop();
    const partial = await recordRunnerTurnOutcome(cfg, "bot", {
      success: false,
      runId: "run-partial",
      taskId: "task-partial",
      scope,
      skipBudgetCharge: true,
      failureReason: "run_failed",
      modelCallLinks: links,
    });
    expect(partial.record.taskJudgement).not.toBe("success");
    const wrong = publishFinalEvidenceLink({
      storeRoot: path.join(agentDir, "task-outcomes"),
      scope,
      agentId: "bot",
      taskId,
      runId,
      candidateAttemptId: links[1]?.candidateAttemptId ?? "x",
      taskAttemptId: "att:run-r3-fallback",
      chargeOutcomeVersion: 1,
      finalOutcomeVersion: 99,
      recordRuns: [{ runId, attemptIds: ["att:run-r3-fallback"] }],
      recordAttempts: ["att:run-r3-fallback"],
      receiptReturned: true,
      budgetCommandId: links[1]?.commandId,
      chargeCommitId: links[1]?.chargeCommitId,
      requestDigest: "wrong-digest",
    });
    expect(wrong?.completeness).not.toBe("complete");
    expect(wrong?.finalOutcomeVersion).toBeNull();
  });
});

describe("R3 verified spend for replay and closed recovery", () => {
  it("blocks parent attribution when a same-digest replay log spend is tampered", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r3-replay-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "parent-replay",
      scope,
      runId: "parent",
      callSeq: 1,
      provider: "local",
      model: "a",
      usage: fullUsage(0, 0),
      budgetLimits: { maxIterations: 8, maxCostUsd: 40, maxDurationMinutes: 30 },
    });
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const child = service.submit(
      "child-replay",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 8, maxCostUsd: 40, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "create-replay", requiredScope: scope },
    );
    if (!child.ok) {
      throw new Error("child");
    }
    const charged = service.submit(
      "child-replay",
      {
        type: "accumulate_budget_spend",
        iterations: 1,
        costUsd: 1,
        costEvidence: "known",
        expectedVersion: child.record.outcomeVersion,
        fencingToken: child.record.fencingToken ?? "",
      },
      { commandId: "budget-spend:child-replay:run-replay:call:1", requiredScope: scope },
    );
    expect(charged.ok).toBe(true);
    const logPath = store.commandLogPath("budget-spend:child-replay:run-replay:call:1");
    const raw = JSON.parse(fs.readFileSync(logPath, "utf8")) as {
      committedSpend: { costUsd: number };
    };
    raw.committedSpend.costUsd = 50;
    fs.writeFileSync(logPath, `${JSON.stringify(raw)}\n`);
    store.close();
    chargeRunnerTurnBudgetSpend(cfg, "bot", {
      taskId: "child-replay",
      scope,
      runId: "run-replay",
      callSeq: 1,
      costUsd: 1,
      costEvidence: "known",
      iterations: 1,
      parentTaskId: "parent-replay",
    });
    const parent = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes")).loadTask(
      "parent-replay",
    );
    expect(parent?.budget?.childAttributedCostUsd ?? 0).toBe(0);
  });

  it("attributes the original closed-child amount once", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r3-closed-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "parent-closed",
      scope,
      runId: "parent",
      callSeq: 1,
      provider: "local",
      model: "a",
      usage: fullUsage(0, 0),
      budgetLimits: { maxIterations: 8, maxCostUsd: 40, maxDurationMinutes: 30 },
    });
    const store = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes"));
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const child = service.submit(
      "child-closed",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 1, maxCostUsd: 10, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "create-closed", requiredScope: scope },
    );
    if (!child.ok) {
      throw new Error("child");
    }
    const charged = service.submit(
      "child-closed",
      {
        type: "accumulate_budget_spend",
        iterations: 1,
        costUsd: 1,
        costEvidence: "known",
        expectedVersion: child.record.outcomeVersion,
        fencingToken: child.record.fencingToken ?? "",
      },
      { commandId: "budget-spend:child-closed:run-closed:call:1", requiredScope: scope },
    );
    if (!charged.ok) {
      throw new Error("charge");
    }
    const closed = service.submit(
      "child-closed",
      {
        type: "fail_closed",
        reasonCode: "budget_exceeded",
        reasonDetail: "closed before parent",
        expectedVersion: charged.record.outcomeVersion,
        fencingToken: charged.record.fencingToken ?? "",
      },
      { commandId: "close-child", requiredScope: scope },
    );
    expect(closed.ok).toBe(true);
    store.close();
    const recover = () =>
      chargeRunnerTurnBudgetSpend(cfg, "bot", {
        taskId: "child-closed",
        scope,
        runId: "run-closed",
        callSeq: 1,
        costUsd: 9,
        costEvidence: "known",
        parentTaskId: "parent-closed",
      });
    recover();
    recover();
    const parent = new DurableTaskOutcomeStore(path.join(agentDir, "task-outcomes")).loadTask(
      "parent-closed",
    );
    expect(parent?.budget?.childAttributedCostUsd).toBe(1);
  });

  it("does not parent-attribute when the budget snapshot is deleted, replaced, or rescope", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r3-snap-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    const storeRoot = path.join(agentDir, "task-outcomes");
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "parent-snap",
      scope,
      runId: "parent",
      callSeq: 1,
      provider: "local",
      model: "a",
      usage: fullUsage(0, 0),
      budgetLimits: { maxIterations: 8, maxCostUsd: 40, maxDurationMinutes: 30 },
    });
    const open = () => new DurableTaskOutcomeStore(storeRoot);
    const store = open();
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const child = service.submit(
      "child-snap",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 8, maxCostUsd: 40, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "create-snap", requiredScope: scope },
    );
    if (!child.ok) {
      throw new Error("child");
    }
    const charged = service.submit(
      "child-snap",
      {
        type: "accumulate_budget_spend",
        iterations: 1,
        costUsd: 1,
        costEvidence: "known",
        expectedVersion: child.record.outcomeVersion,
        fencingToken: child.record.fencingToken ?? "",
      },
      { commandId: "budget-spend:child-snap:run-snap:call:1", requiredScope: scope },
    );
    expect(charged.ok).toBe(true);
    store.close();
    const logPath = path.join(
      storeRoot,
      "command-log",
      `${boundedOutcomePathSegment("budget-spend:child-snap:run-snap:call:1")}.json`,
    );
    const logged = JSON.parse(fs.readFileSync(logPath, "utf8")) as { outcomeVersion: number };
    const versionPath = path.join(
      storeRoot,
      "versions",
      `child-snap__v${logged.outcomeVersion}.json`,
    );
    const original = fs.readFileSync(versionPath, "utf8");
    const recover = () =>
      chargeRunnerTurnBudgetSpend(cfg, "bot", {
        taskId: "child-snap",
        scope,
        runId: "run-snap",
        callSeq: 1,
        costUsd: 9,
        costEvidence: "known",
        parentTaskId: "parent-snap",
      });
    fs.rmSync(versionPath);
    recover();
    fs.writeFileSync(versionPath, original);
    const replaced = JSON.parse(original) as { taskId: string; scope: { tenantId: string } };
    replaced.taskId = "other-task";
    replaced.scope.tenantId = "tenant-other";
    fs.writeFileSync(versionPath, `${JSON.stringify(replaced)}\n`);
    recover();
    const parent = open().loadTask("parent-snap");
    expect(parent?.budget?.childAttributedCostUsd ?? 0).toBe(0);
  });
});

describe("R3 read port and shared persistence", () => {
  it("does not throw when an evidence directory is a file and rejects a broken closure", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r3-read-"));
    roots.push(storeRoot);
    fs.mkdirSync(path.join(storeRoot, "executor-evidence"), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, "executor-evidence", "calls"), "not-a-dir");
    fs.mkdirSync(path.join(storeRoot, "command-log"), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, "command-log", "null.json"), "null");
    const view = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-read",
      storeRoot,
    });
    fs.mkdirSync(path.join(storeRoot, "tips"), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, "tips", "task-read.json"), '{"taskId":"task-read"}');
    fs.mkdirSync(path.join(storeRoot, "versions"), { recursive: true });
    fs.writeFileSync(
      path.join(storeRoot, "versions", "task-read__v1.json"),
      '{"taskId":"task-read","outcomeVersion":1}',
    );
    expect(view.gaps).toContain("not_a_directory");
    expect(view.gaps).toContain("command_log_corrupt");
    const schema = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-read",
      storeRoot,
      outcomeVersion: 1,
    });
    expect(schema.gaps).toContain("tip_schema_invalid");
    expect(schema.gaps).toContain("snapshot_identity_mismatch");
    expect(schema.completeness).not.toBe("complete");
    const chainRoot = path.join(storeRoot, "chain");
    fs.mkdirSync(path.join(chainRoot, "executor-evidence", "calls"), { recursive: true });
    fs.mkdirSync(path.join(chainRoot, "executor-evidence", "associations"), { recursive: true });
    fs.mkdirSync(path.join(chainRoot, "tips"), { recursive: true });
    const call = (callId: string) => ({
      schemaVersion: 1,
      callId,
      agentId: "bot",
      taskId: "task-chain",
      runId: "run-chain",
      scope,
      observedAt: 1,
      usage: fullUsage(1, 0),
    });
    fs.writeFileSync(
      path.join(chainRoot, "executor-evidence", "calls", "a.json"),
      JSON.stringify(call("A")),
    );
    fs.writeFileSync(
      path.join(chainRoot, "executor-evidence", "calls", "b.json"),
      JSON.stringify(call("B")),
    );
    fs.writeFileSync(
      path.join(chainRoot, "executor-evidence", "calls", "bad.json"),
      JSON.stringify({ callId: "bad" }),
    );
    const association = (callId: string) => ({
      schemaVersion: 1,
      agentId: "bot",
      runId: "run-chain",
      callId,
      trustedScope: scope,
      chain: { taskId: "task-chain", runId: "run-chain" },
      completeness: "complete",
      budgetCommandId: "budget-chain",
      finalOutcomeVersion: null,
    });
    fs.writeFileSync(
      path.join(chainRoot, "executor-evidence", "associations", "a1.json"),
      JSON.stringify(association("A")),
    );
    fs.writeFileSync(
      path.join(chainRoot, "executor-evidence", "associations", "a2.json"),
      JSON.stringify(association("A")),
    );
    fs.writeFileSync(
      path.join(chainRoot, "tips", "task-chain.json"),
      JSON.stringify({ taskId: "task-chain", outcomeVersion: 1, scope }),
    );
    const brokenClosure = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-chain",
      storeRoot: chainRoot,
    });
    expect(brokenClosure.gaps).toContain("call_schema_invalid");
    expect(brokenClosure.callChainCompleteness).toBe("partial");
    expect(brokenClosure.costAttributionCompleteness).toBe("partial");
    expect(brokenClosure.completeness).not.toBe("complete");
    fs.rmSync(path.join(chainRoot, "executor-evidence", "associations", "a2.json"));
    fs.rmSync(path.join(chainRoot, "executor-evidence", "calls", "b.json"));
    fs.rmSync(path.join(chainRoot, "executor-evidence", "calls", "bad.json"));
    const missingReceipt = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-chain",
      storeRoot: chainRoot,
    });
    expect(missingReceipt.callChainCompleteness).toBe("complete");
    expect(missingReceipt.costAttributionCompleteness).toBe("partial");
    expect(missingReceipt.completeness).not.toBe("complete");
  });

  it("refuses a large record after cap-1 and clears a stale lock and temp file", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    process.env.OPENBOT_EXECUTOR_EVIDENCE_DISK_CAP = "400";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r3-cap-"));
    roots.push(storeRoot);
    const dir = path.join(storeRoot, "executor-evidence", "associations");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pad.json"), "x".repeat(300));
    fs.writeFileSync(path.join(dir, "leftover.json.1.tmp"), "temp");
    const lockPath = path.join(storeRoot, "executor-evidence", "write.lock");
    fs.writeFileSync(lockPath, "999999");
    const stale = new Date(Date.now() - 10_000);
    fs.utimesSync(lockPath, stale, stale);
    const capped = writeBoundedEvidenceFile(storeRoot, "big.json", { pad: "y".repeat(200) });
    expect(capped).toBe("capped");
    expect(fs.existsSync(path.join(dir, "leftover.json.1.tmp"))).toBe(false);
    expect(fs.existsSync(path.join(storeRoot, "executor-evidence", "write.lock"))).toBe(false);
    expect(evidenceDiskByteCap()).toBe(400);
  });

  it("lets exactly one of two processes take the last disk slot", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    process.env.OPENBOT_EXECUTOR_EVIDENCE_DISK_CAP = "360";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r3-race-"));
    roots.push(storeRoot);
    const dir = path.join(storeRoot, "executor-evidence", "associations");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pad.json"), "x".repeat(100));
    const childPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "evidence-write-child.ts",
    );
    const run = (name: string) =>
      new Promise<string>((resolve, reject) => {
        const out = path.join(storeRoot, `${name}.json`);
        const child = spawn(
          process.execPath,
          ["--import", "tsx", childPath, storeRoot, `${name}.json`, "80", out],
          { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..") },
        );
        child.on("close", (code) => {
          if (!fs.existsSync(out)) {
            reject(new Error(`child ${name} ${code}`));
            return;
          }
          resolve((JSON.parse(fs.readFileSync(out, "utf8")) as { result: string }).result);
        });
      });
    const [left, right] = await Promise.all([run("left"), run("right")]);
    const results = [left, right].toSorted((a, b) => a.localeCompare(b));
    expect(results).toEqual(["capped", "written"]);
  });
});

describe("R3 identical replay and absent cost", () => {
  it("does not append a contradictory in-memory final when disk keeps the first", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r3-replaymem-"));
    roots.push(storeRoot);
    const base = {
      storeRoot,
      scope,
      agentId: "bot",
      taskId: "task-mem",
      runId: "run-mem",
      candidateAttemptId: "candidate",
      taskAttemptId: "attempt",
      chargeOutcomeVersion: 2,
      finalOutcomeVersion: 5,
      recordRuns: [{ runId: "run-mem", attemptIds: ["attempt"] }],
      recordAttempts: ["attempt"],
      receiptReturned: true,
    };
    publishFinalEvidenceLink(base);
    const replay = publishFinalEvidenceLink(base);
    expect(replay?.chargeOutcomeVersion).toBe(2);
    expect(listMemoryAssociations().filter((row) => row.finalOutcomeVersion === 5)).toHaveLength(1);
    const again = publishFinalEvidenceLink({ ...base, chargeOutcomeVersion: 4 });
    expect(again).toBeNull();
    const sameFinal = listMemoryAssociations().filter((row) => row.finalOutcomeVersion === 5);
    expect(sameFinal).toHaveLength(1);
    expect(sameFinal[0]?.chargeOutcomeVersion).toBe(2);
  });

  it("clears known totals for absent and evidence_missing", () => {
    const cost = buildCostColumns({
      usage: fullUsage(2, 0),
      provider: "local",
      model: "a",
      cost: rates,
      businessTaskId: "task-cost",
      runId: "run-cost",
    });
    expect(cost.total.status).toBe("known");
    for (const disposition of ["absent", "evidence_missing"] as const) {
      const linked = associateBudgetCharge({
        scope,
        agentId: "bot",
        taskId: "task-cost",
        runId: "run-cost",
        call: null,
        usage: fullUsage(2, 0),
        cost,
        budget: {
          commandId: `cmd-${disposition}`,
          requestDigest: null,
          disposition,
          commitId: null,
          chargeOutcomeVersion: null,
          closeOutcomeVersion: null,
          committedCostUsd: 2,
          costStatus: "known",
        },
      });
      expect(linked?.cost.total.status).not.toBe("known");
      expect(linked?.cost.total.amount).toBeNull();
      expect(linked?.callEstimate?.estimatedUsd.status).toBe("known");
    }
  });
});

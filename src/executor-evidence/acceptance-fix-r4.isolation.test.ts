/**
 * R4 counterexamples. Each case starts from one legal chain and changes one fact.
 * Isolation only: no gateway and no external model.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskOutcomeResultService } from "../task-outcome/result-service.js";
import {
  chargeModelCallAgainstTip,
  recordRunnerTurnOutcome,
  runModelCandidateWithSingleCharge,
  type ModelCallCloseoutLink,
} from "../task-outcome/runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import type { TrustedScope } from "../task-outcome/types.js";
import { publishFinalEvidenceLink, resetEvidenceAssociations } from "./association.js";
import {
  observeModelCandidate,
  processStartToken,
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
  resetEvidenceAssociations();
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE_DISK_CAP;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function legalChain(label: string) {
  process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), `executor-evidence-r4-${label}-`));
  roots.push(agentDir);
  const cfg = agentCfg(agentDir);
  const taskId = `task-${label}`;
  const runId = `run-${label}`;
  const storeRoot = path.join(agentDir, "task-outcomes");
  const link = await observeModelCandidate({
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
      return charged.modelCallLink;
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
    deliveryId: "del-r4",
  });
  const view = readExecutorEvidence({
    agentId: "bot",
    scope,
    taskId,
    runId,
    storeRoot,
    outcomeVersion: closed.record.outcomeVersion,
  });
  return { cfg, agentDir, storeRoot, taskId, runId, link, closed, view };
}

describe("R4 commit and association identity", () => {
  it("accepts one legal chain before any mutation", async () => {
    const chain = await legalChain("legal");
    expect(chain.view.completeness).toBe("complete");
    expect(chain.view.callChainCompleteness).toBe("complete");
    expect(chain.view.costAttributionCompleteness).toBe("complete");
  });

  it("stays partial when the final link omits the budget receipt", async () => {
    const chain = await legalChain("no-receipt");
    const bare = publishFinalEvidenceLink({
      storeRoot: chain.storeRoot,
      scope,
      agentId: "bot",
      taskId: "task-bare",
      runId: "run-bare",
      candidateAttemptId: "candidate",
      taskAttemptId: "attempt",
      chargeOutcomeVersion: 2,
      finalOutcomeVersion: 4,
      recordRuns: [{ runId: "run-bare", attemptIds: ["attempt"] }],
      recordAttempts: ["attempt"],
      receiptReturned: true,
      snapshotFingerprint: "abc",
    });
    expect(bare?.completeness).not.toBe("complete");
  });

  it("rejects a swapped budget receipt on a stable call", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r4-swap-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    const storeRoot = path.join(agentDir, "task-outcomes");
    const links: ModelCallCloseoutLink[] = [];
    for (const [index, usage] of [
      [0, fullUsage(1, 0)],
      [1, fullUsage(3, 0)],
    ] as const) {
      await observeModelCandidate({
        context: {
          agentId: "bot",
          scope,
          taskId: "task-swap",
          runId: "run-swap",
          storeRoot,
          provenance: "injected",
          collector: "isolation",
        },
        attemptIndex: index,
        provider: "local",
        model: index === 0 ? "a" : "b",
        run: async () => {
          const charged = chargeModelCallAgainstTip(cfg, "bot", {
            taskId: "task-swap",
            scope,
            runId: "run-swap",
            callSeq: index + 1,
            provider: "local",
            model: index === 0 ? "a" : "b",
            usage,
            budgetLimits: { maxIterations: 8, maxCostUsd: 30, maxDurationMinutes: 30 },
          });
          if (charged.modelCallLink) {
            links.push(charged.modelCallLink);
          }
          return "ok";
        },
      });
    }
    const first = links[0];
    const second = links[1];
    if (!first || !second) {
      throw new Error("two links");
    }
    const closed = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-swap",
      taskId: "task-swap",
      scope,
      skipBudgetCharge: true,
      modelCallLinks: [
        first,
        {
          ...second,
          commandId: first.commandId,
          chargeCommitId: first.chargeCommitId,
          requestDigest: first.requestDigest,
          chargeOutcomeVersion: first.chargeOutcomeVersion,
        },
      ],
    });
    const swapped = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-swap",
      runId: "run-swap",
      storeRoot,
      outcomeVersion: closed.record.outcomeVersion,
    });
    expect(swapped.completeness).not.toBe("complete");
    expect(
      swapped.associations.some(
        (row) => row.callId === second.callId && row.budgetCommandId === first.commandId,
      ),
    ).toBe(false);
  });

  it("breaks the chain when the final snapshot fingerprint is removed", async () => {
    const chain = await legalChain("no-fp");
    const dir = path.join(chain.storeRoot, "executor-evidence", "associations");
    const file = fs.readdirSync(dir).find((name) => name.includes("final-"));
    if (!file) {
      throw new Error("final file");
    }
    const body = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
      finalSnapshotFingerprint: string;
    };
    body.finalSnapshotFingerprint = "";
    fs.writeFileSync(path.join(dir, file), `${JSON.stringify(body)}\n`);
    const view = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: chain.taskId,
      runId: chain.runId,
      storeRoot: chain.storeRoot,
      outcomeVersion: chain.closed.record.outcomeVersion,
    });
    expect(view.gaps).toContain("association_fingerprint_absent");
    expect(view.completeness).not.toBe("complete");
    expect(view.callChainCompleteness).not.toBe("complete");
  });

  it("isolates a delivery tamper on the final snapshot", async () => {
    const chain = await legalChain("delivery");
    const versionPath = path.join(
      chain.storeRoot,
      "versions",
      `${chain.taskId}__v${chain.closed.record.outcomeVersion}.json`,
    );
    const snapshot = JSON.parse(fs.readFileSync(versionPath, "utf8")) as {
      delivery: { status: string };
    };
    snapshot.delivery.status = "failed";
    fs.writeFileSync(versionPath, `${JSON.stringify(snapshot)}\n`);
    const view = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: chain.taskId,
      runId: chain.runId,
      storeRoot: chain.storeRoot,
      outcomeVersion: chain.closed.record.outcomeVersion,
    });
    expect(view.completeness).not.toBe("complete");
    expect(view.gaps.join(" ")).toMatch(
      /snapshot_identity_mismatch|association_fingerprint_mismatch/,
    );
    expect(view.associations).toEqual([]);
  });

  it("does not return a tampered log spend from the original receipt boundary", async () => {
    const chain = await legalChain("spend");
    const store = new DurableTaskOutcomeStore(chain.storeRoot);
    const commandId = chain.link.commandId;
    const logPath = store.commandLogPath(commandId);
    const raw = JSON.parse(fs.readFileSync(logPath, "utf8")) as {
      committedSpend: { costUsd: number };
      outcomeVersion: number;
    };
    raw.committedSpend.costUsd = 50;
    fs.writeFileSync(logPath, `${JSON.stringify(raw)}\n`);
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const tip = store.loadTask(chain.taskId);
    const replay = service.submit(
      chain.taskId,
      {
        type: "accumulate_budget_spend",
        iterations: 1,
        costUsd: 1,
        costEvidence: "known",
        expectedVersion: raw.outcomeVersion - 1,
        fencingToken: tip?.fencingToken ?? "",
      },
      { commandId, requiredScope: scope },
    );
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay).not.toHaveProperty("committedSpend");
    }
  });
});

describe("R4 persistence protocol", () => {
  it("does not delete a live owner's lock after two seconds", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r4-lock-"));
    roots.push(storeRoot);
    const lockPath = path.join(storeRoot, "executor-evidence", "write.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const token = processStartToken(process.pid);
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, startToken: token ?? "unknown", lockId: "live-owner" }),
    );
    const stale = new Date(Date.now() - 10_000);
    fs.utimesSync(lockPath, stale, stale);
    const result = writeBoundedEvidenceFile(storeRoot, "late.json", { pad: "a" });
    expect(result).toBe("failed");
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("keeps association immutable and refuses a call usage rewrite", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r4-evolve-"));
    roots.push(storeRoot);
    const body = {
      evidenceId: "mce_1",
      callId: "call_1",
      status: "unknown",
      usage: { input: null, output: null, cacheRead: null, cacheWrite: null },
    };
    expect(
      writeBoundedEvidenceFile(
        storeRoot,
        "assoc.json",
        { kind: "budget", callId: "call_1" },
        "associations",
      ),
    ).toBe("written");
    expect(
      writeBoundedEvidenceFile(
        storeRoot,
        "assoc.json",
        { kind: "budget", callId: "call_2" },
        "associations",
      ),
    ).toBe("conflict");
    expect(writeBoundedEvidenceFile(storeRoot, "call.json", body, "calls")).toBe("written");
    expect(
      writeBoundedEvidenceFile(
        storeRoot,
        "call.json",
        { ...body, status: "failed", usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } },
        "calls",
      ),
    ).toBe("written");
    expect(
      writeBoundedEvidenceFile(
        storeRoot,
        "call.json",
        { ...body, status: "failed", usage: { input: 9, output: 0, cacheRead: 0, cacheWrite: 0 } },
        "calls",
      ),
    ).toBe("conflict");
  });

  it("counts the file being replaced in the peak disk budget", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    process.env.OPENBOT_EXECUTOR_EVIDENCE_DISK_CAP = "500";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r4-peak-"));
    roots.push(storeRoot);
    const dir = path.join(storeRoot, "executor-evidence", "calls");
    fs.mkdirSync(dir, { recursive: true });
    const original = {
      evidenceId: "mce_peak",
      callId: "call_peak",
      status: "unknown",
      usage: { input: null, output: null, cacheRead: null, cacheWrite: null },
      usageSource: "x".repeat(400),
    };
    fs.writeFileSync(path.join(dir, "peak.json"), `${JSON.stringify(original)}\n`);
    const smaller = { ...original, status: "failed", usageSource: "y" };
    expect(writeBoundedEvidenceFile(storeRoot, "peak.json", smaller, "calls")).toBe("capped");
    expect(fs.readFileSync(path.join(dir, "peak.json"), "utf8")).toContain("x".repeat(40));
  });
});

describe("R4 read contract and single charge", () => {
  it("does not throw when attempts is not an array", async () => {
    const chain = await legalChain("shape");
    const versionPath = path.join(
      chain.storeRoot,
      "versions",
      `${chain.taskId}__v${chain.closed.record.outcomeVersion}.json`,
    );
    const snapshot = JSON.parse(fs.readFileSync(versionPath, "utf8")) as { attempts: unknown };
    snapshot.attempts = { bad: true };
    fs.writeFileSync(versionPath, `${JSON.stringify(snapshot)}\n`);
    const view = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: chain.taskId,
      runId: chain.runId,
      storeRoot: chain.storeRoot,
      outcomeVersion: chain.closed.record.outcomeVersion,
    });
    expect(view.gaps).toContain("association_structure_invalid");
    expect(view.completeness).not.toBe("complete");
  });

  it("charges a candidate once when post-processing throws, and keeps missing usage unknown", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r4-once-"));
    roots.push(agentDir);
    const cfg = agentCfg(agentDir);
    const storeRoot = path.join(agentDir, "task-outcomes");
    await expect(
      runModelCandidateWithSingleCharge({
        run: async () => fullUsage(1, 0),
        charge: (outcome) => {
          chargeModelCallAgainstTip(cfg, "bot", {
            taskId: "task-once",
            scope,
            runId: "run-once",
            callSeq: 1,
            provider: "local",
            model: "a",
            usage: outcome.ok ? outcome.value : undefined,
            budgetLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
          });
          if (outcome.ok) {
            throw new Error("post-process after charge");
          }
        },
      }),
    ).rejects.toThrow("post-process after charge");
    const logs = fs
      .readdirSync(path.join(storeRoot, "command-log"))
      .filter((name) => name.includes("budget-spend"));
    expect(logs).toHaveLength(1);
    await expect(
      runModelCandidateWithSingleCharge({
        run: async () => {
          throw new Error("candidate failed");
        },
        charge: () => {
          chargeModelCallAgainstTip(cfg, "bot", {
            taskId: "task-unknown",
            scope,
            runId: "run-unknown",
            callSeq: 1,
            provider: "local",
            model: "a",
            budgetLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
          });
        },
      }),
    ).rejects.toThrow("candidate failed");
    const unknownLog = fs
      .readdirSync(path.join(storeRoot, "command-log"))
      .map((name) => path.join(storeRoot, "command-log", name))
      .map(
        (file) =>
          JSON.parse(fs.readFileSync(file, "utf8")) as {
            committedSpend?: { costUsd: number | null; costEvidence: string | null };
          },
      )
      .find((row) => row.committedSpend && row.committedSpend.costUsd == null);
    expect(unknownLog?.committedSpend?.costEvidence).not.toBe("known");
  });
});

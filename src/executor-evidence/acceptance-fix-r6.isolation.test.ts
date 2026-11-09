/**
 * R6 counterexamples. One legal fact, then one change, with the specific rejection.
 * Isolation only: no gateway and no external model.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildTaskBudgetState } from "../task-outcome/budget.js";
import { TaskOutcomeResultService } from "../task-outcome/result-service.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import type { TrustedScope } from "../task-outcome/types.js";
import { writeBoundedEvidenceFile } from "./model-call-evidence.js";
import { readExecutorEvidence } from "./read-port.js";

const scope: TrustedScope = {
  kind: "enterprise",
  enterpriseDomainId: "enterprise:acme",
  tenantId: "tenant-a",
  subjectRef: "user:evidence",
  authzScopeRef: "authz:desk",
};
const roots: string[] = [];

afterEach(() => {
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function spendTransition(version: number, token: string) {
  return {
    type: "accumulate_budget_spend" as const,
    iterations: 1,
    costUsd: 1,
    costEvidence: "known" as const,
    expectedVersion: version,
    fencingToken: token,
  };
}

describe("R6 legacy digest and tampered spend", () => {
  it("replays an old transition digest that has no call binding", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r6-legacy-"));
    roots.push(storeRoot);
    const store = new DurableTaskOutcomeStore(storeRoot);
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const created = service.submit(
      "task-legacy",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "create-legacy", requiredScope: scope },
    );
    if (!created.ok) {
      throw new Error("create");
    }
    const charged = service.submit(
      "task-legacy",
      spendTransition(created.record.outcomeVersion, created.record.fencingToken ?? ""),
      { commandId: "budget-legacy", requiredScope: scope },
    );
    expect(charged.ok).toBe(true);
    const logPath = store.commandLogPath("budget-legacy");
    const raw = JSON.parse(fs.readFileSync(logPath, "utf8")) as {
      digest: string;
      transitionDigest?: string;
      callBinding?: unknown;
    };
    if (!raw.transitionDigest) {
      throw new Error("transition digest");
    }
    const legacyDigest = raw.transitionDigest;
    raw.digest = legacyDigest;
    delete raw.transitionDigest;
    delete raw.callBinding;
    fs.writeFileSync(logPath, `${JSON.stringify(raw)}\n`);
    const commitDir = path.join(storeRoot, "commits");
    for (const name of fs.readdirSync(commitDir)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const commitPath = path.join(commitDir, name);
      const bundle = JSON.parse(fs.readFileSync(commitPath, "utf8")) as {
        commandLog?: {
          commandId?: string;
          digest?: string;
          transitionDigest?: string;
          callBinding?: unknown;
        };
      };
      if (bundle.commandLog?.commandId !== "budget-legacy") {
        continue;
      }
      bundle.commandLog.digest = legacyDigest;
      delete bundle.commandLog.transitionDigest;
      delete bundle.commandLog.callBinding;
      fs.writeFileSync(commitPath, `${JSON.stringify(bundle)}\n`);
    }
    const replay = service.submit(
      "task-legacy",
      spendTransition(created.record.outcomeVersion, created.record.fencingToken ?? ""),
      { commandId: "budget-legacy", requiredScope: scope },
    );
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.commandReceipt?.disposition).toBe("replayed");
    }
  });

  it("rejects only a tampered committed spend after a legal replay", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r6-spend-"));
    roots.push(storeRoot);
    const store = new DurableTaskOutcomeStore(storeRoot);
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const created = service.submit(
      "task-spend",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "create-spend", requiredScope: scope },
    );
    if (!created.ok) {
      throw new Error("create");
    }
    const binding = {
      callId: "call-spend",
      evidenceId: "mce-spend",
      usageFingerprint: "usage-spend",
    };
    const transition = spendTransition(
      created.record.outcomeVersion,
      created.record.fencingToken ?? "",
    );
    const charged = service.submit("task-spend", transition, {
      commandId: "budget-spend",
      requiredScope: scope,
      callBinding: binding,
    });
    expect(charged.ok).toBe(true);
    const replay = service.submit("task-spend", transition, {
      commandId: "budget-spend",
      requiredScope: scope,
      callBinding: binding,
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.commandReceipt?.disposition).toBe("replayed");
    }
    const logPath = store.commandLogPath("budget-spend");
    const raw = JSON.parse(fs.readFileSync(logPath, "utf8")) as {
      committedSpend: { costUsd: number };
    };
    raw.committedSpend.costUsd = 50;
    fs.writeFileSync(logPath, `${JSON.stringify(raw)}\n`);
    const tampered = service.submit("task-spend", transition, {
      commandId: "budget-spend",
      requiredScope: scope,
      callBinding: binding,
    });
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      expect(tampered.code).toBe("evidence_missing");
      expect(tampered.evidenceGap?.reason).toBe("commit_identity_mismatch");
    }
  });
});

describe("R6 call schema and terminal fields", () => {
  it("excludes one illegal call field as call_schema_invalid", () => {
    const base = {
      schemaVersion: 1,
      callId: "call-ok",
      evidenceId: "mce-ok",
      attemptId: "attempt-ok",
      provenance: "injected",
      agentId: "bot",
      taskId: "task-schema",
      runId: "run-schema",
      scope,
      startedAt: 10,
      observedAt: 20,
      status: "failed",
      completedAt: 15,
      usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const faults = [
      { usage: { input: -1, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { usage: { input: 1.5, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { observedAt: 5 },
      { provenance: "browser" },
      { status: "failed", completedAt: null },
      { status: "unknown", completedAt: 15 },
    ];
    for (const fault of faults) {
      const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r6-schema-"));
      roots.push(storeRoot);
      fs.mkdirSync(path.join(storeRoot, "executor-evidence", "calls"), { recursive: true });
      fs.mkdirSync(path.join(storeRoot, "tips"), { recursive: true });
      fs.writeFileSync(
        path.join(storeRoot, "tips", "task-schema.json"),
        JSON.stringify({ taskId: "task-schema", outcomeVersion: 1, scope }),
      );
      fs.writeFileSync(
        path.join(storeRoot, "executor-evidence", "calls", "bad.json"),
        JSON.stringify({ ...base, ...fault }),
      );
      const view = readExecutorEvidence({
        agentId: "bot",
        scope,
        taskId: "task-schema",
        storeRoot,
      });
      expect(view.gaps).toContain("call_schema_invalid");
      expect(view.calls).toEqual([]);
    }
  });

  it("rejects a rewritten terminal timestamp as conflict", () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r6-terminal-"));
    roots.push(storeRoot);
    const base = {
      evidenceId: "mce_term",
      callId: "call_term",
      status: "failed",
      terminalCause: "error",
      startedAt: 10,
      observedAt: 30,
      completedAt: 20,
      providerRequestId: "req-1",
      providerResponseId: "res-1",
      usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    expect(writeBoundedEvidenceFile(storeRoot, "call.json", base, "calls")).toBe("written");
    expect(
      writeBoundedEvidenceFile(storeRoot, "call.json", { ...base, completedAt: 21 }, "calls"),
    ).toBe("conflict");
    expect(
      writeBoundedEvidenceFile(storeRoot, "call.json", { ...base, observedAt: 10 }, "calls"),
    ).toBe("conflict");
    expect(
      writeBoundedEvidenceFile(
        storeRoot,
        "call.json",
        { ...base, providerRequestId: "req-2" },
        "calls",
      ),
    ).toBe("conflict");
  });
});

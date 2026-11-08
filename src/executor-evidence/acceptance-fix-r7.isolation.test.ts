/**
 * R7 evidence. Isolation only: no gateway and no external model.
 * The lock cases live in acceptance-fix-r5 and are re-run on their own.
 * The cron post-processing case lives in acceptance-fix-r3-cron-entry.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildTaskBudgetState } from "../task-outcome/budget.js";
import { TaskOutcomeResultService } from "../task-outcome/result-service.js";
import {
  rememberModelResultUsage,
  runModelCandidateWithSingleCharge,
} from "../task-outcome/runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import type { TaskOutcomeRecord, TrustedScope } from "../task-outcome/types.js";
import { snapshotIdentityFingerprint } from "./identity.js";
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
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** Pre-upgrade command log. No transitionDigest, callBinding, or commandDisposition. */
const PRE_UPGRADE_COMMAND_LOG = {
  commandId: "budget-old",
  digest: "",
  taskId: "task-old",
  outcomeVersion: 0,
  commitId: "",
  snapshotFingerprint: "",
  committedSpend: { iterations: 1, costUsd: 1, costEvidence: "known" as const },
};

function transitionDigest(taskId: string, transition: unknown): string {
  return createHash("sha256").update(JSON.stringify({ taskId, transition })).digest("hex");
}

describe("R7 read status and clock", () => {
  it("normalizes a missing status to unknown and does not return the raw object", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r7-status-"));
    roots.push(storeRoot);
    fs.mkdirSync(path.join(storeRoot, "executor-evidence", "calls"), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, "tips"), { recursive: true });
    fs.writeFileSync(
      path.join(storeRoot, "tips", "task-status.json"),
      JSON.stringify({ taskId: "task-status", outcomeVersion: 1, scope }),
    );
    const raw = {
      schemaVersion: 1,
      callId: "call-legacy",
      evidenceId: "mce-legacy",
      attemptId: "attempt-legacy",
      provenance: "injected",
      agentId: "bot",
      taskId: "task-status",
      runId: "run-status",
      scope,
      startedAt: 10,
      observedAt: 20,
      completedAt: null,
      usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    fs.writeFileSync(
      path.join(storeRoot, "executor-evidence", "calls", "legacy.json"),
      JSON.stringify(raw),
    );
    const view = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-status",
      storeRoot,
    });
    expect(view.gaps).toContain("call_status_legacy");
    expect(view.calls).toHaveLength(1);
    expect(view.calls[0]?.status).toBe("unknown");
    expect(view.calls[0]).not.toBe(raw);
  });

  it("marks a future observedAt as an untrusted clock and leaves it out of the watermark", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r7-clock-"));
    roots.push(storeRoot);
    fs.mkdirSync(path.join(storeRoot, "executor-evidence", "calls"), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, "tips"), { recursive: true });
    fs.writeFileSync(
      path.join(storeRoot, "tips", "task-clock.json"),
      JSON.stringify({ taskId: "task-clock", outcomeVersion: 1, scope }),
    );
    const future = Date.now() + 60_000;
    fs.writeFileSync(
      path.join(storeRoot, "executor-evidence", "calls", "future.json"),
      JSON.stringify({
        schemaVersion: 1,
        callId: "call-future",
        evidenceId: "mce-future",
        attemptId: "attempt-future",
        provenance: "injected",
        agentId: "bot",
        taskId: "task-clock",
        runId: "run-clock",
        scope,
        startedAt: future - 10,
        observedAt: future,
        status: "unknown",
        completedAt: null,
        usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    );
    const view = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-clock",
      storeRoot,
    });
    expect(view.gaps).toContain("clock_untrusted");
    expect(view.capacity.watermark).toBeNull();
    expect(view.completeness).not.toBe("complete");
  });
});

describe("R7 pre-upgrade command log", () => {
  it("does not call a pre-upgrade log a payload conflict, and replays a new log", () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-r7-oldlog-"));
    roots.push(storeRoot);
    const store = new DurableTaskOutcomeStore(storeRoot);
    const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
    const created = service.submit(
      "task-old",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 8, maxCostUsd: 20, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "create-old", requiredScope: scope },
    );
    if (!created.ok) {
      throw new Error("create");
    }
    const fresh = service.submit(
      "task-old",
      {
        type: "accumulate_budget_spend",
        iterations: 1,
        costUsd: 1,
        costEvidence: "known",
        expectedVersion: created.record.outcomeVersion,
        fencingToken: created.record.fencingToken ?? "",
      },
      { commandId: "budget-new", requiredScope: scope },
    );
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) {
      return;
    }
    const versionPath = path.join(
      storeRoot,
      "versions",
      `task-old__v${fresh.record.outcomeVersion}.json`,
    );
    const snapshot = JSON.parse(fs.readFileSync(versionPath, "utf8")) as TaskOutcomeRecord;
    const fingerprint = snapshotIdentityFingerprint(snapshot);
    const transition = {
      type: "accumulate_budget_spend" as const,
      iterations: 1,
      costUsd: 1,
      costEvidence: "known" as const,
      expectedVersion: created.record.outcomeVersion,
      fencingToken: created.record.fencingToken ?? "",
    };
    const digest = transitionDigest("task-old", transition);
    const oldLog = {
      ...PRE_UPGRADE_COMMAND_LOG,
      digest,
      taskId: "task-old",
      outcomeVersion: fresh.record.outcomeVersion,
      commitId: "c_pre_upgrade",
      snapshotFingerprint: fingerprint,
    };
    expect(Object.keys(oldLog).toSorted()).toEqual(
      [
        "commandId",
        "commitId",
        "committedSpend",
        "digest",
        "outcomeVersion",
        "snapshotFingerprint",
        "taskId",
      ].toSorted(),
    );
    fs.writeFileSync(store.commandLogPath("budget-old"), `${JSON.stringify(oldLog)}\n`);
    fs.writeFileSync(
      path.join(storeRoot, "commits", "c_pre_upgrade.json"),
      JSON.stringify({
        commitId: "c_pre_upgrade",
        taskId: "task-old",
        expectedVersion: created.record.outcomeVersion,
        record: snapshot,
        events: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        commandLog: oldLog,
      }),
    );
    const legacy = service.submit("task-old", transition, {
      commandId: "budget-old",
      requiredScope: scope,
    });
    if (!legacy.ok) {
      expect(legacy.code).toBe("evidence_missing");
      expect(legacy.commandConflict?.reason).not.toBe("payload_conflict");
    } else {
      expect(legacy.commandReceipt?.disposition).toBe("replayed");
    }
    const again = service.submit("task-old", transition, {
      commandId: "budget-new",
      requiredScope: scope,
    });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.commandReceipt?.disposition).toBe("replayed");
    }
  });
});

describe("R7 followup charge window", () => {
  it("keeps model usage when the post-result step throws", async () => {
    const seen: unknown[] = [];
    await expect(
      runModelCandidateWithSingleCharge({
        run: async () => ({
          meta: { agentMeta: { usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0 } } },
        }),
        noteResponse: (value) => {
          seen.push(rememberModelResultUsage(value.meta.agentMeta.usage));
        },
        afterResponse: () => {
          throw new Error("followup bootstrap failed");
        },
        charge: (outcome) => {
          expect(outcome.ok).toBe(true);
          if (outcome.ok) {
            seen.push(outcome.value.meta.agentMeta.usage);
          }
        },
      }),
    ).rejects.toThrow("followup bootstrap failed");
    expect(seen[0]).toEqual({ input: 3, output: 2, cacheRead: 0, cacheWrite: 0 });
    expect(seen[1]).toEqual({ input: 3, output: 2, cacheRead: 0, cacheWrite: 0 });
  });
});

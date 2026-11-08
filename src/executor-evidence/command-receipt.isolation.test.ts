/**
 * Isolation-only CommandReceipt proofs.
 * Drives the real ResultService/store. No gateway, no network, no production state.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildTaskBudgetState } from "../task-outcome/budget.js";
import { TaskOutcomeResultService } from "../task-outcome/result-service.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import type { CommandReceipt, SubmitResult, TrustedScope } from "../task-outcome/types.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:evidence",
  subjectRef: "user:evidence",
  authzScopeRef: "scope:isolation",
};

const roots: string[] = [];

function openService(): {
  root: string;
  store: DurableTaskOutcomeStore;
  service: TaskOutcomeResultService;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-cmd-"));
  roots.push(root);
  const store = new DurableTaskOutcomeStore(root);
  const service = new TaskOutcomeResultService({ store, submittedBy: "isolation" });
  return { root, store, service };
}

function receiptOf(result: SubmitResult): CommandReceipt | undefined {
  return result.ok ? result.commandReceipt : undefined;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CommandReceipt at the ResultService commit boundary", () => {
  it("applied points at the immutable version and the real commit id", () => {
    const { store, service } = openService();
    const applied = service.submit(
      "task-a",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "ctr-1",
      },
      { commandId: "cmd-create", requiredScope: scope },
    );
    expect(applied.ok).toBe(true);
    const receipt = receiptOf(applied);
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      commandId: "cmd-create",
      taskId: "task-a",
      outcomeVersion: 1,
      disposition: "applied",
    });
    expect(receipt?.commitId).toMatch(/^c_/);
    expect(receipt?.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    const snapshot = store.loadTaskVersion("task-a", receipt!.outcomeVersion);
    expect(snapshot?.outcomeVersion).toBe(1);
    const stored = store.loadCommand("cmd-create");
    expect(stored?.commitId).toBe(receipt?.commitId);
    expect(stored?.outcomeVersion).toBe(1);
  });

  it("replays the same command and payload without a second commit", () => {
    const { service } = openService();
    const transition = {
      type: "create" as const,
      entrypoint: "chat" as const,
      scope,
      taskContractVersion: "ctr-1",
    };
    const first = service.submit("task-replay", transition, {
      commandId: "cmd-replay",
      requiredScope: scope,
    });
    const second = service.submit("task-replay", transition, {
      commandId: "cmd-replay",
      requiredScope: scope,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(first.commandReceipt?.disposition).toBe("applied");
    expect(second.commandReceipt).toMatchObject({
      disposition: "replayed",
      outcomeVersion: first.commandReceipt?.outcomeVersion,
      commitId: first.commandReceipt?.commitId,
      requestDigest: first.commandReceipt?.requestDigest,
    });
    expect(second.createdEvents).toEqual([]);
    expect(second.record.outcomeVersion).toBe(1);
    expect(second.record.outcomeVersion).toBe(first.record.outcomeVersion);
  });

  it("conflicts when the same command id carries a different payload", () => {
    const { store, service } = openService();
    const first = service.submit(
      "task-conflict",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "ctr-1" },
      { commandId: "cmd-conflict", requiredScope: scope },
    );
    const second = service.submit(
      "task-conflict",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "ctr-OTHER" },
      { commandId: "cmd-conflict", requiredScope: scope },
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }
    expect(second.code).toBe("command_conflict");
    expect(second.commandConflict).toMatchObject({
      commandId: "cmd-conflict",
      storedOutcomeVersion: 1,
    });
    expect(second.commandConflict?.requestDigest).not.toBe(second.commandConflict?.storedDigest);
    expect(second).not.toHaveProperty("commandReceipt");
    expect(store.loadTask("task-conflict")?.outcomeVersion).toBe(1);
    const versions = fs
      .readdirSync(path.join(store.rootDir, "versions"))
      .filter((name) => name.endsWith(".json"));
    expect(versions).toHaveLength(1);
  });

  it("keeps commitId null for a legacy command log and does not backfill it", () => {
    const { store, service } = openService();
    const applied = service.submit(
      "task-legacy",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "ctr-1" },
      { commandId: "cmd-legacy", requiredScope: scope },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    const logPath = store.commandLogPath("cmd-legacy");
    const raw = JSON.parse(fs.readFileSync(logPath, "utf8")) as Record<string, unknown>;
    delete raw.commitId;
    fs.writeFileSync(logPath, `${JSON.stringify(raw, null, 2)}\n`);
    const reopened = new TaskOutcomeResultService({
      store: new DurableTaskOutcomeStore(store.rootDir),
    });
    const replay = reopened.submit(
      "task-legacy",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "ctr-1" },
      { commandId: "cmd-legacy", requiredScope: scope },
    );
    expect(replay.ok).toBe(true);
    if (!replay.ok) {
      return;
    }
    expect(replay.commandReceipt).toMatchObject({
      disposition: "replayed",
      outcomeVersion: 1,
      commitId: null,
    });
    const after = JSON.parse(fs.readFileSync(logPath, "utf8")) as { commitId?: string };
    expect(after.commitId).toBeUndefined();
  });

  it("reports evidence missing when the command version snapshot is gone", () => {
    const { store, service } = openService();
    const applied = service.submit(
      "task-gap",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "ctr-1" },
      { commandId: "cmd-gap", requiredScope: scope },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok || !applied.commandReceipt) {
      throw new Error("expected applied receipt");
    }
    const tip = service.submit(
      "task-gap",
      {
        type: "prepare_failed",
        reasonCode: "preflight_rejected",
        reasonDetail: "later tip",
      },
      { requiredScope: scope, commandId: "cmd-later-tip" },
    );
    expect(tip.ok).toBe(true);
    fs.rmSync(store.versionPath("task-gap", applied.commandReceipt.outcomeVersion));
    const replay = service.submit(
      "task-gap",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "ctr-1" },
      { commandId: "cmd-gap", requiredScope: scope },
    );
    expect(replay.ok).toBe(false);
    if (replay.ok) {
      return;
    }
    expect(replay.code).toBe("evidence_missing");
    expect(replay.evidenceGap).toMatchObject({
      reason: "version_snapshot_missing",
      outcomeVersion: 1,
      commandId: "cmd-gap",
    });
    expect(replay).not.toHaveProperty("commandReceipt");
    expect(store.loadTask("task-gap")?.outcomeVersion).not.toBe(1);
  });

  it("does not persist a command log or commit id for no_effect", () => {
    const { store, service } = openService();
    const created = service.submit(
      "task-noop",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "ctr-1" },
      { commandId: "cmd-open", requiredScope: scope },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const budget = buildTaskBudgetState({
      taskLimits: { maxIterations: 2, maxCostUsd: 1, maxDurationMinutes: 5 },
    });
    const first = service.submit(
      "task-noop",
      {
        type: "set_budget",
        budget,
        expectedVersion: created.record.outcomeVersion,
        fencingToken: created.record.fencingToken ?? "",
      },
      { commandId: "cmd-budget", requiredScope: scope },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = service.submit(
      "task-noop",
      {
        type: "set_budget",
        budget,
        expectedVersion: first.record.outcomeVersion,
        fencingToken: first.record.fencingToken ?? "",
      },
      { commandId: "cmd-budget-noop", requiredScope: scope },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.createdEvents).toEqual([]);
    expect(second.commandReceipt).toMatchObject({
      disposition: "no_effect",
      commitId: null,
      outcomeVersion: first.record.outcomeVersion,
    });
    expect(fs.existsSync(store.commandLogPath("cmd-budget-noop"))).toBe(false);
    expect(store.loadTask("task-noop")?.outcomeVersion).toBe(first.record.outcomeVersion);
  });

  it("gives budget charge and exhaustion close distinct versions", () => {
    const { service } = openService();
    const created = service.submit(
      "task-budget-versions",
      {
        type: "create",
        entrypoint: "chat",
        scope,
        taskContractVersion: "ctr-1",
        budget: buildTaskBudgetState({
          taskLimits: { maxIterations: 1, maxCostUsd: 10, maxDurationMinutes: 30 },
        }),
      },
      { commandId: "cmd-open-budget", requiredScope: scope },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const charged = service.submit(
      "task-budget-versions",
      {
        type: "accumulate_budget_spend",
        iterations: 1,
        costUsd: 0.25,
        costEvidence: "known",
        expectedVersion: created.record.outcomeVersion,
        fencingToken: created.record.fencingToken ?? "",
      },
      { commandId: "budget-spend:task-budget-versions:run:call:1", requiredScope: scope },
    );
    expect(charged.ok).toBe(true);
    if (!charged.ok || !charged.commandReceipt) {
      throw new Error("expected charge receipt");
    }
    const closed = service.submit(
      "task-budget-versions",
      {
        type: "fail_closed",
        reasonCode: "budget_exceeded",
        reasonDetail: "iterations exhausted",
        expectedVersion: charged.record.outcomeVersion,
        fencingToken: charged.record.fencingToken ?? "",
      },
      { commandId: "budget-exceeded:task-budget-versions:run:call:1", requiredScope: scope },
    );
    expect(closed.ok).toBe(true);
    if (!closed.ok || !closed.commandReceipt) {
      throw new Error("expected close receipt");
    }
    expect(charged.commandReceipt.disposition).toBe("applied");
    expect(closed.commandReceipt.disposition).toBe("applied");
    expect(closed.commandReceipt.outcomeVersion).toBeGreaterThan(
      charged.commandReceipt.outcomeVersion,
    );
    expect(closed.commandReceipt.commitId).not.toBe(charged.commandReceipt.commitId);
    expect(closed.record.reasonCode).toBe("budget_exceeded");
    expect(closed.record.taskJudgement).not.toBe("success");
  });

  it("replays the original version after a process restart", () => {
    const { root, store, service } = openService();
    const applied = service.submit(
      "task-restart",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "ctr-1" },
      { commandId: "cmd-restart", requiredScope: scope },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok || !applied.commandReceipt) {
      throw new Error("expected applied");
    }
    store.close();
    const restarted = new TaskOutcomeResultService({
      store: new DurableTaskOutcomeStore(root),
    });
    const replay = restarted.submit(
      "task-restart",
      { type: "create", entrypoint: "chat", scope, taskContractVersion: "ctr-1" },
      { commandId: "cmd-restart", requiredScope: scope },
    );
    expect(replay.ok).toBe(true);
    if (!replay.ok) {
      return;
    }
    expect(replay.commandReceipt).toMatchObject({
      disposition: "replayed",
      outcomeVersion: applied.commandReceipt.outcomeVersion,
      commitId: applied.commandReceipt.commitId,
    });
  });

  it("lets exactly one of two processes apply the same command", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-race-"));
    roots.push(root);
    const childPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "command-race-child.ts",
    );
    const runChild = (name: string) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const outFile = path.join(root, `${name}.json`);
        const child = spawn(
          process.execPath,
          ["--import", "tsx", childPath, root, "task-race", "cmd-race", outFile],
          { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..") },
        );
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("close", (code) => {
          if (!fs.existsSync(outFile)) {
            reject(new Error(`child ${name} exited ${code}: ${stderr}`));
            return;
          }
          resolve(JSON.parse(fs.readFileSync(outFile, "utf8")) as Record<string, unknown>);
        });
      });
    const [left, right] = await Promise.all([runChild("left"), runChild("right")]);
    const dispositions = [left.disposition, right.disposition].toSorted((a, b) =>
      String(a).localeCompare(String(b)),
    );
    expect(dispositions).toEqual(["applied", "replayed"]);
    expect(left.commitId).toBe(right.commitId);
    expect(left.outcomeVersion).toBe(1);
    expect(right.outcomeVersion).toBe(1);
    const store = new DurableTaskOutcomeStore(root);
    expect(store.loadTask("task-race")?.outcomeVersion).toBe(1);
    store.close();
  });
});

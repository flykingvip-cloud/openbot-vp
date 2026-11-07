/**
 * Isolation-only read port. Confirms the query does not write.
 * Not a gateway or production check.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chargeModelCallAgainstTip } from "../task-outcome/runtime-from-runner.js";
import type { TrustedScope } from "../task-outcome/types.js";
import { resetModelCallsForTests } from "./model-call-evidence.js";
import { readExecutorEvidence } from "./read-port.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:evidence",
  subjectRef: "user:evidence",
  authzScopeRef: "scope:isolation",
};
const otherScope: TrustedScope = {
  ...scope,
  personalDomainId: "personal:other",
  subjectRef: "user:other",
};

const roots: string[] = [];

function snapshot(root: string): string[] {
  const rows: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) {
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const stat = fs.statSync(full);
        rows.push(`${full}:${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  walk(root);
  return rows.toSorted((a, b) => a.localeCompare(b));
}

afterEach(() => {
  resetModelCallsForTests();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("read-only executor evidence port", () => {
  it("reads receipts after memory is cleared and does not write", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-read-"));
    roots.push(agentDir);
    const cfg = {
      agents: { list: [{ id: "bot", agentDir, workspace: agentDir }] },
      models: {
        providers: {
          local: {
            models: [
              {
                id: "fake",
                cost: { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      },
    } as never;
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-read",
      scope,
      runId: "run-read",
      callSeq: 1,
      provider: "local",
      model: "fake",
      usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
      budgetLimits: { maxIterations: 3, maxCostUsd: 10, maxDurationMinutes: 30 },
    });
    const storeRoot = path.join(agentDir, "task-outcomes");
    resetModelCallsForTests();
    const before = snapshot(storeRoot);
    const tipCount = fs.readdirSync(path.join(storeRoot, "tips")).length;
    const view = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-read",
      runId: "run-read",
      storeRoot,
    });
    expect(snapshot(storeRoot)).toEqual(before);
    expect(fs.readdirSync(path.join(storeRoot, "tips"))).toHaveLength(tipCount);
    expect(view.readOnly).toBe(true);
    expect(view.durableAcrossRestart).toBe(true);
    expect(view.completeHistory).toBe(false);
    expect(view.schemaVersion).toBe(1);
    expect(view.receipts.some((receipt) => receipt.commitId?.startsWith("c_"))).toBe(true);
    expect(view.associations.length).toBeGreaterThan(0);
    expect(view.projectedAt).toBeGreaterThan(0);
  });

  it("reports a legacy commit id as null and a missing version as a gap", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-gap-"));
    roots.push(agentDir);
    const cfg = {
      agents: { list: [{ id: "bot", agentDir, workspace: agentDir }] },
    } as never;
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-gap",
      scope,
      runId: "run-gap",
      callSeq: 1,
      usage: undefined,
      budgetLimits: { maxIterations: 3, maxCostUsd: 10, maxDurationMinutes: 30 },
    });
    const storeRoot = path.join(agentDir, "task-outcomes");
    const logDir = path.join(storeRoot, "command-log");
    const logName = fs.readdirSync(logDir).find((name) => name.endsWith(".json"));
    expect(logName).toBeTruthy();
    const logPath = path.join(logDir, logName!);
    const raw = JSON.parse(fs.readFileSync(logPath, "utf8")) as {
      outcomeVersion: number;
      commitId?: string;
    };
    delete raw.commitId;
    fs.writeFileSync(logPath, `${JSON.stringify(raw)}\n`);
    fs.rmSync(path.join(storeRoot, "versions", `task-gap__v${raw.outcomeVersion}.json`));
    const view = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-gap",
      storeRoot,
    });
    expect(view.gaps).toContain("version_snapshot_missing");
    expect(view.receipts.some((receipt) => receipt.outcomeVersion === raw.outcomeVersion)).toBe(
      false,
    );
    expect(view.completeness).not.toBe("complete");
  });

  it("rejects a different scope and a memory-only view is not durable", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-scope-"));
    roots.push(agentDir);
    const cfg = { agents: { list: [{ id: "bot", agentDir, workspace: agentDir }] } } as never;
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: "task-scope",
      scope,
      runId: "run-scope",
      callSeq: 1,
      budgetLimits: { maxIterations: 3, maxCostUsd: 10, maxDurationMinutes: 30 },
    });
    const storeRoot = path.join(agentDir, "task-outcomes");
    const mismatch = readExecutorEvidence({
      agentId: "bot",
      scope: otherScope,
      taskId: "task-scope",
      storeRoot,
    });
    expect(mismatch.completeness).toBe("mismatch");
    expect(mismatch.receipts).toEqual([]);
    expect(mismatch.associations).toEqual([]);
    const memory = readExecutorEvidence({
      agentId: "bot",
      scope,
      taskId: "task-scope",
      storeRoot,
      memoryOnly: true,
    });
    expect(memory.durableAcrossRestart).toBe(false);
    expect(memory.completeHistory).toBe(false);
    expect(memory.gaps).toContain("memory_is_not_durable_history");
  });
});

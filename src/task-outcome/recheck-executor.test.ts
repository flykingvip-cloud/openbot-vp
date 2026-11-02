import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { ensureChatTurnTaskOutcome } from "./chat-entry.js";
import { RECHECK_EXECUTION_ENABLED, executeOriginalScenarioRecheck } from "./recheck-executor.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function correctionFixture() {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "recheck-exec-"));
  dirs.push(agentDir);
  const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  const opened = ensureChatTurnTaskOutcome(cfg, {
    agentId: "bot",
    runId: "run-1",
    sessionKey: "sess-a",
    subjectRef: "subject:alice",
  });
  if (!opened.ok) {
    throw new Error(opened.message);
  }
  const root = path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME);
  const store = new DurableTaskOutcomeStore(root);
  const snap = store.loadTaskVersion(opened.taskId, opened.record.outcomeVersion);
  const tip = store.loadTask(opened.taskId);
  if (!snap || !tip) {
    throw new Error("missing snapshot");
  }
  const corrected = {
    ...snap,
    revisionKind: "correction" as const,
    taskJudgement: "failure" as const,
    decisiveRunId: "run-1",
  };
  fs.writeFileSync(
    store.versionPath(opened.taskId, snap.outcomeVersion),
    `${JSON.stringify(corrected, null, 2)}\n`,
  );
  fs.writeFileSync(
    store.tipPath(opened.taskId),
    `${JSON.stringify({ ...tip, ...corrected }, null, 2)}\n`,
  );
  return { cfg, taskId: opened.taskId, outcomeVersion: snap.outcomeVersion, root };
}

describe("original scenario recheck executor", () => {
  it("stays off, fails closed without a scenario id, and does not change the correction judgement", async () => {
    expect(RECHECK_EXECUTION_ENABLED).toBe(false);
    const fixture = correctionFixture();
    const before = new DurableTaskOutcomeStore(fixture.root).loadTask(fixture.taskId);
    expect(
      await executeOriginalScenarioRecheck({
        cfg: fixture.cfg,
        agentId: "bot",
        taskId: fixture.taskId,
        outcomeVersion: fixture.outcomeVersion,
        taskContractVersion: "1.0.0",
        scenarioId: "scene-1",
      }),
    ).toEqual({ ok: false, code: "not_enabled" });
    expect(new DurableTaskOutcomeStore(fixture.root).loadTask(fixture.taskId)?.outcomeVersion).toBe(
      before?.outcomeVersion,
    );

    expect(
      await executeOriginalScenarioRecheck({
        cfg: fixture.cfg,
        agentId: "bot",
        taskId: fixture.taskId,
        outcomeVersion: fixture.outcomeVersion,
        taskContractVersion: "1.0.0",
        enabled: true,
      }),
    ).toEqual({ ok: false, code: "scenario_missing" });
    expect(new DurableTaskOutcomeStore(fixture.root).loadTask(fixture.taskId)?.outcomeVersion).toBe(
      before?.outcomeVersion,
    );

    const failed = await executeOriginalScenarioRecheck({
      cfg: fixture.cfg,
      agentId: "bot",
      taskId: fixture.taskId,
      outcomeVersion: fixture.outcomeVersion,
      taskContractVersion: "1.0.0",
      scenarioId: "run-1",
      enabled: true,
      run: () => ({ ok: false, reason: "tool_failure" }),
    });
    expect(failed).toEqual({
      ok: true,
      status: "incomplete",
      outcomeVersion: fixture.outcomeVersion,
      attempt: 1,
    });
    const after = new DurableTaskOutcomeStore(fixture.root).loadTask(fixture.taskId);
    expect(after?.outcomeVersion).toBe(before?.outcomeVersion);
    expect(after?.taskJudgement).toBe("failure");
    expect(
      new DurableTaskOutcomeStore(fixture.root).loadTaskVersion(
        fixture.taskId,
        fixture.outcomeVersion,
      )?.taskJudgement,
    ).toBe("failure");
  });
});

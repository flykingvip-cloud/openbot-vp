import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diagnosisTaskOutcomeRows } from "../../ui/src/ui/ports/enterprise/diagnosis/diagnosis-task-outcome-rows.ts";
import type { OpenBotConfig } from "../config/config.js";
import { readTaskOutcomeEvidence } from "../diagnosis/task-outcome-evidence.js";
import { ensureChatTurnTaskOutcome } from "./chat-entry.js";
import { readRecheckStatus, recordIncompleteRecheckObservation } from "./recheck-observation.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("recheck observation read model", () => {
  it("stays 未复验 until an incomplete observation is recorded, without changing judgement", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "recheck-read-"));
    dirs.push(agentDir);
    const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    const opened = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "run-1",
      sessionKey: "sess-a",
      subjectRef: "subject:alice",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const root = path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME);
    const before = new DurableTaskOutcomeStore(root).loadTaskVersion(
      opened.taskId,
      opened.record.outcomeVersion,
    );
    expect(before?.taskJudgement).toBe(opened.record.taskJudgement);
    expect(readRecheckStatus(root, opened.taskId, opened.record.outcomeVersion)).toBe(
      "not_checked",
    );

    const empty = readTaskOutcomeEvidence({
      cfg,
      agentId: "bot",
      taskId: opened.taskId,
      outcomeVersion: opened.record.outcomeVersion,
      callerSubjectRaw: "alice",
    });
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.recheckStatus).toBe("not_checked");
      expect(empty.judgement).toBe(before?.taskJudgement);
    }
    expect(
      diagnosisTaskOutcomeRows({
        sourceLabel: "数字人 客服",
        evidence: {
          ok: true,
          recheckStatus: "not_checked",
          taskId: opened.taskId,
          outcomeVersion: 1,
        },
      }).find((row) => row.label === "复验结果")?.value,
    ).toBe("未复验");

    expect(
      await recordIncompleteRecheckObservation({
        rootDir: root,
        taskId: opened.taskId,
        outcomeVersion: opened.record.outcomeVersion,
      }),
    ).toEqual({ ok: true, attempt: 1, status: "incomplete" });
    const after = new DurableTaskOutcomeStore(root).loadTaskVersion(
      opened.taskId,
      opened.record.outcomeVersion,
    );
    expect(after?.taskJudgement).toBe(before?.taskJudgement);
    expect(new DurableTaskOutcomeStore(root).loadTask(opened.taskId)?.taskJudgement).toBe(
      before?.taskJudgement,
    );

    const recorded = readTaskOutcomeEvidence({
      cfg,
      agentId: "bot",
      taskId: opened.taskId,
      outcomeVersion: opened.record.outcomeVersion,
      callerSubjectRaw: "alice",
    });
    expect(recorded.ok).toBe(true);
    if (recorded.ok) {
      expect(recorded.recheckStatus).toBe("incomplete");
      expect(recorded.recheckAttempt).toBe(1);
      expect(recorded.judgement).toBe(before?.taskJudgement);
      expect(
        diagnosisTaskOutcomeRows({
          sourceLabel: "数字人 客服",
          evidence: recorded,
        }).find((row) => row.label === "复验结果")?.value,
      ).toBe("第1次复验未完成");
    }
    expect(
      diagnosisTaskOutcomeRows({
        sourceLabel: "数字人 客服",
        evidence: { ok: true, recheckStatus: "incomplete" },
      }).find((row) => row.label === "复验结果")?.value,
    ).toBe("复验未完成");
    expect(
      diagnosisTaskOutcomeRows({
        sourceLabel: "数字人 客服",
        evidence: { ok: false, code: "read_failed", taskId: opened.taskId },
      }).find((row) => row.label === "复验结果")?.value,
    ).toBe("复验记录读取失败");
  });
});

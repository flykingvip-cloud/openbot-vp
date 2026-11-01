/**
 * Read-only view of one TaskOutcome version for diagnosis.diagnose.
 * Tool failures stay observations. They do not change taskJudgement.
 */
import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  callerOwnsTaskOutcome,
  TASK_OUTCOME_STORE_DIRNAME,
} from "../task-outcome/reject-result.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import { normalizeTaskOutcomeSubjectRef } from "../task-outcome/subject-ref.js";
import type { TaskJudgement } from "../task-outcome/types.js";

export type TaskOutcomeEvidenceCode =
  | "ok"
  | "unauthorized"
  | "not_found"
  | "version_missing"
  | "outcome_version_changed"
  | "read_failed"
  | "task_ref_incomplete";

export type TaskOutcomeToolObservation = {
  toolName: string;
  ok: boolean;
  summary?: string;
};

export type TaskOutcomeEvidence =
  | {
      ok: true;
      code: "ok";
      taskId: string;
      outcomeVersion: number;
      judgement: TaskJudgement;
      reasonCode?: string;
      lifecycle: string;
      toolObservations: TaskOutcomeToolObservation[];
    }
  | {
      ok: false;
      code: Exclude<TaskOutcomeEvidenceCode, "ok">;
      taskId?: string;
      tipVersion?: number;
    };

export function formatTaskOutcomeEvidenceText(evidence: TaskOutcomeEvidence): string {
  if (evidence.ok) {
    const failed = evidence.toolObservations.filter((row) => !row.ok).length;
    return [
      "【任务权威结果】",
      `taskId=${evidence.taskId}`,
      `outcomeVersion=${evidence.outcomeVersion}`,
      `判定=${evidence.judgement}`,
      `reasonCode=${evidence.reasonCode ?? ""}`,
      `工具失败观察=${failed}。工具失败不改变任务判定。`,
    ].join("\n");
  }
  return [
    "【任务权威结果】",
    `未能读取所请求版本的权威任务结果（${evidence.code}）。`,
    "这不代表系统正常或问题已恢复。",
  ].join("\n");
}

export function readTaskOutcomeEvidence(input: {
  cfg: OpenBotConfig | undefined;
  agentId: string;
  taskId: string;
  outcomeVersion: number;
  callerSubjectRaw: string;
  callerTenantId?: string | null;
}): TaskOutcomeEvidence {
  const agentId = input.agentId.trim();
  const taskId = input.taskId.trim();
  const callerSubjectRef = normalizeTaskOutcomeSubjectRef(input.callerSubjectRaw);
  if (!callerSubjectRef) {
    return { ok: false, code: "unauthorized", taskId: taskId || undefined };
  }
  if (!input.cfg || !agentId || !taskId || !Number.isInteger(input.outcomeVersion)) {
    return { ok: false, code: "read_failed", taskId: taskId || undefined };
  }
  try {
    const root = path.join(resolveAgentDir(input.cfg, agentId), TASK_OUTCOME_STORE_DIRNAME);
    const store = new DurableTaskOutcomeStore(root);
    try {
      const tip = store.loadTask(taskId);
      if (!tip) {
        return { ok: false, code: "not_found", taskId };
      }
      if (
        !callerOwnsTaskOutcome({
          scope: tip.scope,
          callerSubjectRef,
          callerTenantId: input.callerTenantId,
        })
      ) {
        return { ok: false, code: "unauthorized", taskId };
      }
      if (tip.outcomeVersion !== input.outcomeVersion) {
        return {
          ok: false,
          code: "outcome_version_changed",
          taskId,
          tipVersion: tip.outcomeVersion,
        };
      }
      const snap = store.loadTaskVersion(taskId, input.outcomeVersion);
      if (!snap) {
        return { ok: false, code: "version_missing", taskId, tipVersion: tip.outcomeVersion };
      }
      const toolObservations = snap.attempts.flatMap((attempt) =>
        (attempt.toolObservations ?? []).map((row) => ({
          toolName: row.toolName,
          ok: row.ok,
          ...(row.summary ? { summary: row.summary } : {}),
        })),
      );
      return {
        ok: true,
        code: "ok",
        taskId,
        outcomeVersion: snap.outcomeVersion,
        judgement: snap.taskJudgement,
        ...(snap.reasonCode ? { reasonCode: snap.reasonCode } : {}),
        lifecycle: snap.lifecycle,
        toolObservations,
      };
    } finally {
      store.close();
    }
  } catch {
    return { ok: false, code: "read_failed", taskId };
  }
}

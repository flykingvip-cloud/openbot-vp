/**
 * Structured "结果不符合要求".
 * Appends a correction version for one closed task the caller already owns.
 * Does not reopen execution, does not change judge, and does not write the workspace task.
 */
import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import { normalizeTaskOutcomeSubjectRef } from "./subject-ref.js";
import type { TaskOutcomeRecord, TrustedScope } from "./types.js";

export const TASK_OUTCOME_STORE_DIRNAME = "task-outcomes";
export const REJECT_RESULT_REASON = "结果不符合要求";

export type RejectTaskOutcomeCode =
  | "unauthorized"
  | "not_found"
  | "not_a_closed_result"
  | "version_conflict"
  | "rejected";

export type RejectTaskOutcomeResult =
  | {
      ok: true;
      record: TaskOutcomeRecord;
      replayed: boolean;
    }
  | {
      ok: false;
      code: RejectTaskOutcomeCode;
      tipVersion?: number;
    };

export function callerOwnsTaskOutcome(params: {
  scope: TrustedScope;
  callerSubjectRef: string;
  callerTenantId?: string | null;
}): boolean {
  if (!params.callerSubjectRef || params.scope.subjectRef !== params.callerSubjectRef) {
    return false;
  }
  if (params.scope.kind === "enterprise") {
    const tenantId = params.callerTenantId?.trim() ?? "";
    return Boolean(tenantId) && tenantId === params.scope.tenantId;
  }
  return true;
}

export function rejectTaskOutcomeResult(input: {
  cfg: OpenBotConfig;
  agentId: string;
  taskId: string;
  outcomeVersion: number;
  callerSubjectRaw: string;
  callerTenantId?: string | null;
  commandId?: string;
}): RejectTaskOutcomeResult {
  const agentId = input.agentId.trim();
  const taskId = input.taskId.trim();
  const callerSubjectRef = normalizeTaskOutcomeSubjectRef(input.callerSubjectRaw);
  if (!agentId || !taskId || !callerSubjectRef || !Number.isInteger(input.outcomeVersion)) {
    return { ok: false, code: "unauthorized" };
  }
  const root = path.join(resolveAgentDir(input.cfg, agentId), TASK_OUTCOME_STORE_DIRNAME);
  const store = new DurableTaskOutcomeStore(root);
  try {
    const current = store.loadTask(taskId);
    if (!current) {
      return { ok: false, code: "not_found" };
    }
    if (
      !callerOwnsTaskOutcome({
        scope: current.scope,
        callerSubjectRef,
        callerTenantId: input.callerTenantId,
      })
    ) {
      return { ok: false, code: "unauthorized" };
    }
    if (current.lifecycle !== "closed") {
      return { ok: false, code: "not_a_closed_result", tipVersion: current.outcomeVersion };
    }
    if (current.outcomeVersion !== input.outcomeVersion) {
      return { ok: false, code: "version_conflict", tipVersion: current.outcomeVersion };
    }
    const service = new TaskOutcomeResultService({
      store,
      submittedBy: "task-outcome-reject-result",
      correctionAllowlist: [callerSubjectRef],
    });
    const submitted = service.submit(
      taskId,
      {
        type: "correction",
        expectedVersion: input.outcomeVersion,
        previousOutcomeVersion: input.outcomeVersion,
        authorizedBy: callerSubjectRef,
        revisionReason: REJECT_RESULT_REASON,
        acceptance: { status: "failed" },
        delivery: current.delivery,
      },
      {
        requiredScope: current.scope,
        callerSubjectRef,
        commandId:
          input.commandId?.trim() ||
          `reject-result:${taskId}:${input.outcomeVersion}:${callerSubjectRef}`,
      },
    );
    if (!submitted.ok) {
      if (submitted.code === "version_conflict") {
        return {
          ok: false,
          code: "version_conflict",
          tipVersion: submitted.current?.outcomeVersion,
        };
      }
      if (submitted.code === "unauthorized_correction" || submitted.code === "scope_mismatch") {
        return { ok: false, code: "unauthorized" };
      }
      return { ok: false, code: "rejected" };
    }
    return {
      ok: true,
      record: submitted.record,
      replayed: submitted.createdEvents.length === 0,
    };
  } finally {
    store.close();
  }
}

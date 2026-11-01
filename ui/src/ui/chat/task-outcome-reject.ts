/**
 * Result-card rejection. The button exists only when the server already sent
 * taskId, agentId, and outcomeVersion. The card id is not a task id.
 */

export type TaskOutcomeRejectRef = {
  taskId: string;
  agentId: string;
  outcomeVersion: number;
};

export type TaskOutcomeRejectUiResult =
  | { ok: true; judgement: string; reasonCode?: string }
  | { ok: false; code: string };

export function readTaskOutcomeRejectRef(value: {
  taskId?: unknown;
  agentId?: unknown;
  outcomeVersion?: unknown;
}): TaskOutcomeRejectRef | null {
  const taskId = typeof value.taskId === "string" ? value.taskId.trim() : "";
  const agentId = typeof value.agentId === "string" ? value.agentId.trim() : "";
  const version = value.outcomeVersion;
  if (
    !taskId ||
    !agentId ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return null;
  }
  return { taskId, agentId, outcomeVersion: version };
}

const JUDGEMENT_LABEL: Record<string, string> = {
  success: "成功",
  failure: "失败",
  cancelled: "已取消",
  incomplete: "未完成",
};

export function formatRejectNotice(result: TaskOutcomeRejectUiResult): string {
  if (result.ok) {
    const judgement = JUDGEMENT_LABEL[result.judgement] ?? result.judgement;
    const reason = result.reasonCode?.trim();
    return reason ? `当前判定：${judgement}（${reason}）` : `当前判定：${judgement}`;
  }
  if (result.code === "version_conflict") {
    return "证据已过期";
  }
  if (result.code === "unauthorized") {
    return "无法关联身份";
  }
  if (result.code === "forbidden") {
    return "权限不足";
  }
  return "未能写入纠正";
}

export function rejectNoticeFromPayload(payload: unknown): TaskOutcomeRejectUiResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: "rejected" };
  }
  const body = payload as {
    ok?: unknown;
    code?: unknown;
    record?: { taskJudgement?: unknown; reasonCode?: unknown };
  };
  if (body.ok === true) {
    const judgement =
      typeof body.record?.taskJudgement === "string" ? body.record.taskJudgement : "";
    if (!judgement) {
      return { ok: false, code: "rejected" };
    }
    const reasonCode =
      typeof body.record?.reasonCode === "string" ? body.record.reasonCode : undefined;
    return reasonCode ? { ok: true, judgement, reasonCode } : { ok: true, judgement };
  }
  const code = typeof body.code === "string" && body.code.trim() ? body.code : "rejected";
  return { ok: false, code };
}

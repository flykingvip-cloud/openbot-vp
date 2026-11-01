/**
 * Four diagnosis rows plus the roster source label.
 * Values come only from taskOutcomeEvidence and the target the page already selected.
 */

export type DiagnosisTaskOutcomeEvidenceView =
  | {
      ok: true;
      taskId?: string;
      outcomeVersion?: number;
      judgement?: string;
      reasonCode?: string;
      revisionKind?: string;
      recheckStatus?: string;
    }
  | {
      ok: false;
      code?: string;
      taskId?: string;
    };

export type DiagnosisTaskOutcomeRow = {
  label: string;
  value: string;
  mono?: boolean;
};

const JUDGEMENT_LABEL: Record<string, string> = {
  success: "成功",
  failure: "失败",
  cancelled: "已取消",
  incomplete: "未完成",
};

export function diagnosisSourceLabel(input: {
  targets?: ReadonlyArray<{ id: string; kind: string; label: string }>;
  selectedTargetId?: string | null;
}): string {
  const id = input.selectedTargetId?.trim() ?? "";
  const target = id ? input.targets?.find((row) => row.id === id) : undefined;
  if (!target?.label.trim()) {
    return "未声明";
  }
  const kind = target.kind === "group" ? "协作小组" : target.kind === "agent" ? "数字人" : "未声明";
  if (kind === "未声明") {
    return target.label.trim();
  }
  return `${kind} ${target.label.trim()}`;
}

export function diagnosisTaskOutcomeRows(input: {
  evidence?: DiagnosisTaskOutcomeEvidenceView | null;
  sourceLabel: string;
}): DiagnosisTaskOutcomeRow[] {
  const source = input.sourceLabel.trim() || "未声明";
  const evidence = input.evidence;
  if (!evidence) {
    return emptyRows(source);
  }
  if (evidence.ok) {
    const taskId = evidence.taskId?.trim() || "未声明";
    const version =
      typeof evidence.outcomeVersion === "number" ? String(evidence.outcomeVersion) : "未声明";
    return [
      { label: "来源", value: source },
      { label: "关联原任务", value: taskId, mono: taskId !== "未声明" },
      { label: "结果版本", value: version, mono: version !== "未声明" },
      { label: "当前处理", value: handlingCopy(evidence) },
      { label: "复验结果", value: recheckCopy(evidence.recheckStatus) },
    ];
  }
  const taskId = evidence.taskId?.trim() || "未声明";
  const version = evidence.code === "outcome_version_changed" ? "证据已过期" : "未声明";
  const handling =
    evidence.code === "unauthorized"
      ? "无法关联身份"
      : evidence.code === "forbidden"
        ? "权限不足"
        : evidence.code === "not_found"
          ? "没有这条任务结果"
          : "尚未处理";
  return [
    { label: "来源", value: source },
    { label: "关联原任务", value: taskId, mono: taskId !== "未声明" },
    { label: "结果版本", value: version },
    { label: "当前处理", value: handling },
    { label: "复验结果", value: "未复验" },
  ];
}

export type DiagnoseTaskOutcomeDraft = {
  taskId: string;
  agentId: string;
  outcomeVersion: string;
};

export type DiagnoseTaskOutcomeRef = {
  taskId: string;
  agentId: string;
  outcomeVersion: number;
};

/** Attach a task only when the user supplied all three fields. Partial input does not fall back to another task. */
export function resolveDiagnoseTaskOutcome(
  draft: DiagnoseTaskOutcomeDraft,
  hostRef: DiagnoseTaskOutcomeRef | null = null,
): DiagnoseTaskOutcomeRef | null {
  const taskId = draft.taskId.trim();
  const agentId = draft.agentId.trim();
  const versionText = draft.outcomeVersion.trim();
  const started = Boolean(taskId || agentId || versionText);
  if (started) {
    if (!taskId || !agentId || !/^[1-9]\d*$/.test(versionText)) {
      return null;
    }
    return { taskId, agentId, outcomeVersion: Number(versionText) };
  }
  const hostTaskId = hostRef?.taskId.trim() ?? "";
  const hostAgentId = hostRef?.agentId.trim() ?? "";
  const hostVersion = hostRef?.outcomeVersion;
  if (
    !hostTaskId ||
    !hostAgentId ||
    typeof hostVersion !== "number" ||
    !Number.isInteger(hostVersion) ||
    hostVersion < 1
  ) {
    return null;
  }
  return { taskId: hostTaskId, agentId: hostAgentId, outcomeVersion: hostVersion };
}

export function diagnoseTaskOutcomeAttachNote(draft: DiagnoseTaskOutcomeDraft): string | null {
  const started = Boolean(
    draft.taskId.trim() || draft.agentId.trim() || draft.outcomeVersion.trim(),
  );
  if (!started || resolveDiagnoseTaskOutcome(draft)) {
    return null;
  }
  return "任务对照未附上：需要同时填写任务、数字人和结果版本。不会自动选择最近任务。";
}

function recheckCopy(status: string | undefined): string {
  return status === "incomplete" ? "复验未完成" : "未复验";
}

function emptyRows(source: string): DiagnosisTaskOutcomeRow[] {
  return [
    { label: "来源", value: source },
    { label: "关联原任务", value: "未声明" },
    { label: "结果版本", value: "未声明" },
    { label: "当前处理", value: "尚未处理" },
    { label: "复验结果", value: "未复验" },
  ];
}

function handlingCopy(evidence: {
  revisionKind?: string;
  judgement?: string;
  reasonCode?: string;
}): string {
  if (evidence.revisionKind !== "correction") {
    return "尚未处理";
  }
  const judgement = evidence.judgement?.trim() ?? "";
  const label = JUDGEMENT_LABEL[judgement] ?? (judgement || "未声明");
  const reason = evidence.reasonCode?.trim();
  return reason ? `${label}（${reason}）` : label;
}

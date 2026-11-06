import type { ObservationRun, ObservationView } from "./model.ts";

const execution = {
  key: "execution",
  label: "运行片段",
  state: "observed",
  detail: "对话入口 → 准入工作 → 运行 attempt，均有可引用 ID。",
} as const;
const tool = {
  key: "tool",
  label: "工具调用",
  state: "observed",
  detail: "tool_call_01 · end。此处仅描述执行状态，不代表成果被验收。",
} as const;
const work = {
  key: "work",
  label: "场景任务 / 准入工作",
  state: "observed",
  detail: "沿用现有 admitted request/task binding，不另造业务工作 ID。",
} as const;
const wait = {
  key: "tool",
  label: "工具与等待",
  state: "waiting",
  detail: "pause → resume 已记录，等待时间不等于工具失败。",
} as const;
function run(
  input: Partial<ObservationRun> & Pick<ObservationRun, "id" | "label" | "scope">,
): ObservationRun {
  return {
    tenantLabel: null,
    clientRunId: null,
    sourceRunId: null,
    admittedWorkId: null,
    scenarioTaskRef: null,
    outcomeRevision: null,
    toolState: "completed",
    outcomeState: "unavailable",
    latencyMs: null,
    attributedCost: null,
    stages: [],
    reasons: [],
    eventCount: 7,
    sample: true,
    ...input,
  };
}

export function observationSamples(role: "platform" | "enterprise"): ObservationView {
  const tenant = role === "platform" ? "企业样例（仅脱敏标识）" : null;
  const runs = [
    run({
      id: "sample-personal",
      label: "个人 · 周报资料整理",
      scope: "personal",
      tenantLabel: tenant,
      clientRunId: "client_01",
      sourceRunId: "engine_A",
      admittedWorkId: "admission_01",
      scenarioTaskRef: "task_personal_01",
      outcomeRevision: role === "enterprise" ? "outcome_v3 · accepted" : null,
      toolState: "completed",
      outcomeState: role === "enterprise" ? "accepted" : "unavailable",
      latencyMs: 184000,
      attributedCost:
        role === "enterprise"
          ? {
              amount: 0.018,
              currency: "USD",
              coverage: "真实 request usage 样例；非供应商周期账单",
            }
          : null,
      stages: [
        execution,
        tool,
        work,
        {
          key: "outcome",
          label: role === "enterprise" ? "业务验收" : "结果版本（受限）",
          state: role === "enterprise" ? "observed" : "missing",
          detail:
            role === "enterprise"
              ? "outcome_v3 · accepted；以个人终态呈现。"
              : "平台未获成果与验收授权，不推定任务成功。",
        },
      ],
      reasons:
        role === "enterprise"
          ? ["sample_acceptance"]
          : ["sample_identity", "outcome_revision", "source_provenance"],
      eventCount: 9,
    }),
    run({
      id: "sample-collaboration",
      label: "协作 · 客诉联合处理",
      scope: "collaboration",
      tenantLabel: tenant,
      clientRunId: "client_02",
      sourceRunId: "engine_B",
      admittedWorkId: "admission_02",
      scenarioTaskRef: "work_item_02",
      outcomeRevision: role === "enterprise" ? "shared_revision_6 · accepted" : null,
      toolState: "waiting",
      outcomeState: role === "enterprise" ? "accepted" : "unavailable",
      latencyMs: null,
      attributedCost: null,
      stages: [
        execution,
        wait,
        work,
        {
          key: "outcome",
          label: role === "enterprise" ? "共享工作项验收" : "结果版本（受限）",
          state: role === "enterprise" ? "observed" : "missing",
          detail:
            role === "enterprise"
              ? "共享业务验收独立成立；某成员 TaskOutcome 未替它关闭任务。"
              : "技术运行等待中，不把成员完成当共享工作项完成。",
        },
      ],
      reasons: ["sample_identity", "attributed_cost_missing"],
      eventCount: 12,
    }),
    run({
      id: "sample-partial",
      label: "个人 · 投递链路复核",
      scope: "personal",
      tenantLabel: tenant,
      clientRunId: "client_02",
      sourceRunId: "engine_C",
      admittedWorkId: "admission_03",
      outcomeState: role === "enterprise" ? "pending" : "unavailable",
      toolState: "completed",
      latencyMs: 42000,
      stages: [
        execution,
        tool,
        {
          key: "work",
          label: "场景 / 结果证据",
          state: "missing",
          detail: "admission_03 有准入记录，但 scenario_task_ref 未供给。",
        },
        {
          key: "outcome",
          label: "交付与验收",
          state: "missing",
          detail: "delivery accepted 仅表示投递被接收，不是场景验收。",
        },
      ],
      reasons: [
        "scenario_task_ref",
        "outcome_revision",
        "source_provenance",
        "sequence_gap_or_reorder",
        "incomplete_run_prefix",
        "attributed_cost_missing",
      ],
      eventCount: 5,
    }),
  ];
  return {
    source: "sample",
    connected: true,
    partial: runs.some((row) => row.reasons.length > 0),
    sessionKey: null,
    reasons: [...new Set(runs.flatMap((row) => row.reasons))],
    runs,
    receivedAt: null,
  };
}

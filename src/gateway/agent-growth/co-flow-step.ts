/**
 * Agent Growth OS — CO Flow「Agent 成长」step 构建器（spec: agent-growth-lifecycle, P2 任务 15.3 / R15）。
 *
 * CO Flow 是 chat 输入框上方的横向进度 stepper（见 `.cursor/rules/co-chat.mdc`「CO Flow / TaskCard」），
 * 由 co-chat MCP 的 `flow_step_create({ title, description?, kind?, subSteps?, initialStatus? })` 创建。
 *
 * 本模块是**纯函数 builder**：把 `GrowthStatus` 映射成一个与 flow 协议对齐的 step 描述符
 * （title「Agent 成长」+ 生命周期 subSteps），供 co-chat / group flow 层直接喂给 `flow_step_create`。
 * 不引入对 co-chat MCP 的运行时依赖（跨流由 co-chat owner 接线），保持 AGS 流自包含、可测。
 *
 * 设计取舍：CO Flow 是「顺序进度」视图，因此 subSteps 采用**互斥生命周期**
 * （birth → growing → mission_ready → activated → evolution）而非并行 dimensions；
 * 后者属 Prelude 的五维 Stepper（workbench-stage-growth-prelude.ts）。
 */

import type { GrowthStatus, LifecycleState } from "./types.ts";

/** flow 协议 step / sub-step 状态（对齐 `flow_step_update_status` 的取值）。 */
export type GrowthFlowSubStepStatus = "pending" | "in_progress" | "done" | "failed";

/** step 级 initialStatus 仅 pending / in_progress（done 由后续 update 触发；见 co-chat 规则）。 */
export type GrowthFlowStepStatus = "pending" | "in_progress" | "done";

export type GrowthFlowSubStep = {
  id: string;
  title: string;
  description?: string;
  status: GrowthFlowSubStepStatus;
};

/** 与 `flow_step_create` 入参对齐的「Agent 成长」step 描述符。 */
export type GrowthFlowStepDescriptor = {
  /** ≤12 字（co-chat 规则要求）；固定「Agent 成长」。 */
  title: string;
  description: string;
  kind: "auto";
  initialStatus: GrowthFlowStepStatus;
  subSteps: GrowthFlowSubStep[];
};

/** 生命周期顺序（CO Flow stepper 的推进方向）。 */
const LIFECYCLE_ORDER: readonly LifecycleState[] = [
  "birth",
  "growing",
  "mission_ready",
  "activated",
  "evolution",
] as const;

const LIFECYCLE_LABELS: Record<LifecycleState, string> = {
  birth: "诞生",
  growing: "成长中",
  mission_ready: "使命就绪",
  activated: "已激活",
  evolution: "进化",
};

/** 终态：成长之旅已达「可运营」，flow step 视为完成。 */
function isTerminalLifecycle(state: LifecycleState): boolean {
  return state === "activated" || state === "evolution";
}

/**
 * 是否应在 CO Flow 上呈现/维护「Agent 成长」step。
 * 进入运营（activated/evolution）后旅程已完成——co-chat 层可据此决定是否新建或直接标 done。
 * 返回 `true` 表示仍在成长阶段（birth/growing/mission_ready），值得作为活跃进度项展示。
 */
export function isGrowthFlowStepActive(status: GrowthStatus): boolean {
  return !isTerminalLifecycle(status.lifecycleState);
}

/**
 * 由 `GrowthStatus` 构建「Agent 成长」CO Flow step 描述符。
 *
 * subSteps 映射五个生命周期阶段：
 *  - 当前阶段之前 → `done`
 *  - 当前阶段     → `in_progress`（终态 activated/evolution → `done`）
 *  - 当前阶段之后 → `pending`
 *
 * step 级 `initialStatus`：终态 → `done`，否则 `in_progress`。
 * 对机器人与协作小组通用（小组 alignment 进度已反映在 lifecycleState）。
 */
export function buildGrowthFlowStep(status: GrowthStatus): GrowthFlowStepDescriptor {
  const idx = LIFECYCLE_ORDER.indexOf(status.lifecycleState);
  const currentIndex = idx >= 0 ? idx : 0;
  const terminal = isTerminalLifecycle(status.lifecycleState);

  const subSteps: GrowthFlowSubStep[] = LIFECYCLE_ORDER.map((stage, i) => {
    let subStatus: GrowthFlowSubStepStatus;
    if (i < currentIndex) {
      subStatus = "done";
    } else if (i === currentIndex) {
      subStatus = terminal ? "done" : "in_progress";
    } else {
      subStatus = "pending";
    }
    return { id: `growth-${stage}`, title: LIFECYCLE_LABELS[stage], status: subStatus };
  });

  const scoreLabel = `${Math.round(status.activationScore)}/100`;
  return {
    title: "Agent 成长",
    description: `成长度 ${scoreLabel} · ${LIFECYCLE_LABELS[status.lifecycleState]}`,
    kind: "auto",
    initialStatus: terminal ? "done" : "in_progress",
    subSteps,
  };
}

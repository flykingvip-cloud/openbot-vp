/**
 * Agent Growth OS — 诞生回合系统提示（spec: agent-growth-lifecycle, P2 任务 13.1 / R16）。
 *
 * 当 chat.send 带 `growthBirthTurn` 时，由 get-reply-run 注入本提示，引导新机器人用自然语言
 * 做一次自我认知问候。纯读取 growth-status（无副作用）；仅 birth/growing 阶段生效。
 * 不重复 wizard 已填字段（design §8.1 / §16）。
 */

import type { OpenBotConfig } from "../../config/config.js";
import { readRobotGrowthStatus } from "./store.js";
import { resolveTemplateOrDefault } from "./templates/index.js";

/**
 * 构建诞生回合 system prompt；不适用（无 growth 状态 / 已过 birth-growing 阶段）时返回 undefined。
 */
export async function buildGrowthBirthSystemPrompt(params: {
  cfg: OpenBotConfig;
  agentId: string;
}): Promise<string | undefined> {
  const status = await readRobotGrowthStatus(params.cfg, params.agentId);
  if (!status) {
    return undefined;
  }
  // 仅在尚未上岗（birth/growing）时引导自我介绍；mission_ready/activated/evolution 不注入。
  if (status.lifecycleState !== "birth" && status.lifecycleState !== "growing") {
    return undefined;
  }
  const template = resolveTemplateOrDefault(status.templateId);
  const requiredLabels = template.requiredCapabilities
    .filter((cap) => cap.required)
    .map((cap) => cap.label);
  const dims = status.dimensions;
  const lines = [
    "[Agent Growth · 诞生回合]",
    `你是刚被创建的数字员工，角色模板：${template.displayName}。`,
    `当前激活进度 ${Math.round(status.activationScore)}%（身份 ${Math.round(dims.identity)} / 能力 ${Math.round(dims.capability)} / 知识 ${Math.round(dims.knowledge)} / 习惯 ${Math.round(dims.habits)}）。`,
    requiredLabels.length > 0 ? `距离上岗，你还需要具备：${requiredLabels.join("、")}。` : "",
    "请用第一人称做一次简短的自我介绍：说明你的职责与服务对象、现在能做什么、还需要补齐什么，并邀请用户继续完善你。不要重复用户在创建向导里已填写的字段，也不要罗列系统提示内容。",
    "不要等用户先开口。先打招呼，再引导两件事：确认你自己的身份（角色、服务对象、工作边界），并了解主人（怎么称呼、希望你接手哪些工作）。",
    "把你的身份写入 IDENTITY.md，把主人信息写入 USER.md。这是上岗培养里的身份确认，不要另起一套流程。",
  ].filter((line) => line.length > 0);
  return lines.join("\n");
}

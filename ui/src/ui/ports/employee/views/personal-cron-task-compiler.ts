import {
  buildCronDataBindingsPromptSection,
  expandCronDataBindingMarkers,
} from "../../../../../../src/cron/personal-task-meta.ts";
import type { PersonalCronTaskMeta } from "./personal-cron-task-meta.ts";

export type CompiledTaskPrompt = {
  message: string;
  sections: {
    goal: string;
    instruction: string;
    acceptance: string[];
  };
};

export type TaskQualityLint = {
  level: "error" | "warning" | "info";
  message: string;
  step?: number;
};

const SECTION_GOAL = "## 任务目标";
const SECTION_SCHEDULE = "## 定时说明";
const SECTION_INSTRUCTION = "## 执行指令";
const SECTION_DATA = "## 数据依赖";
const SECTION_ACCEPTANCE = "## 验收标准";

export function compileTaskPrompt(params: {
  intentText: string;
  meta: PersonalCronTaskMeta;
  taskName?: string;
}): CompiledTaskPrompt {
  const intent = params.intentText.trim();
  const bindings = params.meta.dataBindings ?? [];
  const instruction = bindings.length > 0 ? expandCronDataBindingMarkers(intent, bindings) : intent;
  const goal = params.meta.goal.trim() || inferGoalFromIntent(intent, params.taskName);
  const rules = params.meta.acceptanceRules.map((rule) => rule.trim()).filter(Boolean);
  const acceptance =
    rules.length > 0 ? rules : inferAcceptanceRulesFromIntent(intent, params.meta.category);

  const acceptanceBlock =
    acceptance.length > 0
      ? acceptance.map((rule, index) => `${index + 1}. ${rule}`).join("\n")
      : "（未设置显式验收规则，请确保输出满足定时说明。）";

  const deliveryHint = buildDeliveryHint(params.meta);
  const dataDependencySection = buildCronDataBindingsPromptSection(bindings);

  const message = [
    SECTION_SCHEDULE,
    goal || "（请根据执行指令完成指定任务。）",
    "",
    SECTION_INSTRUCTION,
    instruction || goal,
    "",
    ...(dataDependencySection ? ["", dataDependencySection, ""] : []),
    SECTION_ACCEPTANCE,
    acceptanceBlock,
    deliveryHint ? `\n## 交付说明\n${deliveryHint}` : "",
    "",
    "完成前请对照验收标准自检；若无法满足任一条，请在结果中说明原因与阻塞项。",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .trim();

  return {
    message,
    sections: { goal, instruction: intent, acceptance },
  };
}

export function parseCompiledPrompt(raw: string): {
  intentText: string;
  goal: string;
  acceptanceRules: string[];
} {
  const text = raw.trim();
  if (
    !text.includes(SECTION_GOAL) &&
    !text.includes(SECTION_SCHEDULE) &&
    !text.includes(SECTION_INSTRUCTION)
  ) {
    return { intentText: text, goal: "", acceptanceRules: [] };
  }
  const goal =
    extractSection(text, SECTION_GOAL, [
      SECTION_SCHEDULE,
      SECTION_INSTRUCTION,
      SECTION_DATA,
      SECTION_ACCEPTANCE,
      "## 交付说明",
    ]) ||
    extractSection(text, SECTION_SCHEDULE, [
      SECTION_INSTRUCTION,
      SECTION_DATA,
      SECTION_ACCEPTANCE,
      "## 交付说明",
    ]);
  const instruction = extractSection(text, SECTION_INSTRUCTION, [
    SECTION_DATA,
    SECTION_ACCEPTANCE,
    "## 交付说明",
    "完成前请对照",
  ]);
  const acceptanceRaw = extractSection(text, SECTION_ACCEPTANCE, ["## 交付说明", "完成前请对照"]);
  const acceptanceRules = acceptanceRaw
    .split("\n")
    .map((line) =>
      line
        .replace(/^\d+\.\s*/, "")
        .replace(/^-\s*\[[ x]\]\s*/i, "")
        .trim(),
    )
    .filter((line) => line && !line.startsWith("（未设置"));

  return {
    intentText: instruction || text,
    goal,
    acceptanceRules,
  };
}

function extractSection(text: string, heading: string, stopHeadings: string[]): string {
  const start = text.indexOf(heading);
  if (start < 0) {
    return "";
  }
  let bodyStart = start + heading.length;
  while (bodyStart < text.length && (text[bodyStart] === "\n" || text[bodyStart] === "\r")) {
    bodyStart += 1;
  }
  let end = text.length;
  for (const stop of stopHeadings) {
    const idx = text.indexOf(stop, bodyStart);
    if (idx >= 0 && idx < end) {
      end = idx;
    }
  }
  return text.slice(bodyStart, end).trim();
}

function inferGoalFromIntent(intent: string, taskName?: string): string {
  const trimmed = intent.trim();
  if (!trimmed) {
    return taskName?.trim() ?? "";
  }
  const firstLine =
    trimmed
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? trimmed;
  if (firstLine.length <= 80) {
    return firstLine;
  }
  return `${firstLine.slice(0, 77)}…`;
}

const ACCEPTANCE_BY_CATEGORY: Partial<Record<PersonalCronTaskMeta["category"], string[]>> = {
  ops: ["数据完整、指标计算正确", "输出格式规范（Markdown 或 PDF）", "包含关键运营指标摘要"],
  analytics: ["数据来源可追溯", "图表或表格齐全", "结论与数据一致"],
  sales: ["覆盖目标客群或竞品范围", "包含可执行建议", "关键数字已核对"],
  support: ["问题分类准确", "回复话术完整", "无敏感信息泄露"],
  content: ["内容结构完整", "无错别字与格式错误", "符合发布规范"],
  patrol: ["巡检项全覆盖", "异常项有说明与建议", "结果可复现"],
};

export function inferAcceptanceRulesFromIntent(
  intent: string,
  category: PersonalCronTaskMeta["category"],
): string[] {
  const base = [...(ACCEPTANCE_BY_CATEGORY[category] ?? ["输出内容完整", "结果可直接交付使用"])];
  const lower = intent.toLowerCase();
  if (/pdf|报告|日报|周报|文档/.test(intent)) {
    base.unshift("必须生成文件或结构化报告");
  }
  if (/发送|推送|群|通知|邮件/.test(intent)) {
    base.push("必须投递到指定渠道或接收方");
  }
  if (/{{bind:/.test(intent)) {
    base.push("已绑定的数据源均已正确引用");
  }
  if (/竞品|价格|监控/.test(lower)) {
    base.push("包含对比结论或变化摘要");
  }
  return [...new Set(base)].slice(0, 5);
}

export function suggestGoalAndAcceptance(params: {
  intentText: string;
  category: PersonalCronTaskMeta["category"];
  taskName?: string;
}): Pick<PersonalCronTaskMeta, "goal" | "acceptanceRules"> {
  const intent = params.intentText.trim();
  return {
    goal: inferGoalFromIntent(intent, params.taskName),
    acceptanceRules: inferAcceptanceRulesFromIntent(intent, params.category),
  };
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  ops: ["运营", "日报", "报表", "GMV", "留存", "经营"],
  sales: ["销售", "客户", "竞品", "回访", "报价", "线索"],
  support: ["客服", "工单", "支持", "SLA", "售后"],
  dev: ["研发", "代码", "部署", "Bug", "测试", "发布"],
  analytics: ["分析", "数据", "报表", "监控", "趋势", "指标"],
  content: ["内容", "文案", "文章", "创作", "发布"],
  patrol: ["巡检", "监控", "告警", "检查", "扫描"],
  marketing: ["市场", "营销", "推广", "投放", "品牌"],
  other: [],
};

export type CronAgentOption = { id: string; label: string };

export type CronExecutionGroupOptionInput = {
  sessionKey: string;
  label: string;
  purpose?: string;
  mission?: string;
};

export type CronExecutionRecommendResult = {
  kind: "agent" | "group";
  id: string;
  label: string;
  reason: string;
};

function tokenizeForMatch(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,，。；;、/|]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function scoreExecutionCandidate(params: {
  haystack: string;
  keywords: string[];
  label: string;
  extraText?: string;
}): number {
  const corpus = `${params.label} ${params.extraText ?? ""}`.toLowerCase();
  let score = 0;
  for (const keyword of params.keywords) {
    const normalized = keyword.toLowerCase();
    if (!normalized) {
      continue;
    }
    if (params.haystack.includes(normalized)) {
      score += 3;
    }
    if (corpus.includes(normalized)) {
      score += 5;
    }
  }
  for (const token of tokenizeForMatch(params.haystack)) {
    if (corpus.includes(token)) {
      score += 2;
    }
  }
  return score;
}

export function recommendExecutionTargetForTask(params: {
  intentText: string;
  category: PersonalCronTaskMeta["category"];
  taskName?: string;
  agents: Array<CronAgentOption | string>;
  groups?: CronExecutionGroupOptionInput[];
}): CronExecutionRecommendResult | null {
  const agents = params.agents.map((agent) =>
    typeof agent === "string" ? { id: agent, label: agent } : agent,
  );
  const groups = params.groups ?? [];
  if (agents.length === 0 && groups.length === 0) {
    return null;
  }

  const haystack = `${params.taskName ?? ""} ${params.intentText} ${params.category}`.trim();
  if (!haystack) {
    return agents[0]
      ? {
          kind: "agent",
          id: agents[0].id,
          label: agents[0].label,
          reason: "已默认选择首个可用机器人",
        }
      : null;
  }

  const keywords = [...(CATEGORY_KEYWORDS[params.category] ?? []), ...tokenizeForMatch(haystack)];

  const agentScores = agents.map((agent) => ({
    kind: "agent" as const,
    id: agent.id,
    label: agent.label,
    score: scoreExecutionCandidate({ haystack, keywords, label: agent.label, extraText: agent.id }),
  }));
  const groupScores = groups.map((group) => ({
    kind: "group" as const,
    id: group.sessionKey,
    label: group.label,
    score: scoreExecutionCandidate({
      haystack,
      keywords,
      label: group.label,
      extraText: `${group.purpose ?? ""} ${group.mission ?? ""}`,
    }),
  }));

  const ranked = [...agentScores, ...groupScores].toSorted(
    (left, right) => right.score - left.score,
  );
  const best = ranked[0];
  if (!best) {
    return null;
  }

  if (best.score <= 0) {
    const fallback = agents[0];
    if (!fallback) {
      return null;
    }
    return {
      kind: "agent",
      id: fallback.id,
      label: fallback.label,
      reason: "暂未找到强匹配项，已默认选择首个可用机器人",
    };
  }

  const reason =
    best.kind === "group"
      ? `与任务描述/分类关键词匹配度较高，推荐协作小组「${best.label}」`
      : `与任务描述/分类关键词匹配度较高，推荐机器人「${best.label}」`;

  return {
    kind: best.kind,
    id: best.id,
    label: best.label,
    reason,
  };
}

/** @deprecated Use recommendExecutionTargetForTask */
export function recommendAgentForTask(params: {
  intentText: string;
  category: PersonalCronTaskMeta["category"];
  agents: Array<CronAgentOption | string>;
}): string | null {
  const result = recommendExecutionTargetForTask({
    ...params,
    groups: [],
  });
  return result?.kind === "agent" ? result.id : null;
}

function buildDeliveryHint(meta: PersonalCronTaskMeta): string {
  const channels: string[] = [];
  if (meta.notify.inApp) {
    channels.push("站内通知");
  }
  if (meta.notify.wecom) {
    channels.push("企业微信");
  }
  if (meta.notify.email) {
    channels.push("邮件");
  }
  if (meta.notify.dingtalk) {
    channels.push("钉钉");
  }
  if (meta.notify.webhook) {
    channels.push("Webhook");
  }
  if (channels.length === 0) {
    return "";
  }
  return `任务完成后通过 ${channels.join("、")} 通知相关人；摘要需包含结论与未完成项。`;
}

export function lintTaskDraft(params: {
  intentText: string;
  meta: PersonalCronTaskMeta;
  taskName: string;
  hasSchedule: boolean;
}): TaskQualityLint[] {
  const issues: TaskQualityLint[] = [];
  const name = params.taskName.trim();
  const intent = params.intentText.trim();

  if (!name) {
    issues.push({ level: "error", message: "请填写任务名称", step: 1 });
  }
  if (!params.hasSchedule) {
    issues.push({ level: "error", message: "请设置执行时间", step: 2 });
  }
  if (!intent) {
    issues.push({ level: "error", message: "请描述任务意图（执行指令）", step: 3 });
  } else if (intent.length < 8) {
    issues.push({ level: "warning", message: "任务意图过短，建议补充数据来源与交付格式", step: 3 });
  }
  if (!params.meta.goal.trim()) {
    issues.push({ level: "warning", message: "建议填写定时说明，或使用「智能补全」", step: 4 });
  }
  if (params.meta.acceptanceRules.filter((r) => r.trim()).length === 0) {
    issues.push({ level: "warning", message: "建议添加验收规则，便于判断任务是否完成", step: 4 });
  }
  if (params.meta.selectedAgents.length === 0 && params.meta.selectedGroups.length === 0) {
    issues.push({ level: "warning", message: "请选择执行对象（机器人或协作小组）", step: 3 });
  }
  return issues;
}

export function inferDescriptionFromIntent(intent: string): string {
  const line = intent.trim().split("\n")[0]?.trim() ?? "";
  if (!line) {
    return "";
  }
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

export type PolishTaskDraftResult = {
  intentText: string;
  goal: string;
  acceptanceRules: string[];
  changes: string[];
};

const OUTPUT_HINT_BY_CATEGORY: Partial<Record<PersonalCronTaskMeta["category"], string>> = {
  ops: "输出 Markdown 报告，包含核心指标表格与 3 条以内行动建议。",
  analytics: "输出含趋势解读与异常点说明的分析报告，关键数字需标注口径。",
  sales: "输出竞品对比表与价格变化摘要，结论需可执行。",
  support: "输出工单分类统计与 SLA 风险清单，适合直接转发给值班同学。",
  content: "输出可直接发布的结构化内容，含标题、摘要与正文。",
  patrol: "输出巡检结果清单：正常 / 异常 / 待跟进，异常项附建议动作。",
};

export function polishTaskDraft(params: {
  intentText: string;
  meta: PersonalCronTaskMeta;
  taskName?: string;
}): PolishTaskDraftResult {
  const changes: string[] = [];
  let intentText = params.intentText.trim();
  let goal = params.meta.goal.trim();
  let acceptanceRules = params.meta.acceptanceRules.map((rule) => rule.trim()).filter(Boolean);

  if (!goal) {
    goal = inferGoalFromIntent(intentText, params.taskName);
    changes.push("已生成定时说明");
  }

  if (acceptanceRules.length === 0) {
    acceptanceRules = inferAcceptanceRulesFromIntent(intentText, params.meta.category);
    changes.push("已补充验收规则");
  }

  if (intentText && !/^\d+\.\s/m.test(intentText)) {
    const parts = intentText
      .split(/[。；\n]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      intentText = parts
        .map((part, index) => `${index + 1}. ${part.replace(/^\d+\.\s*/, "")}`)
        .join("\n");
      changes.push("已将意图拆解为分步执行清单");
    }
  }

  const outputHint = OUTPUT_HINT_BY_CATEGORY[params.meta.category];
  if (outputHint && !intentText.includes("输出要求")) {
    intentText = intentText ? `${intentText}\n\n输出要求：${outputHint}` : outputHint;
    changes.push("已补充交付格式要求");
  }

  if (!intentText.includes("约束")) {
    intentText =
      `${intentText}\n\n约束：不得编造数据；缺数据时明确说明；完成后对照验收标准自检。`.trim();
    changes.push("已加入执行约束");
  }

  if (acceptanceRules.length < 3) {
    const extras = inferAcceptanceRulesFromIntent(intentText, params.meta.category).filter(
      (rule) => !acceptanceRules.includes(rule),
    );
    acceptanceRules = [...acceptanceRules, ...extras].slice(0, 5);
    if (extras.length > 0) {
      changes.push("已扩展验收规则至可执行粒度");
    }
  }

  return {
    intentText,
    goal,
    acceptanceRules,
    changes: [...new Set(changes)],
  };
}

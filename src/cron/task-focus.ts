/**
 * Task focus for isolated cron runs.
 *
 * - PR alignment layer: parse compiled payloads, inject authoritative prompt sections,
 *   and post-run assessTaskOutputAlignment guards against task drift.
 * - Phase 1b (main): env-gated buildCronTaskFocusPrompt (OPENBOT_TASK_FOCUS_CRON_PROMPT).
 *   Prompt only — no alignment, lease, collaboration, or Ledger writes.
 */

const SECTION_GOAL = "## 任务目标";
const SECTION_SCHEDULE = "## 定时说明";
const SECTION_INSTRUCTION = "## 执行指令";
const SECTION_ACCEPTANCE = "## 验收标准";

export type TaskFocusContract = {
  goal: string;
  acceptanceRules: string[];
  /** Combined text used for post-run alignment checks. */
  anchorText: string;
  /**
   * Bound ConversationTask is identity. Unbound cron copy is schedule text only.
   * Cron never mints a ConversationTask row.
   */
  source?: "conversation_task" | "cron_schedule";
};

export type TaskAlignmentResult = {
  aligned: boolean;
  reason?: string;
  overlapRatio?: number;
};

const TASK_FOCUS_STOPWORDS = new Set([
  "任务",
  "执行",
  "进行",
  "完成",
  "当前",
  "本次",
  "cron",
  "openbot",
  "请",
  "需要",
  "如果",
  "以及",
  "或者",
  "然后",
  "开始",
  "检查",
  "确认",
  "说明",
  "报告",
  "结果",
  "成功",
  "失败",
  "测试",
  "链路",
  "触发",
  "一次",
  "现在",
  "已经",
  "可以",
  "应该",
  "必须",
  "不要",
  "不能",
  "是否",
  "这个",
  "那个",
  "如下",
  "如下所示",
  "交付",
  "过程",
  "详情",
  "记录",
  "数据",
  "信息",
  "内容",
  "相关",
  "对应",
  "根据",
  "按照",
  "通过",
  "使用",
  "调用",
  "工具",
  "步骤",
  "阶段",
  "部分",
  "全部",
  "所有",
  "每个",
  "每天",
  "每天一次",
  "定时",
  "监控",
]);

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

/** Parse compiled personal-cron payload sections (mirrors UI compiler). */
export function parseCompiledTaskPromptSections(raw: string): {
  goal: string;
  instruction: string;
  acceptanceRules: string[];
} {
  const text = raw.trim();
  if (
    !text.includes(SECTION_GOAL) &&
    !text.includes(SECTION_SCHEDULE) &&
    !text.includes(SECTION_INSTRUCTION)
  ) {
    return { goal: "", instruction: text, acceptanceRules: [] };
  }
  const goal =
    extractSection(text, SECTION_GOAL, [
      SECTION_SCHEDULE,
      SECTION_INSTRUCTION,
      "## 数据绑定",
      SECTION_ACCEPTANCE,
      "## 交付说明",
    ]) ||
    extractSection(text, SECTION_SCHEDULE, [
      SECTION_INSTRUCTION,
      "## 数据绑定",
      SECTION_ACCEPTANCE,
      "## 交付说明",
    ]);
  const instruction = extractSection(text, SECTION_INSTRUCTION, [
    "## 数据绑定",
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

  return { goal, instruction, acceptanceRules };
}

export function resolveCronTaskFocus(params: {
  message: string;
  meta: {
    goal?: string;
    acceptanceRules?: string[];
    intentText?: string;
  };
  conversationTaskId?: string;
  conversationTaskGoal?: string;
}): TaskFocusContract {
  const parsed = parseCompiledTaskPromptSections(params.message);
  const boundId = params.conversationTaskId?.trim() ?? "";
  const boundGoal = params.conversationTaskGoal?.trim() ?? "";
  const scheduleGoal =
    parsed.goal.trim() || (params.meta.goal ?? "").trim() || (params.meta.intentText ?? "").trim();
  const goal = boundId ? boundGoal || scheduleGoal : scheduleGoal;
  const acceptanceRules =
    parsed.acceptanceRules.length > 0
      ? parsed.acceptanceRules
      : (params.meta.acceptanceRules ?? []);
  const anchorText = [goal, parsed.instruction, ...acceptanceRules, params.message]
    .filter((part) => typeof part === "string" && part.trim())
    .join("\n");
  return {
    goal,
    acceptanceRules,
    anchorText,
    source: boundId ? "conversation_task" : "cron_schedule",
  };
}

export function buildTaskFocusPromptSection(focus: TaskFocusContract): string | undefined {
  if (!focus.goal.trim() && !focus.anchorText.trim()) {
    return undefined;
  }
  const source = focus.source ?? "cron_schedule";
  const acceptanceBlock =
    focus.acceptanceRules.length > 0
      ? focus.acceptanceRules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")
      : "（见执行指令与 cron payload）";
  if (source === "conversation_task") {
    return [
      "## 当前任务契约（权威 — 覆盖会话记忆与其他旧任务）",
      `任务目标：${focus.goal.trim() || "见下方执行指令"}`,
      "验收标准：",
      acceptanceBlock,
      "",
      "执行约束（必须遵守）：",
      "- 只完成上述目标任务；禁止切换到无关主题（如旧会话的知识库摘要、无关检索、其他项目的笔记整理）。",
      "- 若会话记忆、知识库检索结果与本段目标冲突，以本段为准。",
      "- 工具选择必须服务于本任务目标（例如价格监控应使用 browser/web_fetch/web_search，而非无关 knowledge_search）。",
      "- 最终输出须证明完成了本任务目标，不得汇报其他主题的执行结果。",
      "",
    ].join("\n");
  }
  return [
    "## 本次定时执行说明（不是对话任务身份）",
    `定时说明：${focus.goal.trim() || "见下方执行指令"}`,
    "验收标准：",
    acceptanceBlock,
    "",
    "执行约束（必须遵守）：",
    "- 只完成本次定时说明；禁止切换到无关主题（如旧会话的知识库摘要、无关检索、其他项目的笔记整理）。",
    "- 定时说明不是 ConversationTask 身份，不得据此铸造或改写对话任务。",
    "- 若会话记忆与本段说明冲突，以本段为准。",
    "- 最终输出须证明完成本次定时执行，不得汇报其他主题的执行结果。",
    "",
  ].join("\n");
}

function extractSignificantTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(/[\u4e00-\u9fff]{2,}/gu)) {
    tokens.push(match[0]);
  }
  for (const match of text.matchAll(/[a-zA-Z0-9][a-zA-Z0-9._-]*/g)) {
    const normalized = match[0].toLowerCase();
    if (normalized.length >= 2) {
      tokens.push(normalized);
    }
  }
  return tokens;
}

function filterAnchorTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const filtered: string[] = [];
  for (const token of tokens) {
    const trimmed = token.trim();
    if (trimmed.length < 2 || TASK_FOCUS_STOPWORDS.has(trimmed)) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    filtered.push(trimmed);
  }
  return filtered;
}

const COMMERCE_ANCHOR_MARKERS =
  /(?:京东|淘宝|天猫|拼多多|价格|比价|竞品|sku|商品|链接|抓取|爬取|监控)/iu;
const KNOWLEDGE_DRIFT_MARKERS =
  /(?:中医|诊断学|望闻问切|笔记|知识库|章节|教材|课程|论文摘要|文献综述)/iu;

/**
 * Post-run guard: flag summaries that clearly executed a different task.
 * Returns aligned=true when anchors are missing or output is too short to judge.
 */
function scoreAnchorOverlap(
  anchorText: string,
  output: string,
): {
  anchorTokens: string[];
  hits: number;
  overlapRatio: number;
} {
  const anchorTokens = filterAnchorTokens(extractSignificantTokens(anchorText));
  if (anchorTokens.length === 0) {
    return { anchorTokens, hits: 0, overlapRatio: 1 };
  }
  const outputLower = output.toLowerCase();
  let hits = 0;
  for (const token of anchorTokens) {
    if (output.includes(token) || outputLower.includes(token.toLowerCase())) {
      hits += 1;
    }
  }
  return { anchorTokens, hits, overlapRatio: hits / anchorTokens.length };
}

export function assessTaskOutputAlignment(params: {
  anchorText: string;
  outputText: string;
  minOutputLength?: number;
}): TaskAlignmentResult {
  const output = params.outputText.trim();
  const minLen = params.minOutputLength ?? 40;
  if (output.length < 20) {
    return { aligned: true };
  }

  const { anchorTokens, hits, overlapRatio } = scoreAnchorOverlap(params.anchorText, output);
  if (anchorTokens.length === 0) {
    return { aligned: true };
  }

  const anchorLooksCommercial = COMMERCE_ANCHOR_MARKERS.test(params.anchorText);
  const outputLooksKnowledgeDrift =
    KNOWLEDGE_DRIFT_MARKERS.test(output) && !COMMERCE_ANCHOR_MARKERS.test(output);

  if (anchorLooksCommercial && outputLooksKnowledgeDrift && output.length >= 25) {
    if (hits === 0 || overlapRatio < 0.15) {
      return {
        aligned: false,
        reason:
          "task_goal_mismatch: output appears to be an unrelated knowledge-summary task instead of the scheduled commerce/price task",
        overlapRatio,
      };
    }
  }

  if (output.length < minLen) {
    return { aligned: true };
  }

  if (hits === 0) {
    return {
      aligned: false,
      reason: `task_goal_mismatch: output does not reference task anchors (${anchorTokens.slice(0, 6).join(", ")})`,
      overlapRatio: 0,
    };
  }

  if (overlapRatio < 0.08 && anchorTokens.length >= 3) {
    return {
      aligned: false,
      reason: `task_goal_mismatch: low anchor overlap (${Math.round(overlapRatio * 100)}%)`,
      overlapRatio,
    };
  }

  return { aligned: true, overlapRatio };
}

export const CRON_TASK_FOCUS_FLAG_ENV = "OPENBOT_TASK_FOCUS_CRON_PROMPT";

function envFlagOn(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function isCronTaskFocusEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlagOn(env[CRON_TASK_FOCUS_FLAG_ENV]);
}

export type CronTaskFocusInput = {
  goal?: string;
  intentText?: string;
  acceptanceRules?: string[];
  visibleDescription?: string;
};

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim() ?? "";
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function buildCronTaskFocusPrompt(
  input: CronTaskFocusInput,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!isCronTaskFocusEnabled(env)) {
    return "";
  }
  const goal = input.goal?.trim() ?? "";
  const intent = input.intentText?.trim() ?? "";
  const acceptanceRules = uniqueNonEmpty(input.acceptanceRules ?? []);
  const visible = input.visibleDescription?.trim() ?? "";
  if (!goal && !intent && acceptanceRules.length === 0 && !visible) {
    return "";
  }
  const lines = ["## 权威任务焦点", "本轮 isolated cron 必须只执行下列合同，不得改做其他主题。"];
  if (goal) {
    lines.push(`目标：${goal}`);
  }
  if (intent && intent !== goal) {
    lines.push(`意图：${intent}`);
  }
  if (acceptanceRules.length > 0) {
    lines.push("验收：");
    for (const rule of acceptanceRules) {
      lines.push(`- ${rule}`);
    }
  }
  if (visible && visible !== goal && visible !== intent) {
    lines.push(`可见说明：${visible}`);
  }
  return lines.join("\n");
}

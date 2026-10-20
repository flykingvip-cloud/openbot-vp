import { extractText } from "../../../chat/message-extract.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { generateUUID } from "../../../uuid.ts";
import type {
  CronExecutionAgentOption,
  CronExecutionGroupOption,
} from "./personal-cron-execution-targets.ts";
import {
  polishTaskDraft,
  recommendExecutionTargetForTask,
  suggestGoalAndAcceptance,
} from "./personal-cron-task-compiler.ts";
import type { PersonalCronTaskMeta } from "./personal-cron-task-meta.ts";

export type CronTaskAiEnhanceInput = {
  mode: "complete" | "polish";
  taskName: string;
  intentText: string;
  meta: PersonalCronTaskMeta;
  visibleDescription?: string;
  /** 显式点击「智能补全」时为 true，覆盖已有目标/验收；自动预填时保持 false */
  overwrite?: boolean;
};

export type CronTaskAiEnhanceResult = {
  intentText: string;
  goal: string;
  acceptanceRules: string[];
  source: "llm" | "rules";
  summary: string;
};

export type CronExecutionRecommendInput = {
  taskName: string;
  intentText: string;
  category: string;
  agents: CronExecutionAgentOption[];
  groups: CronExecutionGroupOption[];
};

export type CronExecutionRecommendAiResult = {
  kind: "agent" | "group";
  id: string;
  label: string;
  reason: string;
  source: "llm" | "rules";
};

function extractLatestAssistantText(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role =
      message && typeof message === "object" && !Array.isArray(message)
        ? (message as { role?: unknown }).role
        : null;
    if (role !== "assistant") {
      continue;
    }
    const text = extractText(message);
    if (text?.trim()) {
      return text.trim();
    }
  }
  return null;
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return candidate.slice(start, end + 1);
}

async function requestLlmAssistantText(params: {
  client: GatewayBrowserClient;
  sessionKey: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return null;
  }
  const runId = generateUUID();
  try {
    await params.client.request("chat.send", {
      sessionKey,
      message: params.prompt,
      deliver: false,
      idempotencyKey: runId,
    });
  } catch {
    return null;
  }
  try {
    const waitResult = await params.client.request<{ status?: string }>("agent.wait", {
      runId,
      timeoutMs: params.timeoutMs ?? 90_000,
    });
    if (waitResult?.status === "error") {
      return null;
    }
    const history = await params.client.request<{ messages?: unknown[] }>("chat.history", {
      sessionKey,
      limit: 12,
    });
    const messages = Array.isArray(history.messages) ? history.messages : [];
    return extractLatestAssistantText(messages);
  } catch {
    return null;
  }
}

function buildEnhancementPrompt(input: CronTaskAiEnhanceInput): string {
  const acceptance = input.meta.acceptanceRules.filter((rule) => rule.trim()).join("\n- ");
  return [
    "你是 OpenBot 定时任务编排助手。请根据以下任务草稿，输出**仅包含 JSON** 的优化结果，不要 Markdown 代码块。",
    "JSON 结构：",
    '{"intentText":"分步骤执行指令","goal":"一句话目标","acceptanceRules":["规则1","规则2"]}',
    "",
    `模式：${input.mode === "polish" ? "深度优化 Prompt（更清晰、更可执行）" : "补全目标与验收"}`,
    `任务名称：${input.taskName || "未命名"}`,
    `分类：${input.meta.category}`,
    `当前意图：${input.intentText || "（空）"}`,
    `当前目标：${input.meta.goal || "（空）"}`,
    acceptance ? `当前验收：\n- ${acceptance}` : "当前验收：（空）",
    "",
    "要求：",
    "1. intentText 用中文，分步骤，适合 Agent 执行",
    "2. goal 一句话说明交付物",
    "3. acceptanceRules 3-5 条，可验证",
    "4. 只返回 JSON",
  ].join("\n");
}

function buildExecutionRecommendPrompt(input: CronExecutionRecommendInput): string {
  const agentLines =
    input.agents.length > 0
      ? input.agents
          .map(
            (agent) =>
              `- id=${agent.id} | 名称=${agent.label} | 来源=${agent.source === "owned" ? "我的机器人" : "协作参与"}`,
          )
          .join("\n")
      : "（无）";
  const groupLines =
    input.groups.length > 0
      ? input.groups
          .map(
            (group) =>
              `- id=${group.sessionKey} | 名称=${group.label} | 成员=${String(group.memberCount)} | 职责=${group.purpose ?? "未设置"} | 当前任务=${group.mission ?? "未设置"}`,
          )
          .join("\n")
      : "（无）";

  return [
    "你是 OpenBot 定时任务执行对象推荐助手。请根据任务描述，从候选机器人/协作小组中选出**最合适的一项**执行该任务。",
    "只输出 JSON，不要 Markdown 代码块。",
    'JSON 结构：{"kind":"agent或group","id":"候选 id","reason":"一句话推荐理由"}',
    "",
    `任务名称：${input.taskName || "未命名"}`,
    `任务分类：${input.category}`,
    `任务描述：${input.intentText}`,
    "",
    "候选机器人：",
    agentLines,
    "",
    "候选协作小组：",
    groupLines,
    "",
    "规则：",
    "1. kind=agent 时 id 必须来自机器人列表；kind=group 时 id 必须来自协作小组列表",
    "2. 综合名称、职责、当前任务与任务描述的匹配度做判断",
    "3. 需要多人协作/跨角色任务优先 group；专属助手/单点执行优先 agent",
    "4. reason 用中文，≤ 80 字",
    "5. 只返回 JSON",
  ].join("\n");
}

function parseAiEnhanceJson(raw: string): CronTaskAiEnhanceResult | null {
  const json = extractJsonObject(raw);
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as {
      intentText?: unknown;
      goal?: unknown;
      acceptanceRules?: unknown;
    };
    const intentText = typeof parsed.intentText === "string" ? parsed.intentText.trim() : "";
    const goal = typeof parsed.goal === "string" ? parsed.goal.trim() : "";
    const acceptanceRules = Array.isArray(parsed.acceptanceRules)
      ? parsed.acceptanceRules
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [];
    if (!intentText && !goal && acceptanceRules.length === 0) {
      return null;
    }
    return {
      intentText,
      goal,
      acceptanceRules,
      source: "llm",
      summary: "已通过大模型优化任务配置",
    };
  } catch {
    return null;
  }
}

function parseExecutionRecommendJson(
  raw: string,
  input: CronExecutionRecommendInput,
): CronExecutionRecommendAiResult | null {
  const json = extractJsonObject(raw);
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as {
      kind?: unknown;
      id?: unknown;
      reason?: unknown;
    };
    const kind = parsed.kind === "group" ? "group" : parsed.kind === "agent" ? "agent" : null;
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
    if (!kind || !id) {
      return null;
    }
    if (kind === "agent") {
      const agent = input.agents.find((entry) => entry.id === id);
      if (!agent) {
        return null;
      }
      return {
        kind: "agent",
        id: agent.id,
        label: agent.label,
        reason: reason || `推荐机器人「${agent.label}」`,
        source: "llm",
      };
    }
    const group = input.groups.find((entry) => entry.sessionKey === id);
    if (!group) {
      return null;
    }
    return {
      kind: "group",
      id: group.sessionKey,
      label: group.label,
      reason: reason || `推荐协作小组「${group.label}」`,
      source: "llm",
    };
  } catch {
    return null;
  }
}

export function recommendExecutionTargetWithRules(
  input: CronExecutionRecommendInput,
): CronExecutionRecommendAiResult | null {
  const result = recommendExecutionTargetForTask({
    taskName: input.taskName,
    intentText: input.intentText,
    category: input.category as PersonalCronTaskMeta["category"],
    agents: input.agents,
    groups: input.groups.map((group) => ({
      sessionKey: group.sessionKey,
      label: group.label,
      purpose: group.purpose,
      mission: group.mission,
    })),
  });
  if (!result) {
    return null;
  }
  return { ...result, source: "rules" };
}

export function enhanceCronTaskWithRules(input: CronTaskAiEnhanceInput): CronTaskAiEnhanceResult {
  if (input.mode === "polish") {
    const polished = polishTaskDraft({
      intentText: input.intentText,
      meta: input.meta,
      taskName: input.taskName,
    });
    return {
      intentText: polished.intentText,
      goal: polished.goal,
      acceptanceRules: polished.acceptanceRules,
      source: "rules",
      summary: polished.changes.length > 0 ? polished.changes.join("；") : "已使用规则引擎优化",
    };
  }
  const suggestion = suggestGoalAndAcceptance({
    intentText: input.intentText,
    category: input.meta.category,
    taskName: input.taskName,
  });
  if (input.overwrite) {
    return {
      intentText: input.intentText,
      goal: suggestion.goal,
      acceptanceRules: suggestion.acceptanceRules,
      source: "rules",
      summary: "已根据任务意图重新生成目标与验收",
    };
  }
  return {
    intentText: input.intentText,
    goal: input.meta.goal.trim() || suggestion.goal,
    acceptanceRules:
      input.meta.acceptanceRules.filter((rule) => rule.trim()).length > 0
        ? input.meta.acceptanceRules
        : suggestion.acceptanceRules,
    source: "rules",
    summary: "已使用规则引擎补全目标与验收",
  };
}

export async function recommendExecutionTargetWithAi(params: {
  client: GatewayBrowserClient;
  sessionKey: string;
  input: CronExecutionRecommendInput;
  timeoutMs?: number;
}): Promise<CronExecutionRecommendAiResult | null> {
  const fallback = recommendExecutionTargetWithRules(params.input);
  try {
    const assistantText = await requestLlmAssistantText({
      client: params.client,
      sessionKey: params.sessionKey,
      prompt: buildExecutionRecommendPrompt(params.input),
      timeoutMs: params.timeoutMs,
    });
    if (!assistantText) {
      return fallback;
    }
    const parsed = parseExecutionRecommendJson(assistantText, params.input);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export async function enhanceCronTaskWithAi(params: {
  client: GatewayBrowserClient;
  sessionKey: string;
  input: CronTaskAiEnhanceInput;
  timeoutMs?: number;
}): Promise<CronTaskAiEnhanceResult> {
  const fallback = enhanceCronTaskWithRules(params.input);
  try {
    const assistantText = await requestLlmAssistantText({
      client: params.client,
      sessionKey: params.sessionKey,
      prompt: buildEnhancementPrompt(params.input),
      timeoutMs: params.timeoutMs,
    });
    if (!assistantText) {
      return fallback;
    }
    const parsed = parseAiEnhanceJson(assistantText);
    if (!parsed) {
      return fallback;
    }
    if (params.input.overwrite) {
      return {
        intentText: parsed.intentText || params.input.intentText,
        goal: parsed.goal || fallback.goal,
        acceptanceRules:
          parsed.acceptanceRules.length > 0 ? parsed.acceptanceRules : fallback.acceptanceRules,
        source: "llm",
        summary: parsed.summary || fallback.summary,
      };
    }
    return {
      intentText: parsed.intentText || params.input.intentText,
      goal: parsed.goal || fallback.goal,
      acceptanceRules:
        parsed.acceptanceRules.length > 0 ? parsed.acceptanceRules : fallback.acceptanceRules,
      source: "llm",
      summary: parsed.summary,
    };
  } catch {
    return fallback;
  }
}

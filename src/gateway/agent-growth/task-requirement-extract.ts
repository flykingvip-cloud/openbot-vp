/**
 * Agent Growth OS — P1：从首条任务文本 LLM 抽取胜任技能要求（候选集约束）。
 *
 * 失败返回 null，由调用方降级为模板 unmet + extractStatus=failed_fallback。
 */

import type { AgentKnowledgeLlmCaller } from "../knowledge/agent-knowledge-generator.js";
import type { GrowthCapabilityGapView } from "./next-action.js";
import type { AgentTemplate, GrowthPendingTaskContext } from "./types.js";

const MAX_DRAFT_CHARS = 4_000;
const EXTRACT_MAX_TOKENS = 400;

export type TaskSkillCandidate = {
  key: string;
  label: string;
  summary?: string;
};

export type TaskRequirementExtractResult = {
  suggestedSkillKeys: string[];
  taskGaps: GrowthCapabilityGapView[];
  extractStatus: GrowthPendingTaskContext["extractStatus"];
};

/** Extract the first balanced JSON object from raw LLM text. */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? raw.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function buildTaskSkillCandidates(params: {
  template: Pick<AgentTemplate, "requiredCapabilities">;
  recommendations?: Array<{ skillId: string; name: string; summary?: string }>;
}): TaskSkillCandidate[] {
  const byKey = new Map<string, TaskSkillCandidate>();
  for (const cap of params.template.requiredCapabilities) {
    if (cap.kind !== "skill" || !cap.required) {
      continue;
    }
    byKey.set(cap.key, { key: cap.key, label: cap.label });
  }
  for (const entry of params.recommendations ?? []) {
    const key = entry.skillId.trim();
    if (!key || byKey.has(key)) {
      continue;
    }
    byKey.set(key, {
      key,
      label: entry.name.trim() || key,
      ...(entry.summary?.trim() ? { summary: entry.summary.trim() } : {}),
    });
  }
  return [...byKey.values()];
}

export function buildExtractPrompt(draftText: string, candidates: TaskSkillCandidate[]): string {
  const catalog = candidates
    .map((c) => `- ${c.key} | ${c.label}${c.summary ? ` | ${c.summary}` : ""}`)
    .join("\n");
  return [
    "你是 AI 员工上岗顾问。根据用户的首条任务，从候选技能目录中选出完成该任务真正需要的技能。",
    "规则：",
    "- 只能从候选目录选择 skillKeys；禁止发明目录外的 key。",
    "- 只选必要技能，宁缺毋滥；若任务不需要任何技能，返回空数组。",
    "- 使用与任务相同的语言理解语义。",
    '仅返回 JSON：{"skillKeys":["key1"],"reason":"一句话"}',
    "",
    "候选技能目录：",
    catalog || "(空)",
    "",
    "用户任务：",
    draftText.slice(0, MAX_DRAFT_CHARS),
  ].join("\n");
}

function parseSkillKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  const raw = obj.skillKeys;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const key = entry.trim();
    if (!key || !allowed.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function taskGapsFromSuggestedKeys(params: {
  suggestedSkillKeys: string[];
  candidates: TaskSkillCandidate[];
  installedSkillKeys: Iterable<string>;
}): GrowthCapabilityGapView[] {
  const installed = new Set([...params.installedSkillKeys].map((k) => k.trim()).filter(Boolean));
  const labelByKey = new Map(params.candidates.map((c) => [c.key, c.label] as const));
  return params.suggestedSkillKeys.map((key) => ({
    key,
    label: labelByKey.get(key) ?? key,
    kind: "skill" as const,
    status: installed.has(key) ? ("satisfied" as const) : ("missing" as const),
  }));
}

/** 模板 unmet skills → 失败降级用的 suggested + gaps。 */
export function fallbackTaskGapsFromTemplate(params: {
  candidates: TaskSkillCandidate[];
  installedSkillKeys: Iterable<string>;
  templateRequiredSkillKeys: string[];
}): TaskRequirementExtractResult {
  const installed = new Set([...params.installedSkillKeys].map((k) => k.trim()).filter(Boolean));
  const suggestedSkillKeys = params.templateRequiredSkillKeys.filter((key) => {
    return params.candidates.some((c) => c.key === key) && !installed.has(key);
  });
  return {
    suggestedSkillKeys,
    taskGaps: taskGapsFromSuggestedKeys({
      suggestedSkillKeys,
      candidates: params.candidates,
      installedSkillKeys: params.installedSkillKeys,
    }),
    extractStatus: "failed_fallback",
  };
}

/**
 * LLM 抽取任务技能要求；失败返回 null（调用方用 fallbackTaskGapsFromTemplate）。
 */
export async function extractTaskSkillRequirements(params: {
  draftText: string;
  candidates: TaskSkillCandidate[];
  installedSkillKeys: Iterable<string>;
  llm: AgentKnowledgeLlmCaller | null;
}): Promise<TaskRequirementExtractResult | null> {
  const draft = params.draftText.trim();
  if (!draft || params.candidates.length === 0 || !params.llm) {
    return null;
  }
  const allowed = new Set(params.candidates.map((c) => c.key));
  let result: Awaited<ReturnType<AgentKnowledgeLlmCaller>>;
  try {
    result = await params.llm({
      prompt: buildExtractPrompt(draft, params.candidates),
      maxTokens: EXTRACT_MAX_TOKENS,
    });
  } catch {
    return null;
  }
  if (!result?.text?.trim()) {
    return null;
  }
  const obj = extractJsonObject(result.text);
  if (!obj) {
    return null;
  }
  const suggestedSkillKeys = parseSkillKeys(obj, allowed);
  return {
    suggestedSkillKeys,
    taskGaps: taskGapsFromSuggestedKeys({
      suggestedSkillKeys,
      candidates: params.candidates,
      installedSkillKeys: params.installedSkillKeys,
    }),
    extractStatus: "ready",
  };
}

export function toPendingTaskContext(params: {
  draftText: string;
  source: GrowthPendingTaskContext["source"];
  extract: TaskRequirementExtractResult;
  atMs?: number;
}): GrowthPendingTaskContext {
  return {
    draftText: params.draftText.trim(),
    source: params.source,
    suggestedSkillKeys: params.extract.suggestedSkillKeys,
    taskGaps: params.extract.taskGaps
      .filter((g) => g.kind === "skill")
      .map((g) => ({
        key: g.key,
        label: g.label,
        kind: "skill" as const,
        status: g.status === "satisfied" ? ("satisfied" as const) : ("missing" as const),
      })),
    extractedAtMs: params.atMs ?? Date.now(),
    extractStatus: params.extract.extractStatus,
  };
}
